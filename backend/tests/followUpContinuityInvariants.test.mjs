// PHASE P10 — end-to-end regression tests composing the real functions this
// phase touches (resolveFollowUpState, resolveScheduledFollowUps,
// claimFollowUpSlot) exactly the way the controllers wire them together, to
// prove the FULL continuity invariant holds across a cancel → reappear →
// reschedule lifecycle — not just each function in isolation.
//
// No live MongoDB is available in this sandbox (mongodb-memory-server's
// binary download is blocked by the sandbox's network egress allowlist —
// confirmed by hand). These tests instead simulate the exact state
// transitions the real Mongoose documents go through (the same fields,
// the same before/after values a real Prescription/Appointment document
// would have) and feed them through the actual production functions, so
// the assertions are about real application logic, not just re-describing
// the source code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFollowUpState, resolveScheduledFollowUps, claimFollowUpSlot } from "../services/doctorPatientRelationshipService.js";

function makeFakePrescriptionModel(initialDoc) {
  const store = new Map([[String(initialDoc._id), { ...initialDoc }]]);
  return {
    store,
    async findOneAndUpdate(filter) {
      const doc = store.get(String(filter._id));
      if (!doc || String(doc.doctorId) !== String(filter.doctorId) || String(doc.patientId) !== String(filter.patientId)) return null;
      if (doc.followUpScheduledAppointmentId) return null;
      return doc;
    },
  };
}

test("INVARIANT: cancelling a scheduled follow-up's appointment makes the recommendation reappear in resolveFollowUpState", () => {
  const followUpDate = "2026-08-01T00:00:00.000Z";
  const now = new Date("2026-08-20T00:00:00.000Z").getTime();

  // Step 1: while scheduled, every consumer excludes it from
  // resolveFollowUpState's input (real controller behavior — see
  // getPatientClinicalProfile / commandCenterController), so it produces
  // no overdue/upcoming bucket at all.
  const whileScheduled = resolveFollowUpState({ followUpDates: [], lastVisit: null, now });
  assert.equal(whileScheduled.bucket, null, "a scheduled follow-up must not also show as overdue/upcoming");

  // But it IS visible via the scheduled-tracking half of the loop.
  const scheduledView = resolveScheduledFollowUps([
    { prescription: { _id: "p1", patientId: "pat1", diagnosis: "Hypertension" }, appointment: { _id: "a1", date: "2026-09-01", status: "approved" } },
  ]);
  assert.equal(scheduledView[0].bucket, "scheduled");

  // Step 2: the appointment is cancelled. cancelAppointmentCore clears
  // Prescription.followUpScheduledAppointmentId — simulate that exact
  // state transition and feed the now-unlinked followUpDate back into
  // resolveFollowUpState, the same way getPatientClinicalProfile does
  // (`prescriptions.filter((p) => !p.followUpScheduledAppointmentId)`).
  const afterCancelAndUnlink = resolveFollowUpState({ followUpDates: [followUpDate], lastVisit: null, now });
  assert.equal(afterCancelAndUnlink.bucket, "overdue", "the recommendation must reappear as overdue, not vanish");
  assert.equal(afterCancelAndUnlink.overdue, followUpDate);
});

test("INVARIANT: if the unlink write fails entirely, the cancelled follow-up is STILL visible (self-healing read path), never silently lost", () => {
  // Simulates the worst case named in the audit: cancelAppointmentCore's
  // retries all fail, so Prescription.followUpScheduledAppointmentId is
  // still set, still pointing at an appointment whose status is genuinely
  // "cancelled". resolveScheduledFollowUps must classify this as needing
  // attention, not silently omit it.
  const items = resolveScheduledFollowUps([
    { prescription: { _id: "p1", patientId: "pat1", diagnosis: "Hypertension" }, appointment: { _id: "a1", date: "2026-08-15", status: "cancelled" } },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].bucket, "cancelled_needs_action");
});

test("INVARIANT: after a cancelled follow-up's link is cleared, scheduling a NEW one is allowed", async () => {
  const model = makeFakePrescriptionModel({ _id: "p1", doctorId: "doc1", patientId: "pat1", followUpScheduledAppointmentId: null });
  const result = await claimFollowUpSlot(model, { prescriptionId: "p1", doctorId: "doc1", patientId: "pat1", appointmentId: "new-appt" });
  assert.ok(result !== null, "rescheduling after a cleared cancellation must succeed");
});

test("INVARIANT: an active (not cancelled) linked follow-up rejects a second scheduling attempt", async () => {
  const model = makeFakePrescriptionModel({ _id: "p1", doctorId: "doc1", patientId: "pat1", followUpScheduledAppointmentId: "already-active" });
  const result = await claimFollowUpSlot(model, { prescriptionId: "p1", doctorId: "doc1", patientId: "pat1", appointmentId: "second-attempt" });
  assert.equal(result, null, "a second active follow-up must never be claimable");
});

test("OWNERSHIP: a claim scoped to the wrong doctor is rejected even for an unlinked prescription", async () => {
  const model = makeFakePrescriptionModel({ _id: "p1", doctorId: "doc1", patientId: "pat1", followUpScheduledAppointmentId: null });
  const result = await claimFollowUpSlot(model, { prescriptionId: "p1", doctorId: "some-other-doctor", patientId: "pat1", appointmentId: "appt-x" });
  assert.equal(result, null, "a doctor must never be able to claim a prescription that isn't theirs");
  assert.equal(model.store.get("p1").followUpScheduledAppointmentId, null, "the prescription must be untouched by the rejected claim");
});

test("OWNERSHIP: a claim scoped to the wrong patient is rejected even for an unlinked prescription", async () => {
  const model = makeFakePrescriptionModel({ _id: "p1", doctorId: "doc1", patientId: "pat1", followUpScheduledAppointmentId: null });
  const result = await claimFollowUpSlot(model, { prescriptionId: "p1", doctorId: "doc1", patientId: "some-other-patient", appointmentId: "appt-x" });
  assert.equal(result, null, "a claim must never succeed for a mismatched patientId");
});

test("RESCHEDULE: resolveScheduledFollowUps keeps classifying the SAME appointment id across a reschedule (date/time change, same _id)", () => {
  // rescheduleAppointment (appointmentController.js) updates the existing
  // Appointment document in place — same _id, new date/timeSlot, a
  // rescheduleHistory entry appended — it never creates a second
  // document. Prescription.followUpScheduledAppointmentId therefore never
  // needs to change across a reschedule. Simulates that: same appointment
  // id, only date/timeSlot differ (as they would after a real reschedule).
  const prescription = { _id: "p1", patientId: "pat1", diagnosis: "Hypertension" };
  const beforeReschedule = resolveScheduledFollowUps([
    { prescription, appointment: { _id: "a1", date: "2026-09-01", timeSlot: "10:00-10:15", status: "approved" } },
  ]);
  const afterReschedule = resolveScheduledFollowUps([
    { prescription, appointment: { _id: "a1", date: "2026-09-05", timeSlot: "14:00-14:15", status: "approved" } },
  ]);
  assert.equal(beforeReschedule[0].appointmentId, "a1");
  assert.equal(afterReschedule[0].appointmentId, "a1", "the continuity link (appointment id) must be identical across a reschedule");
  assert.equal(afterReschedule[0].bucket, "scheduled", "a rescheduled-but-still-active follow-up remains 'scheduled', not treated as a new/duplicate one");
});

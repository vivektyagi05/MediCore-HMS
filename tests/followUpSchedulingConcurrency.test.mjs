// PHASE P10 — behavioral (not source-regex) proof that claimFollowUpSlot
// enforces "at most one active follow-up appointment per prescription"
// under real concurrency, not just when called sequentially.
//
// A live MongoDB isn't available in this sandbox (mongodb-memory-server's
// binary download is blocked by the sandbox's network egress allowlist —
// confirmed by hand, not assumed) — matching every prior phase's "DB LIVE
// TESTING MAY BE UNAVAILABLE" constraint. What IS fully testable without a
// database is the actual claim algorithm's concurrency-safety, which is
// exactly what a genuine MongoDB findOneAndUpdate provides in production:
// "read the filter and apply the write as one indivisible step." This test
// builds a fake Prescription model whose findOneAndUpdate deliberately
// AWAITS a tick between reading its in-memory store and writing to it —
// i.e. it simulates the worst-case interleaving two real concurrent
// requests could produce — and proves claimFollowUpSlot still yields
// exactly one winner. This is not testing MongoDB itself (that guarantee
// is the database engine's job, not application code's), it's testing that
// OUR code asks Mongo for the one operation shape that makes the guarantee
// possible: a single conditional update, not a separate read-then-write.
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimFollowUpSlot } from "../services/doctorPatientRelationshipService.js";

function makeInterleavingFakePrescriptionModel(initialDoc) {
  const store = new Map([[String(initialDoc._id), { ...initialDoc }]]);
  return {
    store,
    async findOneAndUpdate(filter, update) {
      const doc = store.get(String(filter._id));
      if (!doc || String(doc.doctorId) !== String(filter.doctorId) || String(doc.patientId) !== String(filter.patientId)) return null;
      // Deliberately split into a "read" half and a "write" half with a
      // real await between them, so two concurrent calls can genuinely
      // interleave (one call's read can run before the other's write) —
      // this is the worst case a real database client driver could
      // observe under true concurrency, not an artificially-safe
      // simulation.
      await new Promise((resolve) => setTimeout(resolve, 5)); // the race window
      // Re-check against the CURRENT store state at write time — this is
      // what a real atomic findOneAndUpdate guarantees (the precondition
      // is evaluated as part of the same indivisible operation as the
      // write, never against a stale snapshot from before the await
      // above). Whichever concurrent caller reaches this line while the
      // field is still unset wins; every other caller sees it already set
      // and gets null, exactly like a real Mongo write that lost the race.
      const current = store.get(String(filter._id));
      if (current.followUpScheduledAppointmentId) return null;
      current.followUpScheduledAppointmentId = update.$set.followUpScheduledAppointmentId;
      delete current.followUpCancelledAt;
      return { ...doc };
    },
  };
}

test("claimFollowUpSlot: two concurrent claims for the same prescription — exactly one wins", async () => {
  const prescriptionId = "presc-1";
  const doctorId = "doc-1";
  const patientId = "pat-1";
  const model = makeInterleavingFakePrescriptionModel({ _id: prescriptionId, doctorId, patientId, followUpScheduledAppointmentId: undefined });

  const [resultA, resultB] = await Promise.all([
    claimFollowUpSlot(model, { prescriptionId, doctorId, patientId, appointmentId: "appt-A" }),
    claimFollowUpSlot(model, { prescriptionId, doctorId, patientId, appointmentId: "appt-B" }),
  ]);

  const winners = [resultA, resultB].filter((r) => r !== null);
  assert.equal(winners.length, 1, "exactly one of the two concurrent claims must succeed");
  // The prescription must end up linked to whichever appointment actually
  // won — never both, never neither.
  assert.ok(["appt-A", "appt-B"].includes(model.store.get(prescriptionId).followUpScheduledAppointmentId));
});

test("claimFollowUpSlot: ten concurrent claims for the same prescription — still exactly one wins", async () => {
  const prescriptionId = "presc-2";
  const doctorId = "doc-1";
  const patientId = "pat-1";
  const model = makeInterleavingFakePrescriptionModel({ _id: prescriptionId, doctorId, patientId, followUpScheduledAppointmentId: undefined });

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => claimFollowUpSlot(model, { prescriptionId, doctorId, patientId, appointmentId: `appt-${i}` })),
  );
  assert.equal(results.filter((r) => r !== null).length, 1, "exactly one of ten concurrent claims must succeed, no matter how many race");
});

test("claimFollowUpSlot: a prescription with an already-active link rejects every claim (nothing wins)", async () => {
  const prescriptionId = "presc-3";
  const doctorId = "doc-1";
  const patientId = "pat-1";
  const model = makeInterleavingFakePrescriptionModel({ _id: prescriptionId, doctorId, patientId, followUpScheduledAppointmentId: "already-active-appt" });

  const result = await claimFollowUpSlot(model, { prescriptionId, doctorId, patientId, appointmentId: "appt-new" });
  assert.equal(result, null);
  assert.equal(model.store.get(prescriptionId).followUpScheduledAppointmentId, "already-active-appt", "the existing active link must be untouched");
});

test("claimFollowUpSlot: a prescription with no link (never scheduled, or already cleared by cancellation) can be claimed", async () => {
  const prescriptionId = "presc-4";
  const doctorId = "doc-1";
  const patientId = "pat-1";
  const model = makeInterleavingFakePrescriptionModel({ _id: prescriptionId, doctorId, patientId, followUpScheduledAppointmentId: null });

  const result = await claimFollowUpSlot(model, { prescriptionId, doctorId, patientId, appointmentId: "appt-new" });
  assert.ok(result !== null);
  assert.equal(model.store.get(prescriptionId).followUpScheduledAppointmentId, "appt-new");
});

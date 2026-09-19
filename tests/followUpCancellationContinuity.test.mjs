// PHASE P10 audit finding: cancelling a follow-up Appointment left
// Prescription.followUpScheduledAppointmentId pointing at the now-cancelled
// appointment forever — every follow-up surface (Dashboard queue, Patient
// Profile, attention items) EXCLUDES any prescription with that field set,
// so the original clinical recommendation would silently vanish with no
// trace and no path back into the doctor's Follow-up Queue. This is the
// exact continuity break the phase brief (§13) describes. Same DB-free
// source-inspection style as appointmentCancellationCrossRoleNotification.test.mjs
// (no live Mongo in this sandbox) — locks in that the fix exists in the one
// place it can possibly run: cancelAppointmentCore, which every cancellation
// path (patient/doctor/admin) already funnels through.
import assert from "assert";
import fs from "fs";

const cancellationSource = fs.readFileSync(
  new URL("../services/appointmentCancellationService.js", import.meta.url),
  "utf8",
);

const coreStart = cancellationSource.indexOf("export const cancelAppointmentCore");
assert.ok(coreStart !== -1, "cancelAppointmentCore must exist");
const coreBody = cancellationSource.slice(coreStart);

assert.ok(
  /appointment\.appointmentType === "follow_up"/.test(coreBody),
  "cancelAppointmentCore must special-case follow_up appointments",
);
assert.ok(
  /\$unset:\s*{\s*followUpScheduledAppointmentId/.test(coreBody),
  "must clear Prescription.followUpScheduledAppointmentId when its linked appointment is cancelled",
);
assert.ok(
  /followUpCancelledAt/.test(coreBody),
  "must record a real followUpCancelledAt timestamp so the doctor sees WHY the recommendation reappeared, not just a bare unscheduled one",
);

// The unlink must happen unconditionally for a follow-up cancellation (not
// nested inside the paid/refund branch, which only runs when a payment
// exists) — i.e. it must appear before the payment-status refund check.
const unlinkIndex = coreBody.indexOf("followUpScheduledAppointmentId");
const refundIndex = coreBody.indexOf("PAYMENT_STATUS.PAID");
assert.ok(unlinkIndex !== -1 && refundIndex !== -1 && unlinkIndex < refundIndex, "follow-up unlink must not be gated behind the payment/refund branch");

// HARDENING PASS — retry/compensation strategy, since a single try/catch
// that silently swallows the unlink failure is not good enough: a
// transient DB error there must not be a permanent, unrecoverable
// continuity break.
assert.ok(/maxAttempts/.test(coreBody) && /attempt \+= 1/.test(coreBody), "the follow-up unlink must retry on failure, not attempt it exactly once");
assert.ok(/for \(let attempt = 1; attempt <= maxAttempts/.test(coreBody), "must be a bounded retry loop, not an unbounded one");


const prescriptionSource = fs.readFileSync(new URL("../models/Prescription.js", import.meta.url), "utf8");
assert.ok(/followUpCancelledAt:\s*{\s*type:\s*Date/.test(prescriptionSource), "Prescription model must declare followUpCancelledAt");

// scheduleFollowUpAppointment must enforce duplicate-prevention server-side
// (brief §11 — a frontend-only disabled button is not real protection).
const workflowSource = fs.readFileSync(new URL("../controllers/doctor/workflowController.js", import.meta.url), "utf8");
const scheduleStart = workflowSource.indexOf("export const scheduleFollowUpAppointment");
assert.ok(scheduleStart !== -1, "scheduleFollowUpAppointment must exist");
const scheduleBody = workflowSource.slice(scheduleStart, workflowSource.indexOf("export const", scheduleStart + 10));
assert.ok(
  /FOLLOWUP_ALREADY_SCHEDULED/.test(scheduleBody),
  "scheduleFollowUpAppointment must reject scheduling a second active follow-up for the same recommendation",
);
assert.ok(/claimFollowUpSlot\(/.test(scheduleBody), "successfully (re)scheduling a follow-up must go through the atomic claim, which itself clears any prior followUpCancelledAt flag");

const relationshipServiceSource = fs.readFileSync(new URL("../services/doctorPatientRelationshipService.js", import.meta.url), "utf8");
assert.ok(/export async function claimFollowUpSlot/.test(relationshipServiceSource), "claimFollowUpSlot must be exported for scheduleFollowUpAppointment (and tests) to use");
assert.ok(
  /\$unset:\s*{\s*followUpCancelledAt/.test(relationshipServiceSource.slice(relationshipServiceSource.indexOf("claimFollowUpSlot"))),
  "the atomic claim itself must clear any prior followUpCancelledAt flag as part of the same write",
);

// HARDENING PASS — the duplicate-prevention check must be an atomic
// conditional update (via the extracted, independently-tested
// claimFollowUpSlot), not a separate find-then-create-then-link sequence,
// which is exactly the race two concurrent requests could both slip
// through.
assert.ok(/claimFollowUpSlot\(/.test(scheduleBody), "must use the atomic claimFollowUpSlot helper, not an inline find-then-write race");
const claimCallIndex = scheduleBody.indexOf("claimFollowUpSlot(");
const appointmentCreateIndex = scheduleBody.indexOf("Appointment.create(");
assert.ok(
  claimCallIndex !== -1 && appointmentCreateIndex !== -1 && claimCallIndex < appointmentCreateIndex,
  "the prescription must be atomically claimed BEFORE the real Appointment document is created — claiming after creation is exactly the race this phase fixes",
);
// Failed appointment creation must not leave a dangling claim (the
// prescription must remain unchanged / reclaimable, per the brief's
// explicit "failed appointment creation → prescription must remain
// unchanged" requirement).
assert.ok(
  /claimedPrescription/.test(scheduleBody) && /catch \(error\)/.test(scheduleBody),
  "must roll back the claim if Appointment.create() subsequently fails",
);
const catchIndex = scheduleBody.indexOf("} catch (error) {", appointmentCreateIndex);
assert.ok(catchIndex !== -1, "the Appointment.create() call must be wrapped so creation failures can be compensated");
const catchBody = scheduleBody.slice(catchIndex, scheduleBody.indexOf("throw error;", catchIndex));
assert.ok(/\$unset:\s*{\s*followUpScheduledAppointmentId/.test(catchBody), "the catch block must release the claim by unsetting followUpScheduledAppointmentId");

// appointmentEmitter.created must notify the patient when the doctor (not
// the patient) initiated the booking — the real "patient awareness" gap:
// scheduleFollowUpAppointment reuses this exact function, and the
// ScheduleFollowUpDialog UI promises "the patient will be notified
// immediately", which was not true before this fix.
const emitterSource = fs.readFileSync(new URL("../realtime/appointmentEmitter.js", import.meta.url), "utf8");
const createdStart = emitterSource.indexOf("async created(appointment)");
assert.ok(createdStart !== -1, "appointmentEmitter.created must exist");
const createdBody = emitterSource.slice(createdStart, emitterSource.indexOf("async statusUpdated", createdStart));
assert.ok(
  /bookedBy\s*&&\s*appointment\.bookedBy\s*!==\s*"patient"/.test(createdBody),
  "appointmentEmitter.created must notify the patient for any non-patient-initiated booking (doctor-scheduled follow-ups included)",
);

console.log("PASS: follow-up cancellation clears the continuity link, scheduling enforces duplicate-prevention, and patients are notified of doctor-booked follow-ups");

// HARDENING PASS — scale audit (brief §3). The bounded scheduled-follow-up
// query must be sorted (so a truncation drops the least-relevant items,
// never the most relevant) and the dashboard must know when it truncated
// (never silently hide legitimate follow-ups).
const commandCenterSource = fs.readFileSync(new URL("../controllers/doctor/commandCenterController.js", import.meta.url), "utf8");
assert.ok(/appointmentType: "follow_up"/.test(commandCenterSource), "the scheduled-follow-up query must exist");
assert.ok(/\.sort\(\{ date: 1 \}\)/.test(commandCenterSource), "the scheduled-follow-up query must be sorted by date, not returned in arbitrary order before being capped");
assert.ok(/countDocuments/.test(commandCenterSource), "must know the true total (uncapped) to detect truncation");
assert.ok(/followUpQueueTruncated/.test(commandCenterSource), "must surface a truncation flag to the frontend rather than silently dropping items");

const dashboardWidgetsSource = fs.readFileSync(
  new URL("../../src/components/doctor/dashboard/DoctorHomeWidgets.jsx", import.meta.url),
  "utf8",
);
assert.ok(/truncated/.test(dashboardWidgetsSource), "the Follow-up Queue widget must actually render the truncation notice, not just receive the flag");

console.log("PASS: scheduled-follow-up dashboard query is sorted, bounded, and communicates truncation instead of silently hiding items");

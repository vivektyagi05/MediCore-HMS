// Phase DOC-04: rescheduling is new this phase. The one rule most likely to
// drift over time is its eligibility gate — it's supposed to reuse the
// exact same CANCELLABLE_STATUSES list cancellation already uses (an
// appointment shouldn't be reschedulable once it's not even cancellable
// anymore), not a second hand-maintained status list that could silently
// diverge. This can't be tested via a DB call in this sandbox, so it
// locks in the *source contract* instead: the controller must reference
// CANCELLABLE_STATUSES for this check, not a literal status array.
import assert from "assert";
import fs from "fs";
import { CANCELLABLE_STATUSES } from "../constants/appointmentStatus.js";

const source = fs.readFileSync(new URL("../controllers/appointmentController.js", import.meta.url), "utf8");

// Locate the rescheduleAppointment function body.
const start = source.indexOf("export const rescheduleAppointment");
assert.ok(start !== -1, "rescheduleAppointment must exist in appointmentController.js");
const nextExport = source.indexOf("\nexport const", start + 1);
const body = source.slice(start, nextExport === -1 ? source.length : nextExport);

assert.ok(
  body.includes("CANCELLABLE_STATUSES.includes(appointment.status)"),
  "rescheduleAppointment must gate eligibility via the shared CANCELLABLE_STATUSES list, not a new one",
);
console.log("PASS: rescheduleAppointment reuses CANCELLABLE_STATUSES as its single source of truth for eligibility");

// Sanity: CANCELLABLE_STATUSES itself must still exclude terminal/in-progress
// states, or the reuse above would be meaningless.
assert.ok(!CANCELLABLE_STATUSES.includes("consultation_started"));
assert.ok(!CANCELLABLE_STATUSES.includes("completed"));
assert.ok(!CANCELLABLE_STATUSES.includes("cancelled"));
console.log("PASS: CANCELLABLE_STATUSES excludes in-progress/terminal states (reschedule inherits this correctly)");

// Locate cancelAppointment and confirm the doctor branch requires a reason
// while patient does not (mirrors admin's existing reason requirement).
const cancelStart = source.indexOf("export const cancelAppointment");
assert.ok(cancelStart !== -1);
const cancelNextExport = source.indexOf("\nexport const", cancelStart + 1);
const cancelBody = source.slice(cancelStart, cancelNextExport === -1 ? source.length : cancelNextExport);

assert.ok(
  /ROLES\.DOCTOR[\s\S]{0,400}req\.body\.reason/.test(cancelBody),
  "doctor-initiated cancellation must require req.body.reason",
);
console.log("PASS: cancelAppointment requires a reason on the doctor branch");

// Confirm updateAppointmentStatus refuses cancellation transitions outright
// (the actual bug fix — every caller must go through cancelAppointmentCore).
const updateStart = source.indexOf("export const updateAppointmentStatus");
const updateNextExport = source.indexOf("\nexport const", updateStart + 1);
const updateBody = source.slice(updateStart, updateNextExport === -1 ? source.length : updateNextExport);
assert.ok(
  /newStatus === APPOINTMENT_STATUS\.CANCELLED/.test(updateBody) && /throw new AppError/.test(updateBody),
  "updateAppointmentStatus must refuse the cancelled transition so every caller uses the dedicated cancel endpoint",
);
console.log("PASS: updateAppointmentStatus refuses direct cancellation (forces the shared cancelAppointmentCore path)");

console.log("ALL DOC-04 CANCEL/RESCHEDULE CONTRACT TESTS PASSED");

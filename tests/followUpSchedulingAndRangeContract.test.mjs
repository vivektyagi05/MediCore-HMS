// Phase DOC-07 final pass: the brief explicitly forbids a second scheduling
// engine for doctor-initiated follow-up booking, and a second capacity
// calculator for week/month views. This can't be exercised against a real
// DB in this sandbox (no MongoDB available), so — same pattern as
// appointmentCancelRescheduleContract.test.mjs — it locks in the *source
// contract*: the new code must literally reference the existing engine
// functions, not reimplement them.
import assert from "assert";
import fs from "fs";

const workflowSource = fs.readFileSync(new URL("../controllers/doctor/workflowController.js", import.meta.url), "utf8");
const appointmentSource = fs.readFileSync(new URL("../controllers/appointmentController.js", import.meta.url), "utf8");

// 1. appointmentController must actually export the helpers workflowController claims to reuse.
for (const helper of ["ensureDoctorAvailable", "findBlockedDate", "getDayOfWeek"]) {
  assert.ok(
    new RegExp(`export const ${helper}\\b`).test(appointmentSource),
    `appointmentController.js must export ${helper} for doctor-initiated booking to reuse`,
  );
}
console.log("PASS: appointmentController exports the real availability helpers");

// 2. scheduleFollowUpAppointment must import and call them — not redefine its own copies.
const followUpStart = workflowSource.indexOf("export const scheduleFollowUpAppointment");
assert.ok(followUpStart !== -1, "scheduleFollowUpAppointment must exist in workflowController.js");
const followUpNextExport = workflowSource.indexOf("\nexport const", followUpStart + 1);
const followUpBody = workflowSource.slice(followUpStart, followUpNextExport === -1 ? workflowSource.length : followUpNextExport);

assert.ok(
  /from ["'].*appointmentController\.js["']/.test(workflowSource),
  "workflowController.js must import the shared helpers from appointmentController.js",
);
assert.ok(followUpBody.includes("ensureDoctorAvailable("), "scheduleFollowUpAppointment must call the real ensureDoctorAvailable check");
assert.ok(followUpBody.includes("ACTIVE_STATUSES"), "scheduleFollowUpAppointment must gate conflicts using the shared ACTIVE_STATUSES list");
assert.ok(followUpBody.includes("error?.code === 11000") || followUpBody.includes('error.code === 11000'), "scheduleFollowUpAppointment must handle the same DB-level race condition as createAppointment (E11000 -> structured conflict)");
assert.ok(followUpBody.includes("ensureDoctorTreatedPatient("), "scheduleFollowUpAppointment must verify the doctor actually treated this patient before booking on their behalf");
console.log("PASS: scheduleFollowUpAppointment reuses the real availability/conflict engine, not a second one");

// 3. getScheduleRange must reuse buildDayCapacity (the same engine Today view/next-available use) and stay bounded.
const rangeStart = workflowSource.indexOf("export const getScheduleRange");
assert.ok(rangeStart !== -1, "getScheduleRange must exist in workflowController.js");
const rangeNextExport = workflowSource.indexOf("\nexport const", rangeStart + 1);
const rangeBody = workflowSource.slice(rangeStart, rangeNextExport === -1 ? workflowSource.length : rangeNextExport);

assert.ok(rangeBody.includes("buildDayCapacity("), "getScheduleRange must reuse buildDayCapacity, not a second capacity calculator");
assert.ok(/MAX_RANGE_DAYS/.test(workflowSource), "the range endpoint must be bounded (Large-Data-Protection guard)");
assert.ok(rangeBody.includes("dayCount > MAX_RANGE_DAYS"), "getScheduleRange must actually enforce the bound, not just define it");
console.log("PASS: getScheduleRange reuses buildDayCapacity and enforces a bounded range");

// 4. Follow-up Queue exclusion: an already-scheduled follow-up must not still show as pending.
const commandCenterSource = fs.readFileSync(new URL("../controllers/doctor/commandCenterController.js", import.meta.url), "utf8");
assert.ok(
  commandCenterSource.includes("followUpScheduledAppointmentId: { $exists: false }"),
  "Follow-up Queue must exclude prescriptions whose follow-up has already been turned into a real appointment",
);
console.log("PASS: Follow-up Queue excludes already-scheduled follow-ups");

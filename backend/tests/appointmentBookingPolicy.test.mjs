// APPOINTMENT ENGINE REMEDIATION (2026-09-24) — regression test for the
// exact bug the remediation brief's Scenario A describes: a booking whose
// CALENDAR DATE is today but whose TIME OF DAY has already passed was
// previously accepted, because createAppointment/rescheduleAppointment/
// scheduleFollowUpAppointment each only compared
// `appointmentDate < today` (both normalized to UTC midnight) — equal, not
// less-than, for any time later than midnight on the current date.
//
// Also covers the two other real, previously-unenforced settings this pass
// closes (flagged, found-but-not-fixed, in the prior checkpoint's Section
// C item 2): HospitalSetting.appointmentLimits.bookingWindowDays and
// .dailyPerDoctor.
import assert from "node:assert/strict";
import HospitalSetting from "../models/HospitalSetting.js";
import Appointment from "../models/Appointment.js";
import { clearHospitalSettingsCacheForTesting, getAppointmentLimits } from "../services/hospitalSettingsService.js";
import {
  resolveSlotStartMinutes,
  resolveAppointmentInstant,
  assertAppointmentNotInPast,
  assertWithinBookingWindow,
  assertDoctorDailyCapacityAvailable,
  enforceAppointmentBookingPolicy,
} from "../services/appointmentBookingPolicyService.js";

console.log("appointmentBookingPolicy.test.mjs");

let settingsDoc = null;
HospitalSetting.findOne = () => ({ select: () => ({ lean: async () => settingsDoc }) });

// ── resolveSlotStartMinutes: parses structured "HH:MM-HH:MM" slots ──────
assert.equal(resolveSlotStartMinutes("09:00-09:30"), 9 * 60);
assert.equal(resolveSlotStartMinutes("00:00-00:30"), 0);
assert.equal(resolveSlotStartMinutes("23:45-23:59"), 23 * 60 + 45);
// Legacy/unparseable input must fall back to null, never throw.
assert.equal(resolveSlotStartMinutes("Morning Slot A"), null);
assert.equal(resolveSlotStartMinutes(""), null);
assert.equal(resolveSlotStartMinutes(undefined), null);
assert.equal(resolveSlotStartMinutes("25:00-25:30"), null, "out-of-range hour must not parse");
console.log("PASS: resolveSlotStartMinutes parses structured slots and safely rejects legacy/malformed input");

// ── resolveAppointmentInstant combines date + parsed slot start ─────────
const day = new Date("2026-09-24T00:00:00.000Z");
const instant = resolveAppointmentInstant(day, "09:00-09:30");
assert.equal(instant.toISOString(), "2026-09-24T09:00:00.000Z");
assert.equal(resolveAppointmentInstant(day, "not-a-slot"), null);
console.log("PASS: resolveAppointmentInstant resolves a real instant, or null for unparseable slots");

// ── THE CORE BUG: booking 09:00 when real server time is 12:00 same day ──
const serverNowNoon = new Date("2026-09-24T12:00:00.000Z");
assert.throws(
  () => assertAppointmentNotInPast(day, "09:00-09:30", serverNowNoon),
  /already passed/,
  "Scenario A from the brief: 09:00 must be rejected when server time is already 12:00 the same day",
);
// Boundary case from the brief: 11:59 must also be rejected.
assert.throws(() => assertAppointmentNotInPast(day, "11:59-12:29", serverNowNoon), /already passed/);
// A genuinely future time today (12:30) must be allowed through by this check.
assert.doesNotThrow(() => assertAppointmentNotInPast(day, "12:30-13:00", serverNowNoon));
// A future date is always fine regardless of time-of-day parsing.
const tomorrow = new Date("2026-09-25T00:00:00.000Z");
assert.doesNotThrow(() => assertAppointmentNotInPast(tomorrow, "00:00-00:30", serverNowNoon));
// A past CALENDAR DATE must still be rejected outright (pre-existing
// protection, must not regress).
const yesterday = new Date("2026-09-23T00:00:00.000Z");
assert.throws(() => assertAppointmentNotInPast(yesterday, "23:00-23:30", serverNowNoon), /already passed/);
// Legacy/unparseable timeSlot on TODAY must fall back to date-only
// comparison (today is never rejected outright just because the slot
// string doesn't parse) — this preserves prior behavior exactly, it does
// not newly break legacy data.
assert.doesNotThrow(() => assertAppointmentNotInPast(day, "Morning Slot A", serverNowNoon));
console.log("PASS: assertAppointmentNotInPast rejects a past time-of-day on today's date (Scenario A), the exact boundary in the brief, and never regresses the past-date-only check");

// ── booking window enforcement ───────────────────────────────────────────
clearHospitalSettingsCacheForTesting();
settingsDoc = { appointmentLimits: { bookingWindowDays: 30 } };
assert.deepEqual(await getAppointmentLimits(), { dailyPerDoctor: 30, bookingWindowDays: 30 });

const withinWindow = new Date("2026-10-15T00:00:00.000Z"); // 21 days out from serverNowNoon's date
await assert.doesNotReject(() => assertWithinBookingWindow(withinWindow, serverNowNoon));

const beyondWindow = new Date("2026-12-01T00:00:00.000Z"); // ~68 days out
await assert.rejects(() => assertWithinBookingWindow(beyondWindow, serverNowNoon), /booked up to 30 days in advance/);
console.log("PASS: assertWithinBookingWindow enforces HospitalSetting.appointmentLimits.bookingWindowDays (previously read-only, never enforced)");

clearHospitalSettingsCacheForTesting();
settingsDoc = null; // nothing configured yet -> real schema default, not 0
assert.equal((await getAppointmentLimits()).bookingWindowDays, 30);
assert.equal((await getAppointmentLimits()).dailyPerDoctor, 30);
settingsDoc = { appointmentLimits: { bookingWindowDays: 9999 } }; // out of schema's max(365) range
clearHospitalSettingsCacheForTesting();
assert.equal((await getAppointmentLimits()).bookingWindowDays, 30, "an out-of-schema-range stored value must fall back to the default");
console.log("PASS: getAppointmentLimits falls back to real schema defaults, never to 0 or an out-of-range stored value");

// ── daily-per-doctor cap enforcement ─────────────────────────────────────
clearHospitalSettingsCacheForTesting();
settingsDoc = { appointmentLimits: { dailyPerDoctor: 2 } };
let countDocumentsCalls = [];
Appointment.countDocuments = async (filter) => {
  countDocumentsCalls.push(filter);
  return 2; // at the cap
};
await assert.rejects(
  () => assertDoctorDailyCapacityAvailable("doctor1", day),
  /maximum number of appointments/,
  "must reject once the doctor's active-appointment count for the date reaches the configured cap",
);
assert.equal(countDocumentsCalls[0].doctorId, "doctor1");
assert.equal(countDocumentsCalls[0].date, day);
assert.ok(Array.isArray(countDocumentsCalls[0].status.$in), "must scope to ACTIVE_STATUSES, matching every other appointment-count query in this codebase");

// Rescheduling within the same day must exclude the appointment's own
// current slot from the count via excludeAppointmentId.
countDocumentsCalls = [];
Appointment.countDocuments = async (filter) => {
  countDocumentsCalls.push(filter);
  return 1; // below the cap of 2
};
await assert.doesNotReject(() => assertDoctorDailyCapacityAvailable("doctor1", day, "appt1"));
assert.deepEqual(countDocumentsCalls[0]._id, { $ne: "appt1" });
console.log("PASS: assertDoctorDailyCapacityAvailable enforces HospitalSetting.appointmentLimits.dailyPerDoctor and excludes the appointment's own slot when rescheduling");

// ── enforceAppointmentBookingPolicy runs all three checks in order ───────
clearHospitalSettingsCacheForTesting();
settingsDoc = { appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 } };
Appointment.countDocuments = async () => 0;
await assert.doesNotReject(() =>
  enforceAppointmentBookingPolicy({ date: tomorrow, timeSlot: "09:00-09:30", doctorId: "doctor1", now: serverNowNoon }),
);
await assert.rejects(
  () => enforceAppointmentBookingPolicy({ date: day, timeSlot: "09:00-09:30", doctorId: "doctor1", now: serverNowNoon }),
  /already passed/,
  "the past-instant check must run (and reject) before the DB-backed window/capacity checks",
);
console.log("PASS: enforceAppointmentBookingPolicy composes all three checks with past-instant checked first");

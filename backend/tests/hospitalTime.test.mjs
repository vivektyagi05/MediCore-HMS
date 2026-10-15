// Canonical hospital-time resolver — boundaries, timezone, DST, malformed input.
import assert from "node:assert/strict";
import {
  resolveAppointmentInstant, resolveAppointmentEndInstant, classifyAppointmentTime, APPOINTMENT_TIME_STATE as S,
  hospitalDateKey, hospitalToday, hospitalMinutesOfDay, resolveSlotStartMinutes, resolveSlotEndMinutes,
  zonedWallTimeToInstant, tzOffsetMinutes, isValidTimezone, resolveTimezone,
} from "../utils/hospitalTime.js";

const IST = "Asia/Kolkata";
const day = new Date("2026-09-24T00:00:00.000Z");

// IST 09:00 == 03:30Z (NOT 09:00Z — the retired UTC-digits convention)
assert.equal(resolveAppointmentInstant(day, "09:00-09:30", IST).toISOString(), "2026-09-24T03:30:00.000Z");
assert.equal(resolveAppointmentInstant(day, "09:00", IST).toISOString(), "2026-09-24T03:30:00.000Z");
// midnight slot belongs to the previous UTC day
assert.equal(resolveAppointmentInstant(day, "00:00-00:30", IST).toISOString(), "2026-09-23T18:30:00.000Z");
assert.equal(resolveAppointmentEndInstant(day, "09:00-09:45", IST).toISOString(), "2026-09-24T04:15:00.000Z");
assert.equal(resolveAppointmentEndInstant(day, "09:00", IST, 20).toISOString(), "2026-09-24T03:50:00.000Z");
// malformed
for (const bad of ["", "abc", "25:00-25:30", "09:60", undefined, null, 5]) assert.equal(resolveAppointmentInstant(day, bad, IST), null, String(bad));
assert.equal(resolveAppointmentInstant(null, "09:00", IST), null);
assert.equal(resolveAppointmentInstant("garbage", "09:00", IST), null);
assert.equal(resolveSlotEndMinutes("10:00-09:00"), null);
assert.equal(resolveSlotStartMinutes("9:05"), 545);

// hospital-local "today" at the UTC/IST boundary: 2026-09-24T19:00Z is already 2026-09-25 00:30 IST
const lateUtc = new Date("2026-09-24T19:00:00.000Z");
assert.equal(hospitalDateKey(lateUtc, IST), "2026-09-25");
assert.equal(hospitalToday(lateUtc, IST).toISOString(), "2026-09-25T00:00:00.000Z");
assert.equal(Math.round(hospitalMinutesOfDay(lateUtc, IST)), 30);
assert.equal(hospitalDateKey(new Date("2026-09-24T18:29:59.000Z"), IST), "2026-09-24");
assert.equal(hospitalDateKey(new Date("2026-09-24T18:30:00.000Z"), IST), "2026-09-25");

// Classification boundaries (slot 10:00-10:30 IST = 04:30Z–05:00Z), 3-day window
const cls = (nowIso, extra = {}) => classifyAppointmentTime({ date: day, timeSlot: "10:00-10:30", now: new Date(nowIso), tz: IST, ...extra }).state;
assert.equal(cls("2026-09-24T04:29:00.000Z"), S.UPCOMING, "1 min before");
assert.equal(cls("2026-09-24T04:30:00.000Z"), S.CURRENT, "exact start");
assert.equal(cls("2026-09-24T04:31:00.000Z"), S.CURRENT, "1 min after");
assert.equal(cls("2026-09-24T05:00:00.000Z"), S.CURRENT, "exact end inclusive");
assert.equal(cls("2026-09-24T05:01:00.000Z"), S.RECENTLY_MISSED, "1 min after end");
assert.equal(cls("2026-09-24T09:00:00.000Z"), S.RECENTLY_MISSED, "same day later");
assert.equal(cls("2026-09-25T05:00:00.000Z"), S.RECENTLY_MISSED, "1 day later");
assert.equal(cls("2026-09-26T05:00:00.000Z"), S.RECENTLY_MISSED, "2 days later");
assert.equal(cls("2026-09-27T05:00:00.000Z"), S.RECENTLY_MISSED, "exactly 3 days after end (inclusive)");
assert.equal(cls("2026-09-27T05:00:01.000Z"), S.EXPIRED, "after window");
assert.equal(cls("2026-10-04T05:00:00.000Z"), S.EXPIRED, "10 days later");
assert.equal(cls("2026-09-26T05:00:00.000Z", { resolutionWindowDays: 1 }), S.EXPIRED, "configurable window");
assert.equal(classifyAppointmentTime({ date: day, timeSlot: "weird", now: new Date(), tz: IST }).state, S.UNKNOWN);

// DST safety (America/New_York): spring-forward 2026-03-08, fall-back 2026-11-01
const NY = "America/New_York";
assert.equal(resolveAppointmentInstant(new Date("2026-03-07T00:00:00Z"), "09:00", NY).toISOString(), "2026-03-07T14:00:00.000Z"); // EST -5
assert.equal(resolveAppointmentInstant(new Date("2026-03-09T00:00:00Z"), "09:00", NY).toISOString(), "2026-03-09T13:00:00.000Z"); // EDT -4
assert.equal(resolveAppointmentInstant(new Date("2026-11-02T00:00:00Z"), "09:00", NY).toISOString(), "2026-11-02T14:00:00.000Z");
assert.equal(tzOffsetMinutes(new Date("2026-07-01T00:00:00Z"), NY), -240);
assert.equal(tzOffsetMinutes(new Date("2026-07-01T00:00:00Z"), IST), 330);
assert.equal(zonedWallTimeToInstant({ year: 2026, month: 9, day: 24, minutes: 570 }, IST).toISOString(), "2026-09-24T04:00:00.000Z");

// invalid timezone falls back to the hospital default (never throws)
assert.equal(isValidTimezone("Not/AZone"), false);
assert.equal(resolveTimezone("Not/AZone"), IST);
assert.equal(resolveAppointmentInstant(day, "09:00", "Not/AZone").toISOString(), "2026-09-24T03:30:00.000Z");
console.log("PASS: hospitalTime canonical resolver (IST, boundaries, midnight, DST, malformed)");

import assert from "node:assert/strict";
import { appointmentFitsSchedule as fits } from "../services/appointmentImpactService.js";
const avail = [{ dayOfWeek: "thursday", startTime: "11:00", endTime: "14:00", slotDurationMinutes: 30, breaks: [] }];
const a = (timeSlot, date = "2026-09-24") => ({ date: new Date(`${date}T00:00:00Z`), timeSlot }); // 2026-09-24 is a Thursday
// 09:00–14:00 shrunk to 11:00–14:00 → 09:00 now invalid, 11:00 valid
assert.equal(fits({ appointment: a("11:00-11:30"), availability: avail }).fits, true);
const early = fits({ appointment: a("09:00-09:30"), availability: avail });
assert.equal(early.fits, false); assert.match(early.reason, /outside/);
assert.equal(fits({ appointment: a("13:30-14:00"), availability: avail }).fits, true);
assert.equal(fits({ appointment: a("14:00-14:30"), availability: avail }).fits, false);
// no longer works that weekday
assert.match(fits({ appointment: a("11:00-11:30", "2026-09-25"), availability: avail }).reason, /no longer works/);
// blocked date
assert.match(fits({ appointment: a("11:00-11:30"), availability: avail, blockedDates: [{ date: new Date("2026-09-24T00:00:00Z") }] }).reason, /blocked/);
console.log("PASS: schedule-change impact detection (shrunk hours, removed weekday, blocked date)");

import assert from "node:assert/strict";
import { computeDueReminder } from "../automation/appointmentReminder.js";
const rules = { timezone: "Asia/Kolkata", reminderIntervalsMinutes: [1440, 120, 30] };
const day = new Date("2026-09-24T00:00:00.000Z"); // 10:00 IST = 04:30Z
const a = (o = {}) => ({ _id: "a1", status: "payment_completed", date: day, timeSlot: "10:00-10:30", ...o });
const due = (now, ap = a()) => computeDueReminder({ appointment: ap, now: new Date(now), rules });

assert.equal(due("2026-09-23T04:29:00Z"), null, "25h before: nothing due");
assert.equal(due("2026-09-23T04:30:00Z").interval, 1440, "exactly 24h before");
assert.equal(due("2026-09-24T02:29:00Z").interval, 1440, "just over 2h before: still only the 24h reminder");
assert.equal(due("2026-09-24T02:30:00Z").interval, 120);
assert.equal(due("2026-09-24T04:00:00Z").interval, 30);
assert.equal(due("2026-09-24T04:29:59Z").interval, 30);
assert.equal(due("2026-09-24T04:30:00Z"), null, "at start: no reminder");
assert.equal(due("2026-09-24T06:00:00Z"), null, "after start: no reminder");
// scheduler outage → only the most relevant (smallest) interval, no burst
assert.equal(due("2026-09-24T04:10:00Z").interval, 30);
// same-day appointment on the hospital date (UTC date is still the 23rd for a 00:30 IST slot)
const early = a({ timeSlot: "00:30-01:00" });
assert.equal(due("2026-09-23T18:45:00Z", early).interval, 30, "00:30 IST slot, 15 min before, on the previous UTC/IST-evening");
// never remind cancelled/completed/started/pending-approval/malformed
for (const status of ["cancelled", "completed", "consultation_started", "consultation_completed", "pending", "review_eligible"]) assert.equal(due("2026-09-24T04:00:00Z", a({ status })), null, status);
assert.equal(due("2026-09-24T04:00:00Z", a({ timeSlot: "morning" })), null);
// paid appointments ARE reminded (old code only reminded "approved")
assert.ok(due("2026-09-24T04:00:00Z", a({ status: "payment_completed" })));
// idempotent key is deterministic; RESCHEDULE changes the key (old reminders can never re-fire)
const k1 = due("2026-09-24T04:00:00Z").eventKey, k2 = due("2026-09-24T04:00:05Z").eventKey;
assert.equal(k1, k2);
const moved = a({ timeSlot: "11:00-11:30" });
assert.notEqual(due("2026-09-24T05:00:00Z", moved).eventKey, k1);
const m = due("2026-09-24T04:00:00Z", moved);
assert.equal(m.interval, 120, "after moving to 11:00 the reminder schedule restarts for the NEW instant (90 min away → 2h reminder)");
assert.ok(m.eventKey.includes("2026-09-24T05:30:00.000Z"), "key embeds the new instant");
assert.equal(due("2026-09-24T05:00:00Z", moved).interval, 30);
console.log("PASS: reminders use the canonical instant, are deterministic/idempotent, and obsolete on reschedule");

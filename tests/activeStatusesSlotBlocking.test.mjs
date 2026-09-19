// Regression test for a real bug found this session: the slot-conflict check
// (both the DB unique index in models/Appointment.js and the application-level
// checks in appointmentController.js) only covered PENDING/APPROVED, so a
// slot became re-bookable the moment the first patient's appointment moved
// into payment or beyond — even after they'd fully paid. Both now use
// ACTIVE_STATUSES. This test locks in that ACTIVE_STATUSES actually contains
// every status where a slot must stay blocked.
import { ACTIVE_STATUSES, APPOINTMENT_STATUS, TERMINAL_STATUSES } from "../constants/appointmentStatus.js";
import assert from "assert";

// Every status up to (but not including) the review-eligible/completed end
// state must block the slot — a doctor still owes a consultation for it.
const mustBlockSlot = [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.APPROVED,
  APPOINTMENT_STATUS.PAYMENT_PENDING,
  APPOINTMENT_STATUS.PAYMENT_COMPLETED,
  APPOINTMENT_STATUS.CONSULTATION_STARTED,
];

for (const status of mustBlockSlot) {
  assert.ok(ACTIVE_STATUSES.includes(status), `ACTIVE_STATUSES must include "${status}" or the slot becomes double-bookable`);
}
console.log("PASS: every pre-completion status blocks the slot");

// A CANCELLED appointment must NOT block the slot — the whole point of
// cancelling is to free it back up.
assert.ok(!ACTIVE_STATUSES.includes(APPOINTMENT_STATUS.CANCELLED));
console.log("PASS: cancelled does not block the slot (frees it back up)");

console.log("ALL ACTIVE-STATUSES SLOT-BLOCKING TESTS PASSED");

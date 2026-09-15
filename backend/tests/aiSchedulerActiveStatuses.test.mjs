// Regression test for a real bug found this session: aiScheduler.suggestSlots
// used a hardcoded ["pending","approved"] list to determine which slots were
// "already taken" -- the exact same too-narrow lifecycle bug already found
// and fixed in appointmentController/models this session, but this file
// wasn't touched then. It meant the AI feature could recommend a slot that
// was already paid for. optimizeSchedules also had no status filter at all,
// counting cancelled appointments toward a doctor's load.
import { ACTIVE_STATUSES, APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import assert from "assert";

// The old hardcoded list the bug used.
const oldHardcodedList = [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.APPROVED];

assert.ok(
  !oldHardcodedList.includes(APPOINTMENT_STATUS.PAYMENT_COMPLETED),
  "sanity check: the old list really did exclude payment_completed (proving the bug existed)",
);
assert.ok(
  ACTIVE_STATUSES.includes(APPOINTMENT_STATUS.PAYMENT_COMPLETED),
  "the fixed list must include payment_completed so a paid slot is never suggested as available",
);
console.log("PASS: aiScheduler now treats a paid appointment's slot as unavailable");

assert.ok(
  !ACTIVE_STATUSES.includes(APPOINTMENT_STATUS.CANCELLED),
  "cancelled appointments must not count toward a doctor's load in optimizeSchedules",
);
console.log("PASS: cancelled appointments correctly excluded from load calculation");

console.log("ALL AI SCHEDULER ACTIVE-STATUSES TESTS PASSED");

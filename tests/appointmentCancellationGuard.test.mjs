// PHASE UI-3 audit finding: cancelAppointment previously decided
// "cancellable" from a separately-maintained TERMINAL_STATUSES list, which
// had drifted out of sync with STATUS_TRANSITIONS (STATUS_TRANSITIONS never
// allows consultation_started -> cancelled, but TERMINAL_STATUSES never
// flagged consultation_started as terminal either, so the old check let a
// consultation in progress be unilaterally cancelled). CANCELLABLE_STATUSES
// is now derived FROM STATUS_TRANSITIONS so the two can never diverge again.
import assert from "assert";
import {
  APPOINTMENT_STATUS,
  CANCELLABLE_STATUSES,
  STATUS_TRANSITIONS,
} from "../constants/appointmentStatus.js";

// Every status whose STATUS_TRANSITIONS list includes CANCELLED must be in
// CANCELLABLE_STATUSES, and vice versa -- this is what "derived from, not
// hand-copied" actually guarantees.
for (const [status, targets] of Object.entries(STATUS_TRANSITIONS)) {
  const shouldBeCancellable = targets.includes(APPOINTMENT_STATUS.CANCELLED);
  assert.strictEqual(
    CANCELLABLE_STATUSES.includes(status),
    shouldBeCancellable,
    `CANCELLABLE_STATUSES disagrees with STATUS_TRANSITIONS for status "${status}"`,
  );
}
console.log("PASS: CANCELLABLE_STATUSES exactly matches STATUS_TRANSITIONS' cancellable set");

// The specific bug: a consultation already in progress must NOT be cancellable.
assert.ok(
  !CANCELLABLE_STATUSES.includes(APPOINTMENT_STATUS.CONSULTATION_STARTED),
  "consultation_started must not be cancellable (regression guard)",
);
console.log("PASS: consultation_started is correctly excluded from CANCELLABLE_STATUSES");

// The statuses that genuinely should remain cancellable.
for (const status of [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.APPROVED,
  APPOINTMENT_STATUS.PAYMENT_PENDING,
  APPOINTMENT_STATUS.PAYMENT_COMPLETED,
]) {
  assert.ok(CANCELLABLE_STATUSES.includes(status), `${status} should still be cancellable`);
}
console.log("PASS: pending/approved/payment_pending/payment_completed remain cancellable");

// Terminal / already-cancelled states must never be cancellable.
for (const status of [
  APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
  APPOINTMENT_STATUS.CANCELLED,
]) {
  assert.ok(!CANCELLABLE_STATUSES.includes(status), `${status} should not be cancellable`);
}
console.log("PASS: terminal/cancelled statuses remain non-cancellable");

console.log("ALL APPOINTMENT CANCELLATION GUARD TESTS PASSED");

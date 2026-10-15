import assert from "assert";
import { WITHDRAWAL_TRANSITIONS, assertWithdrawalTransition, RESERVATION_HOLDING_STATES } from "../payments/withdrawalStateMachine.js";
import { WITHDRAWAL_STATUS } from "../models/Withdrawal.js";

// Manual settlement is only reachable through manual_pending (or legacy processing / review).
for (const from of ["requested", "reserved", "failed", "cancelled", "retry_required"]) {
  assert.throws(() => assertWithdrawalTransition(from, "manual_completed"), /Invalid withdrawal state transition/, `${from} -> manual_completed must be illegal`);
}
for (const from of ["manual_pending", "processing", "reconciliation_required"]) assertWithdrawalTransition(from, "manual_completed");
assertWithdrawalTransition("reserved", "manual_pending");
assert.throws(() => assertWithdrawalTransition("manual_completed", "failed"), /Invalid/, "a settled withdrawal cannot be failed (no double release)");
assert.deepStrictEqual(WITHDRAWAL_TRANSITIONS.cancelled, []);
// States that hold balance must exclude the terminal released ones.
assert.ok(!RESERVATION_HOLDING_STATES.includes("failed") && !RESERVATION_HOLDING_STATES.includes("cancelled") && !RESERVATION_HOLDING_STATES.includes("manual_completed"));
assert.ok(Object.values(WITHDRAWAL_STATUS).includes("manual_completed"));
console.log("PASS: withdrawal manual-settlement state machine");
process.exit(0);

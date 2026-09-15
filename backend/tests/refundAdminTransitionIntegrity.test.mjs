// P23 Section 18 — refund admin controller transitions must be validated
// through the real state machine using the ACTUAL current refundState,
// never a hardcoded assumed predecessor. Pure-logic tests against
// refundStateMachine.js reproducing exactly what refundController.js now
// checks before its atomic updates.
import assert from "assert";
import { assertRefundTransition, REFUND_STATES } from "../payments/refundStateMachine.js";

// --- approveRefundRequest: both real predecessors of "approved" must
// validate correctly — the old hardcoded "pending_review" would have
// silently mis-recorded a request that was actually still
// "eligibility_checked". ---
{
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.ELIGIBILITY_CHECKED, REFUND_STATES.APPROVED));
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.PENDING_REVIEW, REFUND_STATES.APPROVED));
  console.log("PASS: approve is valid from both real predecessor states, not just the hardcoded one");
}

// --- rejectRefundRequest: same reasoning for rejection's real
// predecessors. ---
{
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.REQUESTED, REFUND_STATES.REJECTED));
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.ELIGIBILITY_CHECKED, REFUND_STATES.REJECTED));
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.PENDING_REVIEW, REFUND_STATES.REJECTED));
  console.log("PASS: reject is valid from every real predecessor state");
}

// --- retryRefundRequest: the OLD bug was a direct failed -> approved jump
// with a hardcoded (and never validated) "from: retry_required" history
// entry. The real legal path is the two-hop failed -> retry_required ->
// approved, and failed -> approved directly must NOT be legal. ---
{
  assert.throws(
    () => assertRefundTransition(REFUND_STATES.FAILED, REFUND_STATES.APPROVED),
    /Invalid refund state transition/,
    "failed must never jump directly to approved — this is exactly the fabricated-history bug",
  );
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.FAILED, REFUND_STATES.RETRY_REQUIRED));
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.RETRY_REQUIRED, REFUND_STATES.APPROVED));
  console.log("PASS: retry is only legal as the real two-hop failed -> retry_required -> approved chain");
}

console.log("All refundAdminTransitionIntegrity tests passed.");

// P23 Section 18 — refundController.js's approve/reject/retry handlers
// previously hardcoded a "from" state in the recorded stateHistory
// (e.g. always claiming `from: "pending_review"` for approve, or jumping
// straight from "failed" to "approved" while claiming the history went
// through "retry_required") without ever calling assertRefundTransition.
// These pure-logic tests exercise the real state machine directly to prove
// the transitions the controller now performs are legal, and that the
// specific fabricated-history bug (failed -> approved with no real
// retry_required hop) is caught.
import assert from "assert";
import { assertRefundTransition, REFUND_STATES } from "../payments/refundStateMachine.js";

// --- Both real predecessors of "approved" that the old code's hardcoded
// "pending_review" would have silently mismatched for. ---
{
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.ELIGIBILITY_CHECKED, REFUND_STATES.APPROVED));
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.PENDING_REVIEW, REFUND_STATES.APPROVED));
  console.log("PASS: both real predecessor states of 'approved' validate correctly");
}

// --- The exact bug in the old retryRefundRequest: failed -> approved is
// NOT a legal single hop. It must go through retry_required. ---
{
  assert.throws(
    () => assertRefundTransition(REFUND_STATES.FAILED, REFUND_STATES.APPROVED),
    /Invalid refund state transition/,
    "failed -> approved directly must be rejected — retry_required is a real, required hop",
  );
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.FAILED, REFUND_STATES.RETRY_REQUIRED));
  assert.doesNotThrow(() => assertRefundTransition(REFUND_STATES.RETRY_REQUIRED, REFUND_STATES.APPROVED));
  console.log("PASS: retry must go failed -> retry_required -> approved, not a fabricated direct hop");
}

// --- Rejection is only legal from a real pre-decision state. ---
{
  for (const from of [REFUND_STATES.REQUESTED, REFUND_STATES.ELIGIBILITY_CHECKED, REFUND_STATES.PENDING_REVIEW]) {
    assert.doesNotThrow(() => assertRefundTransition(from, REFUND_STATES.REJECTED));
  }
  assert.throws(() => assertRefundTransition(REFUND_STATES.PROCESSED, REFUND_STATES.REJECTED), /Invalid/, "a processed refund can never be rejected after the fact");
  console.log("PASS: rejection only legal from real pre-decision states, never after processing");
}

console.log("All refundStateMachineValidatedTransitions tests passed.");

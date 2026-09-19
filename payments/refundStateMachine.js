export const REFUND_STATES = Object.freeze({
  REQUESTED: "requested",
  ELIGIBILITY_CHECKED: "eligibility_checked",
  PENDING_REVIEW: "pending_review",
  APPROVED: "approved",
  REFUND_INITIATED: "refund_initiated",
  GATEWAY_PROCESSING: "gateway_processing",
  PROCESSED: "processed",
  REJECTED: "rejected",
  FAILED: "failed",
  RETRY_REQUIRED: "retry_required",
  RECONCILIATION_REQUIRED: "reconciliation_required",
});

export const REFUND_TRANSITIONS = Object.freeze({
  requested: ["eligibility_checked", "rejected"],
  eligibility_checked: ["pending_review", "approved", "rejected"],
  pending_review: ["approved", "rejected"],
  approved: ["refund_initiated", "gateway_processing", "failed", "retry_required"],
  refund_initiated: ["gateway_processing", "failed", "retry_required"],
  gateway_processing: ["processed", "failed", "reconciliation_required"],
  processed: [],
  rejected: [],
  failed: ["retry_required", "reconciliation_required"],
  retry_required: ["approved", "refund_initiated", "reconciliation_required"],
  reconciliation_required: ["processed", "failed", "retry_required"],
});

export const assertRefundTransition = (from, to) => {
  if (from === to) return true;
  if (!(REFUND_TRANSITIONS[from] || []).includes(to)) {
    const error = new Error(`Invalid refund state transition: ${from} -> ${to}`); error.statusCode = 409; throw error;
  }
  return true;
};

// P23 (Section 16) — mirrors paymentStateMachine.appendPaymentTransition so
// RefundRequest.refundState mutations are never a bare field assignment.
// AUDIT FINDING: refundController.js imported neither this module nor
// paymentStateMachine.js at all — every refundState/status write in the
// controller was a direct, unvalidated assignment. This is the one
// canonical mutation path every caller must now go through.
export const appendRefundTransition = (refundRequest, to, { actorId = null, source = "system", reason = null } = {}) => {
  const from = refundRequest.refundState || REFUND_STATES.REQUESTED;
  assertRefundTransition(from, to);
  if (from !== to) {
    refundRequest.refundState = to;
    refundRequest.stateHistory = refundRequest.stateHistory || [];
    refundRequest.stateHistory.push({ from, to, actorId, source, reason, at: new Date() });
  }
  return refundRequest;
};

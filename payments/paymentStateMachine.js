export const PAYMENT_STATES = Object.freeze({
  CREATED: "created",
  ORDER_CREATED: "order_created",
  CHECKOUT_STARTED: "checkout_started",
  PENDING: "pending",
  AUTHORIZED: "authorized",
  CAPTURED: "captured",
  VERIFICATION_PENDING: "verification_pending",
  POST_PROCESSING: "post_processing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  POST_PROCESSING_FAILED: "post_processing_failed",
  PARTIALLY_REFUNDED: "partially_refunded",
  REFUNDED: "refunded",
});

export const PAYMENT_TRANSITIONS = Object.freeze({
  created: ["order_created", "cancelled", "expired"],
  order_created: ["checkout_started", "pending", "failed", "cancelled", "expired", "verification_pending"],
  checkout_started: ["pending", "authorized", "captured", "failed", "cancelled", "expired", "verification_pending"],
  pending: ["authorized", "captured", "failed", "cancelled", "expired", "verification_pending", "reconciliation_required"],
  authorized: ["captured", "failed", "verification_pending", "reconciliation_required"],
  captured: ["post_processing", "partially_refunded", "refunded", "post_processing_failed", "reconciliation_required"],
  verification_pending: ["captured", "failed", "reconciliation_required"],
  post_processing: ["completed", "post_processing_failed", "reconciliation_required", "partially_refunded", "refunded"],
  post_processing_failed: ["post_processing", "reconciliation_required", "partially_refunded", "refunded"],
  completed: ["partially_refunded", "refunded", "reconciliation_required"],
  // "order_created" added to both (Section 6 — Retry): a failed/expired
  // attempt is not the end of the road, the SAME payment gets a genuinely
  // new gateway order + PaymentAttempt on retry (paymentController.retryPayment),
  // never a second Payment document for the same appointment.
  failed: ["pending", "verification_pending", "reconciliation_required", "cancelled", "expired", "order_created"],
  cancelled: [],
  expired: ["reconciliation_required", "order_created"],
  reconciliation_required: ["pending", "captured", "post_processing", "completed", "failed", "partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded", "reconciliation_required"],
  refunded: ["reconciliation_required"],
});

export const assertPaymentTransition = (from, to) => {
  if (from === to) return true;
  if (!(PAYMENT_TRANSITIONS[from] || []).includes(to)) {
    const error = new Error(`Invalid payment state transition: ${from} -> ${to}`); error.statusCode = 409; throw error;
  }
  return true;
};

export const appendPaymentTransition = (payment, to, { actorId = null, source = "system", reason = null } = {}) => {
  const from = payment.status;
  assertPaymentTransition(from, to);
  if (from === to) return payment;
  payment.status = to;
  payment.stateHistory = payment.stateHistory || [];
  payment.stateHistory.push({ from, to, actorId, source, reason, at: new Date() });
  return payment;
};

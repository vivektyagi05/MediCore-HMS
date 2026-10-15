// Truthful interpretation of what a payment provider told us about a refund.
// A refund call that merely did not throw is NOT a completed refund.
export const GATEWAY_REFUND_OUTCOME = Object.freeze({
  PROCESSED: "processed",
  PENDING: "pending",
  FAILED: "failed",
  UNKNOWN: "unknown",
});

/** Classify the provider's refund entity (Razorpay: pending | processed | failed). */
export const classifyGatewayRefund = (refund) => {
  const status = String(refund?.status || "").trim().toLowerCase();
  if (!refund?.id) return GATEWAY_REFUND_OUTCOME.UNKNOWN;
  if (status === "processed") return GATEWAY_REFUND_OUTCOME.PROCESSED;
  if (status === "pending" || status === "created") return GATEWAY_REFUND_OUTCOME.PENDING;
  if (status === "failed") return GATEWAY_REFUND_OUTCOME.FAILED;
  return GATEWAY_REFUND_OUTCOME.UNKNOWN;
};

/**
 * A thrown error is a DEFINITIVE rejection only when the provider answered
 * with a 4xx. Timeouts, resets, 5xx and unparseable failures are AMBIGUOUS:
 * the provider may have created the refund, so blind retry could double-refund
 * and the request must go to reconciliation instead.
 */
export const isDefinitiveGatewayRejection = (error) => {
  const status = Number(error?.statusCode ?? error?.response?.status ?? error?.error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500;
};

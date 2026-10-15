import Payment from "../models/Payment.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { recordCaptureEvidence, transitionPayment } from "./paymentTransitions.js";

// Effective states from which a verified provider capture may be recorded.
// "failed" is included on purpose: a late capture after a reported failure is
// real money (a Razorpay order can still be paid after a payment.failed event).
// expired/cancelled are NOT claimable (the machine forbids captured there); a
// real capture on them is preserved as evidence and routed to reconciliation.
export const CAPTURABLE_STATES = Object.freeze([
  "created", "order_created", "checkout_started", "pending", "authorized",
  "verification_pending", "reconciliation_required", "failed",
]);

/**
 * Atomically claim the capture of a payment. Browser verification, the
 * payment.captured webhook and reconciliation all converge here: exactly one
 * caller flips the document (`won: true`); every other caller observes the
 * already-captured document (`won: false`) and must treat it as an idempotent
 * replay. The previous state written to history is the REAL previous state.
 *
 * `attempt` (optional) is the PaymentAttempt whose gateway order was actually
 * paid. Recording it matters when a newer order exists: the capture belongs to
 * the paid attempt, not to "whatever order is latest on the Payment".
 */
export const claimPaymentCapture = async ({ payment, attempt = null, gatewayPaymentId, signature, source, reason, paidAt = new Date() }) => {
  const set = {
    reconciliationState: "matched",
    paymentId: gatewayPaymentId,
    gatewayPaymentId,
    paidAt,
    postProcessingState: "pending",
  };
  if (signature) set.signature = signature;
  if (attempt) {
    set.capturedAttemptNumber = attempt.attemptNumber;
    set.capturedGatewayOrderId = attempt.gatewayOrderId;
  }
  const result = await transitionPayment({
    paymentId: payment._id,
    to: "captured",
    status: "captured",
    from: CAPTURABLE_STATES,
    set,
    source,
    reason,
  });
  const current = await Payment.findById(payment._id).select("+signature");
  if (result.outcome === "applied") return { payment: current, won: true, previous: result.previous };
  return { payment: current, won: false, rejected: result.reason || result.outcome };
};

/** Marks the paid attempt captured (idempotent; never un-captures). */
export const markAttemptCaptured = async ({ paymentId, gatewayOrderId, gatewayPaymentId }) =>
  PaymentAttempt.findOneAndUpdate(
    { paymentId, gatewayOrderId, status: { $ne: "captured" } },
    { $set: { status: "captured", gatewayPaymentId, completedAt: new Date() } },
    { returnDocument: "after" },
  );

/**
 * After a capture is won on attempt N, any OTHER still-open attempt can no
 * longer be used to fulfil this payment. They are marked superseded (their
 * orders may still be payable at the provider; a later capture there is routed
 * to reconciliation by the duplicate-capture path, never silently dropped).
 */
export const supersedeOpenAttempts = async ({ paymentId, exceptGatewayOrderId }) =>
  PaymentAttempt.updateMany(
    { paymentId, gatewayOrderId: { $ne: exceptGatewayOrderId }, status: { $in: ["created", "checkout_started", "authorized", "verification_pending"] } },
    { $set: { status: "superseded", completedAt: new Date(), failureReason: "Superseded by a captured attempt" } },
  );

/**
 * A verified capture that cannot complete this payment (a different provider
 * payment already captured it, or the payment is cancelled/expired). Never
 * discarded: preserved as evidence and flagged for the explicit recovery path.
 */
export const preserveUnapplicableCapture = async ({ payment, attempt, entity, source, disposition, flag = true }) =>
  recordCaptureEvidence({
    paymentId: payment._id,
    flagReconciliation: flag,
    evidence: {
      gatewayOrderId: entity.order_id || attempt?.gatewayOrderId,
      gatewayPaymentId: entity.id,
      attemptNumber: attempt?.attemptNumber,
      amountPaise: Number.isFinite(Number(entity.amount)) ? Number(entity.amount) : undefined,
      currency: entity.currency ? String(entity.currency).toUpperCase() : undefined,
      source,
      disposition,
    },
  });

// Phase 01 — the ONE way a provider-reported failure is applied.
// Used by the payment.failed webhook AND by browser verification when the
// provider reports the payment as failed, so both obey the same rules:
//   * attempt-aware: only the exact attempt named by the event is failed;
//   * a failure for an OLD attempt never fails the payment's current order;
//   * a captured payment is never downgraded (compare-and-set refuses it);
//   * a duplicate failure appends no history, counts nothing, schedules nothing;
//   * retry is triggered only after a transition that actually applied, and
//     only through the canonical retry-claim service.
import Payment from "../models/Payment.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { paymentRetryService, MAX_RETRIES } from "./paymentRetryService.js";
import { OPEN_ATTEMPT_STATUSES } from "./paymentAttemptService.js";
import { PRE_CAPTURE_STATES, isCaptureConfirmed, transitionPayment } from "./paymentTransitions.js";
import { paymentDeps } from "./paymentDeps.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { logger } from "../utils/logger.js";

export const safeFailureText = (entity = {}) => {
  const code = typeof entity.error_code === "string" ? entity.error_code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) : "";
  return { code, reason: code ? `Gateway reported payment failed (${code})` : "Gateway reported payment failed" };
};

/**
 * @param {{payment:object, attempt:object|null, isCurrent:boolean}} resolved result of resolveGatewayOrder (kind "payment")
 * @returns {Promise<string>} outcome code
 */
export const applyGatewayFailure = async ({ resolved, orderId, entity = {}, source }) => {
  const { payment, attempt } = resolved;
  const { code, reason } = safeFailureText(entity);

  // A captured payment is never touched by a failure, and its attempt is not
  // marked failed either (the capture may belong to that very attempt).
  if (isCaptureConfirmed(payment)) return "ignored_after_capture";

  if (attempt) {
    await PaymentAttempt.updateOne(
      { _id: attempt._id, status: { $in: OPEN_ATTEMPT_STATUSES } },
      { $set: { status: "failed", completedAt: new Date(), failureReason: reason, failureCode: code || undefined } },
    );
  }
  // An old attempt failing must never fail the payment's CURRENT order.
  if (!resolved.isCurrent) return "stale_attempt_failed";

  const result = await transitionPayment({
    paymentId: payment._id,
    to: "failed",
    status: "failed",
    from: PRE_CAPTURE_STATES,
    filter: { $or: [{ gatewayOrderId: orderId }, { razorpayOrderId: orderId }] },
    guard: (doc) => doc.gatewayOrderId === orderId || doc.razorpayOrderId === orderId,
    set: { failedAt: new Date(), reconciliationState: "matched", nextRetryAt: new Date() },
    source,
    reason,
  });

  if (result.outcome === "applied") {
    if ((result.payment.retryCount || 0) >= MAX_RETRIES) {
      // Retries exhausted: release the appointment's single payment slot so the
      // patient is not blocked forever. A late capture on this payment is still
      // preserved by the capture path.
      await Payment.updateOne({ _id: payment._id }, { $unset: { activeAppointmentSlot: "" } });
    } else {
      try {
        await paymentRetryService.scheduleFailedPayment(payment._id, { source });
      } catch (error) {
        // The failure itself is committed; the retry cron recovers from nextRetryAt.
        logger.warn("Immediate retry after a reported failure did not complete; cron will retry", { paymentId: String(payment._id), message: error?.message });
      }
    }
    await paymentDeps.emit(TRIGGER_TYPES.PAYMENT_FAILED, { paymentId: payment._id, userId: payment.userId, amount: payment.amount });
    return "failed";
  }
  if (result.outcome === "noop") return "duplicate_failure";
  if (result.outcome === "rejected") return result.reason === "capture_protected" ? "ignored_after_capture" : "ignored_ineligible";
  if (result.outcome === "not_found") return "ignored_unknown_order";
  throw new Error("Payment state changed concurrently while applying the failure; will retry");
};

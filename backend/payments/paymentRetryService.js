import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { randomUUID } from "crypto";
import { openGatewayOrder, reserveAttempt } from "./paymentAttemptService.js";
import { transitionPayment } from "./paymentTransitions.js";
import { logger } from "../utils/logger.js";

export const MAX_RETRIES = 3;
export const RETRY_LEASE_MS = 10 * 60 * 1000;

/**
 * Exported for tests: the one predicate every retry path (cron, admin,
 * webhook, patient) goes through. Captured/completed/refunded/cancelled
 * payments can never match: only failed (and, for an explicit patient/admin
 * retry, expired) payments are retryable.
 */
export const buildRetryClaimFilter = ({ paymentId, now = new Date(), allowExpired = false, userId = null }) => ({
  _id: paymentId,
  status: allowExpired ? { $in: [PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED] } : PAYMENT_STATUS.FAILED,
  retryCount: { $lt: MAX_RETRIES },
  // A retry order that is still awaiting checkout (legacy shape: status failed +
  // paymentState pending) must not be superseded by another order.
  paymentState: { $ne: "pending" },
  ...(userId ? { userId } : {}),
  $or: [
    { retryClaimedAt: { $exists: false } },
    { retryClaimedAt: null },
    { retryClaimedAt: { $lt: new Date(now.getTime() - RETRY_LEASE_MS) } },
  ],
});

export const paymentRetryService = {
  /**
   * F-006: atomically takes the right to retry a payment. Exactly one caller
   * (cron, admin, webhook or patient) can win; everyone else gets null. The
   * returned document carries a fencing token: only the holder of THAT token
   * can later commit the new order pointer, so a worker whose lease expired
   * cannot overwrite a newer order.
   */
  async claimRetry(paymentId, { now = new Date(), allowExpired = false, userId = null } = {}) {
    return Payment.findOneAndUpdate(
      buildRetryClaimFilter({ paymentId, now, allowExpired, userId }),
      { $set: { retryClaimedAt: now, retryClaimToken: randomUUID() } },
      { returnDocument: "after" },
    );
  },

  async releaseRetryClaim(paymentId, token, { backoffMs = 0 } = {}) {
    const update = { $unset: { retryClaimedAt: "", retryClaimToken: "" } };
    if (backoffMs) update.$set = { nextRetryAt: new Date(Date.now() + backoffMs) };
    await Payment.updateOne({ _id: paymentId, ...(token ? { retryClaimToken: token } : {}) }, update);
  },

  /**
   * Creates the next attempt+order for a failed payment. Returns the updated
   * payment (with `lastAttempt` attached non-persistently via the return value
   * shape { payment, attempt, order }) or null when not eligible / lost the claim.
   */
  async scheduleFailedPayment(paymentId, { source = "retry", actorId = null, allowExpired = false, userId = null, now = new Date() } = {}) {
    const result = await this.createRetryAttempt(paymentId, { source, actorId, allowExpired, userId, now });
    return result ? result.payment : null;
  },

  async createRetryAttempt(paymentId, { source = "retry", actorId = null, allowExpired = false, userId = null, now = new Date() } = {}) {
    const claimed = await this.claimRetry(paymentId, { now, allowExpired, userId });
    if (!claimed) return null; // not eligible, or another worker already holds the claim
    const token = claimed.retryClaimToken;

    let attempt;
    try {
      attempt = await reserveAttempt({ payment: claimed });
      const opened = await openGatewayOrder({
        payment: claimed,
        attempt,
        notes: { retryOfPaymentId: String(claimed._id), retryAttempt: String(attempt.attemptNumber), source },
      });
      if (opened.orphan) {
        await this.releaseRetryClaim(paymentId, token);
        return null;
      }
      const order = opened.order;
      const committed = await transitionPayment({
        paymentId: claimed._id,
        to: "pending",
        status: PAYMENT_STATUS.PENDING,
        from: ["failed", "expired"],
        // Fence: only the lease holder may commit the pointer.
        filter: { retryClaimToken: token },
        set: {
          // Backoff so the cron does not immediately pick this payment up again
          // while the patient is still expected to complete the new order.
          nextRetryAt: new Date(now.getTime() + RETRY_LEASE_MS * attempt.attemptNumber),
          gatewayOrderId: order.id,
          razorpayOrderId: order.id,
          reconciliationState: "not_required",
          activeAppointmentSlot: true,
        },
        unset: { retryClaimedAt: "", retryClaimToken: "" },
        inc: { retryCount: 1 },
        source,
        actorId,
        reason: `Retry attempt ${attempt.attemptNumber} created`,
      });
      if (committed.outcome !== "applied") {
        // Our lease expired (or the payment moved on, e.g. it was captured) before
        // we could commit. The order was never exposed; close the attempt so the
        // record is explicit. A newer worker's order pointer is untouched.
        await PaymentAttempt.updateOne(
          { _id: attempt._id, status: "created" },
          { $set: { status: "superseded", completedAt: new Date(), failureReason: "Retry lease lost before the order was committed" } },
        );
        logger.warn("Retry claim lost before commit; order recorded on attempt only", { paymentId: String(paymentId), orderId: order.id, outcome: committed.outcome, reason: committed.reason });
        return null;
      }
      return { payment: committed.payment, attempt: opened.attempt, order };
    } catch (error) {
      // Fenced release: if our lease already expired this does not touch the new holder.
      await this.releaseRetryClaim(paymentId, token, { backoffMs: RETRY_LEASE_MS / 2 }).catch(() => {});
      logger.error("Payment retry failed; claim released", { paymentId: String(paymentId), message: error?.message });
      throw error;
    }
  },

  /** Sequential and per-payment isolated: one failure no longer rejects the whole batch (A3). */
  async retryDuePayments({ batchSize = 100 } = {}) {
    const due = await Payment.find({
      status: PAYMENT_STATUS.FAILED,
      retryCount: { $lt: MAX_RETRIES },
      nextRetryAt: { $lte: new Date() },
      paymentState: { $ne: "pending" },
    }).select("_id").sort({ _id: 1 }).limit(batchSize).lean();
    const results = [];
    for (const { _id } of due) {
      try {
        results.push(await this.scheduleFailedPayment(_id, { source: "cron" }));
      } catch {
        results.push(null);
      }
    }
    return results;
  },
};

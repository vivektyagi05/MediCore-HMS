import crypto from "crypto";
import Payment from "../models/Payment.js";
import { AppError } from "../middleware/errorMiddleware.js";

// Phase 03: the per-payment refund lock is now a LEASE with a fencing token.
// Before this change `refundLockedAt` never expired: a process crash between
// acquire and release left the payment permanently un-refundable (every later
// approve/retry/webhook/reconcile got a 409 forever). A stale lease can now be
// taken over, and release only succeeds for the token that acquired it, so a
// slow ex-holder can never free a newer holder's lock.
//
// Taking over a stale lease does NOT retry a refund: an interrupted gateway
// call leaves the RefundRequest in gateway_processing / reconciliation_required,
// which is resolved by asking the provider (reconcileRefundRequest), never by
// blindly issuing another refund.
export const REFUND_LOCK_LEASE_MS = 5 * 60 * 1000;

/** Pure: the conditional-update filter that grants the lock (exported for tests). */
export const buildRefundLockFilter = ({ paymentId, now = new Date(), leaseMs = REFUND_LOCK_LEASE_MS }) => ({
  _id: paymentId,
  $or: [
    { refundLockedAt: { $exists: false } },
    { refundLockedAt: null },
    { refundLockedAt: { $lt: new Date(now.getTime() - leaseMs) } },
  ],
});

/** Pure: true when a held lease has expired and may be taken over. */
export const isRefundLockStale = (refundLockedAt, { now = new Date(), leaseMs = REFUND_LOCK_LEASE_MS } = {}) =>
  Boolean(refundLockedAt) && new Date(refundLockedAt).getTime() < now.getTime() - leaseMs;

export const acquireRefundLock = async (paymentId, { now = new Date(), leaseMs = REFUND_LOCK_LEASE_MS } = {}) => {
  const token = crypto.randomUUID();
  const locked = await Payment.findOneAndUpdate(
    buildRefundLockFilter({ paymentId, now, leaseMs }),
    { $set: { refundLockedAt: now, refundLockToken: token } },
    { returnDocument: "after" },
  );
  if (!locked) {
    throw new AppError(
      "Another refund operation is already in progress for this payment. Please try again in a moment.",
      409,
    );
  }
  return token;
};

/** Fenced release: only the holder of `token` can free the lock. */
export const releaseRefundLock = async (paymentId, token) => {
  if (!token) return { released: false };
  const result = await Payment.updateOne(
    { _id: paymentId, refundLockToken: token },
    { $unset: { refundLockedAt: 1, refundLockToken: 1 } },
  );
  return { released: result.modifiedCount === 1 };
};

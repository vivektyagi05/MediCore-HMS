import Coupon from "../models/Coupon.js";
import { AppError } from "../middleware/errorMiddleware.js";

const idString = (value) => (value === undefined || value === null ? "" : value.toString());

/**
 * Pure explanation of why an atomic claim matched nothing. Kept free of I/O so
 * the business rules can be unit-tested without MongoDB. The ORDER matters: it
 * mirrors the order the preview validation reports errors in.
 */
export const classifyClaimFailure = (coupon, { userId, paymentId, now = new Date() }) => {
  if (!coupon || coupon.isActive === false) return { code: "COUPON_INVALID", status: 400, message: "Invalid coupon code" };
  if (coupon.usedBy?.some((entry) => idString(entry.paymentId) === idString(paymentId))) {
    return { code: "COUPON_ALREADY_CLAIMED_FOR_PAYMENT", status: 200, alreadyClaimed: true };
  }
  if (new Date(coupon.expiresAt) <= now) return { code: "COUPON_EXPIRED", status: 400, message: "Coupon has expired" };
  if (coupon.userId && idString(coupon.userId) !== idString(userId)) {
    return { code: "COUPON_WRONG_USER", status: 403, message: "Coupon is not valid for this user" };
  }
  if (coupon.usedBy?.some((entry) => idString(entry.userId) === idString(userId))) {
    return { code: "COUPON_ALREADY_USED_BY_USER", status: 409, message: "Coupon already used by this user" };
  }
  if (coupon.usedCount >= coupon.usageLimit) return { code: "COUPON_LIMIT_REACHED", status: 400, message: "Coupon usage limit reached" };
  return { code: "COUPON_CLAIM_CONFLICT", status: 409, message: "Coupon could not be reserved; please retry" };
};

/** The single atomic predicate that makes over-use impossible (exported for tests). */
export const buildClaimFilter = ({ couponId, userId, paymentId, now = new Date() }) => ({
  _id: couponId,
  isActive: true,
  expiresAt: { $gt: now },
  $expr: { $lt: ["$usedCount", "$usageLimit"] },
  "usedBy.paymentId": { $ne: paymentId },
  "usedBy.userId": { $ne: userId },
  $or: [{ userId: { $exists: false } }, { userId: null }, { userId }],
});

export const couponService = {
  /** Preview only. NOT a reservation: the authoritative check is claim(). */
  async validateAndCalculate({ code, userId, appointmentId, amount }) {
    if (!code) return { discountAmount: 0, coupon: null };

    const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
    if (!coupon) throw new AppError("Invalid coupon code", 400);
    if (coupon.expiresAt < new Date()) throw new AppError("Coupon has expired", 400);
    if (coupon.usedCount >= coupon.usageLimit) throw new AppError("Coupon usage limit reached", 400);
    if (coupon.userId && coupon.userId.toString() !== userId.toString()) throw new AppError("Coupon is not valid for this user", 403);
    if (coupon.appointmentId && coupon.appointmentId.toString() !== appointmentId.toString()) throw new AppError("Coupon is not valid for this appointment", 403);
    if (coupon.usedBy.some((entry) => entry.userId.toString() === userId.toString())) throw new AppError("Coupon already used by this user", 409);

    const rawDiscount = coupon.type === "percentage" ? (amount * coupon.value) / 100 : coupon.value;
    const discountAmount = Number(Math.min(rawDiscount, coupon.maxDiscount || rawDiscount, amount).toFixed(2));
    return { discountAmount, coupon };
  },

  /**
   * F-005: atomic reservation. One conditional findOneAndUpdate both checks the
   * limit and increments it, so two concurrent users can never exceed usageLimit.
   * Idempotent per paymentId: re-claiming for the same payment is a no-op.
   * Returns { claimed, alreadyClaimed }. Throws AppError when the coupon is not claimable.
   */
  async claim({ coupon, userId, paymentId }) {
    if (!coupon) return { claimed: false, alreadyClaimed: false };
    const now = new Date();
    const updated = await Coupon.findOneAndUpdate(
      buildClaimFilter({ couponId: coupon._id, userId, paymentId, now }),
      { $inc: { usedCount: 1 }, $push: { usedBy: { userId, paymentId, usedAt: now } } },
      { returnDocument: "after" },
    );
    if (updated) return { claimed: true, alreadyClaimed: false };

    const current = await Coupon.findById(coupon._id).lean();
    const reason = classifyClaimFailure(current, { userId, paymentId, now });
    if (reason.alreadyClaimed) return { claimed: false, alreadyClaimed: true };
    throw new AppError(reason.message, reason.status, { code: reason.code });
  },

  /** Backwards-compatible name used by post-processing: now just an idempotent claim. */
  async markUsed({ coupon, userId, paymentId }) {
    return this.claim({ coupon, userId, paymentId });
  },

  /**
   * Release a reservation (order creation failed, payment expired/cancelled).
   * Conditional on the usedBy entry existing, so a double release can never
   * decrement twice.
   */
  async release({ couponId, paymentId }) {
    if (!couponId || !paymentId) return { released: false };
    const updated = await Coupon.findOneAndUpdate(
      { _id: couponId, "usedBy.paymentId": paymentId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 }, $pull: { usedBy: { paymentId } } },
      { returnDocument: "after" },
    );
    return { released: Boolean(updated) };
  },
};

import Coupon from "../models/Coupon.js";
import { AppError } from "../middleware/errorMiddleware.js";

export const couponService = {
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

  async markUsed({ coupon, userId, paymentId }) {
    if (!coupon) return;
    coupon.usedCount += 1;
    coupon.usedBy.push({ userId, paymentId, usedAt: new Date() });
    await coupon.save();
  },
};

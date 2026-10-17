// Phase 02 -- releasing what an UNPAID payment holds (wallet funds, coupon use),
// and only when that is provably safe:
//   * the appointment can no longer be paid (cancelled/expired/other), AND
//   * the payment is still pre-capture with NO provider payment id, NO
//     reconciliation flag and NO capture evidence (so no capture is outstanding
//     that we know of). An `authorized`/`verification_pending` payment is never
//     touched. A browser timeout is never a reason.
// A provider capture that still arrives afterwards is preserved by the Phase 01
// capture path (evidence + reconciliation), never silently dropped.
import Payment from "../models/Payment.js";
import Appointment from "../models/Appointment.js";
import Coupon from "../models/Coupon.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import { transitionPayment } from "./paymentTransitions.js";
import { couponService } from "./couponService.js";
import { paymentAllowsRelease, releaseWalletReservation } from "./walletReservationService.js";
import { logger } from "../utils/logger.js";

export const UNPAID_CLEANUP_GRACE_MS = 10 * 60 * 1000;
export const COUPON_ORPHAN_GRACE_MS = 15 * 60 * 1000;
const CANCELLABLE = ["created", "order_created", "checkout_started", "pending", "failed"];
const PAYABLE_APPOINTMENT = [APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.PAYMENT_PENDING];

const hasProviderEvidence = (p) => Boolean(p.gatewayPaymentId) || p.reconciliationState === "required" || (p.captureEvidence || []).length > 0;

/** Cancel one unpaid payment and free what it holds. Returns an outcome string. */
export const cancelAndReleaseUnpaidPayment = async (payment, { reason, source = "system" }) => {
  const full = await Payment.findById(payment._id).select("+captureEvidence").lean();
  if (!full) return "missing";
  if (hasProviderEvidence(full)) return "skipped_provider_evidence";
  const result = await transitionPayment({ paymentId: full._id, to: "cancelled", from: CANCELLABLE, source, reason });
  if (!["applied", "noop"].includes(result.outcome)) return `skipped_${result.reason || result.outcome}`;
  if (!paymentAllowsRelease(result.payment).ok) return "skipped_not_releasable";
  if (full.couponId) await couponService.release({ couponId: full.couponId, paymentId: full._id });
  if (full.walletAmount > 0) await releaseWalletReservation({ paymentId: full._id, reason, source });
  return "released";
};

export const cancelAndReleaseForAppointment = async (appointmentId, { reason = "Appointment is no longer payable", source = "system" } = {}) => {
  const payments = await Payment.find({ appointmentId, paymentState: { $in: CANCELLABLE } }).select("_id").lean();
  let released = 0;
  for (const p of payments) if ((await cancelAndReleaseUnpaidPayment(p, { reason, source })) === "released") released += 1;
  return released;
};

/** Sweep: unpaid payments of appointments that can no longer be paid. Idempotent, bounded. */
export const sweepUnpayablePayments = async ({ now = new Date(), limit = 100 } = {}) => {
  const cutoff = new Date(now.getTime() - UNPAID_CLEANUP_GRACE_MS);
  const candidates = await Payment.find({ paymentState: { $in: CANCELLABLE }, updatedAt: { $lt: cutoff }, gatewayPaymentId: { $exists: false } }).sort({ updatedAt: 1 }).limit(limit).lean();
  const results = [];
  for (const payment of candidates) {
    try {
      const appointment = await Appointment.findById(payment.appointmentId).select("status paymentStatus").lean();
      // A payment that can still be paid (payable appointment) or retried keeps its hold and coupon.
      const appointmentPayable = Boolean(appointment) && PAYABLE_APPOINTMENT.includes(appointment.status) && appointment.paymentStatus !== "paid";
      const retriesExhausted = payment.paymentState === "failed" && payment.activeAppointmentSlot !== true;
      if (appointmentPayable && !retriesExhausted) continue;
      const outcome = await cancelAndReleaseUnpaidPayment(payment, { reason: "Appointment is no longer payable (recovery sweep)", source: "recovery" });
      results.push({ paymentId: payment._id, outcome });
    } catch (error) {
      logger.warn("Unpaid payment cleanup failed for one payment", { paymentId: String(payment._id), message: error?.message });
      results.push({ paymentId: payment._id, outcome: "error" });
    }
  }
  return results;
};

/**
 * Coupon reservations whose Payment row was never created (crash between the
 * atomic coupon claim and Payment.create). The claim is keyed by a payment id
 * generated up front, so "no Payment with that id after the grace period" is
 * proof the order was never started. Anything else is left alone.
 */
export const recoverOrphanCouponReservations = async ({ now = new Date(), limit = 100 } = {}) => {
  const cutoff = new Date(now.getTime() - COUPON_ORPHAN_GRACE_MS);
  const coupons = await Coupon.find({ usedBy: { $elemMatch: { usedAt: { $lt: cutoff } } } }).limit(limit).lean();
  const results = [];
  for (const coupon of coupons) {
    for (const entry of coupon.usedBy || []) {
      if (!entry.paymentId || new Date(entry.usedAt) >= cutoff) continue;
      const exists = await Payment.findOne({ _id: entry.paymentId }).select("_id").lean();
      if (exists) continue;
      const { released } = await couponService.release({ couponId: coupon._id, paymentId: entry.paymentId });
      results.push({ couponId: coupon._id, paymentId: entry.paymentId, released });
    }
  }
  return results;
};

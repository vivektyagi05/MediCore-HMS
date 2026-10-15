import Appointment from "../models/Appointment.js";
import { APPOINTMENT_STATUS, PAYMENT_STATUS } from "../constants/appointmentStatus.js";
import { REASON_CODE } from "../constants/appointmentVisitState.js";
import { env } from "../config/env.js";
import { cancelAppointmentCore } from "./appointmentCancellationService.js";
import { logger } from "../utils/logger.js";
import Payment from "../models/Payment.js";
import { couponService } from "../payments/couponService.js";

// Only payments that provably never moved money release their coupon. In-flight
// states (checkout_started, pending, authorized, verification_pending) are left
// alone: releasing there could hand the coupon out twice if the capture lands.
export const COUPON_RELEASABLE_PAYMENT_STATUSES = Object.freeze(["created", "order_created", "failed", "cancelled", "expired"]);

export const releaseCouponsForUnpaidPayments = async (appointmentId) => {
  const payments = await Payment.find({
    appointmentId,
    couponId: { $exists: true, $ne: null },
    status: { $in: COUPON_RELEASABLE_PAYMENT_STATUSES },
  }).select("_id couponId").lean();
  let released = 0;
  for (const payment of payments) {
    const result = await couponService.release({ couponId: payment.couponId, paymentId: payment._id });
    if (result.released) released += 1;
  }
  return released;
};

const DEFAULT_BATCH = 200;

// Releases slots held by appointments whose patient never completed payment.
//
// RACE-SAFE (payment completion vs expiry): the cancel is an atomic
// conditional write that requires, AT WRITE TIME, status = payment_pending
// AND paymentStatus != paid AND still past the window. A payment that
// completes after this job loaded the candidate flips status/paymentStatus
// first, the conditional write matches nothing, and the paid appointment is
// left untouched (APPOINTMENT_STATE_CHANGED is swallowed as a benign skip).
//
// The window is measured from `paymentPendingAt` (a business timestamp set
// when the appointment actually entered payment_pending). `updatedAt` is used
// ONLY as a fallback for legacy rows that predate that field.
//
// Idempotent + bounded: re-running finds nothing already cancelled; at most
// `batchSize` rows per run (indexed by status/updatedAt).
export const expireStalePaymentWindows = async ({ now = new Date(), batchSize = DEFAULT_BATCH, jobRef = "expire-payment-windows" } = {}) => {
  const cutoff = new Date(now.getTime() - env.paymentWindowMinutes * 60 * 1000);
  const staleFilter = {
    status: APPOINTMENT_STATUS.PAYMENT_PENDING,
    paymentStatus: { $ne: PAYMENT_STATUS.PAID },
    $or: [
      { paymentPendingAt: { $lt: cutoff } },
      { paymentPendingAt: { $exists: false }, updatedAt: { $lt: cutoff } },
    ],
  };
  const candidates = await Appointment.find(staleFilter).sort({ updatedAt: 1 }).limit(batchSize);

  const results = [];
  for (const appointment of candidates) {
    try {
      await cancelAppointmentCore({
        appointment,
        cancelledBy: "system",
        reasonCode: REASON_CODE.PAYMENT_WINDOW_EXPIRED,
        reason: `Payment window (${env.paymentWindowMinutes} min) expired — slot released automatically`,
        jobRef,
        // write-time preconditions (the race guard)
        extraFilter: staleFilter,
        autoRefund: false, // payment never completed; nothing to refund
      });
      results.push(appointment._id);
      try {
        await releaseCouponsForUnpaidPayments(appointment._id);
      } catch (releaseError) {
        logger.error("Coupon release failed after payment-window expiry", { appointmentId: appointment._id, message: releaseError?.message });
      }
    } catch (error) {
      if (error?.details?.code === "APPOINTMENT_STATE_CHANGED" || error?.details?.code === "APPOINTMENT_NOT_FOUND") continue; // someone else won — correct outcome
      logger.error("Payment window expiry failed for appointment", { appointmentId: appointment._id, message: error?.message });
    }
  }
  return results;
};

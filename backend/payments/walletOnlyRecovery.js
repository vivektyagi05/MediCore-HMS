// Phase 02 -- recovery of wallet-only payments interrupted between reservation,
// wallet commit, capture claim and appointment completion. There is no provider
// order, so there is no external ambiguity: the outcome is decided purely from
// the reservation + appointment state, and every step is idempotent.
import Payment from "../models/Payment.js";
import Appointment from "../models/Appointment.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import { claimPaymentCapture } from "./paymentCapture.js";
import { transitionPayment, isCaptureConfirmed, markPostProcessingFailed } from "./paymentTransitions.js";
import { paymentDeps } from "./paymentDeps.js";
import { commitWalletReservation, releaseWalletReservation, walletReservationDeps, WALLET_RESERVATION_STATUS as RS } from "./walletReservationService.js";
import { logger } from "../utils/logger.js";

export const WALLET_ONLY_STALE_MS = 2 * 60 * 1000;
const PRE_CAPTURE = ["created", "order_created", "checkout_started", "pending"];
const PAYABLE_APPOINTMENT = [APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.PAYMENT_PENDING];

export const completeWalletOnlyPayment = async (payment) => {
  const reservation = await walletReservationDeps.store.findReservation({ paymentId: payment._id });
  if (!reservation) return { action: "skipped", why: "no_reservation" };
  const committed = reservation.status === RS.COMMITTED;
  const appointment = await Appointment.findById(payment.appointmentId).select("status paymentStatus").lean();
  const payable = appointment && PAYABLE_APPOINTMENT.includes(appointment.status);

  if (!committed && !payable) {
    // Nothing was debited and the appointment can no longer be paid: cancel and return the funds.
    const cancelled = await transitionPayment({ paymentId: payment._id, to: "cancelled", from: PRE_CAPTURE, source: "recovery", reason: "Wallet-only payment abandoned; appointment no longer payable" });
    if (cancelled.outcome === "applied" || cancelled.outcome === "noop") {
      await releaseWalletReservation({ paymentId: payment._id, reason: "Appointment no longer payable", source: "recovery" });
      return { action: "cancelled_and_released" };
    }
    return { action: "skipped", why: cancelled.outcome };
  }

  await commitWalletReservation({ paymentId: payment._id, userId: payment.userId, source: "recovery" });
  const gatewayPaymentId = `wallet_${payment._id}`;
  const claim = await claimPaymentCapture({ payment, attempt: { attemptNumber: 1, gatewayOrderId: payment.gatewayOrderId }, gatewayPaymentId, source: "recovery", reason: "Fully paid from wallet balance (recovered)" });
  await PaymentAttempt.updateOne({ paymentId: payment._id, attemptNumber: 1, status: { $ne: "captured" } }, { $set: { gatewayPaymentId, status: "captured", completedAt: new Date() } });
  try {
    await paymentDeps.postProcess(claim.payment);
  } catch (error) {
    await markPostProcessingFailed(payment._id, error?.message);
    throw error;
  }
  return { action: "completed", won: claim.won };
};

export const recoverWalletOnlyPayments = async ({ now = new Date(), limit = 50 } = {}) => {
  const cutoff = new Date(now.getTime() - WALLET_ONLY_STALE_MS);
  const stuck = await Payment.find({
    gatewayOrderId: /^wallet_/, paymentState: { $in: PRE_CAPTURE }, updatedAt: { $lt: cutoff },
  }).sort({ updatedAt: 1 }).limit(limit).lean();
  const results = [];
  for (const payment of stuck) {
    if (isCaptureConfirmed(payment)) continue;
    try { results.push({ paymentId: payment._id, ...(await completeWalletOnlyPayment(payment)) }); }
    catch (error) {
      logger.warn("Wallet-only recovery failed for one payment", { paymentId: String(payment._id), message: error?.message });
      results.push({ paymentId: payment._id, action: "error", error: error?.message });
    }
  }
  return results;
};

import { getTaxRatePercent } from "../services/hospitalSettingsService.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Coupon from "../models/Coupon.js";
import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import Subscription from "../models/Subscription.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ROLES } from "../constants/roles.js";
import { paymentGateway } from "../payments/paymentGateway.js";
import { normalizeGatewayCallback } from "../payments/gatewayCallback.js";
import { computePaymentSplit } from "../payments/paymentSplit.js";
import { financialEmails } from "../services/financialEmails.js";
import { claimPaymentCapture, markAttemptCaptured, preserveUnapplicableCapture, supersedeOpenAttempts } from "../payments/paymentCapture.js";
import { adoptExistingOrder, attemptMatchesAllocation, isPlaceholderOrderId, openGatewayOrder, PAYMENT_PLACEHOLDER_PREFIX, reserveAttempt, resolveGatewayOrder } from "../payments/paymentAttemptService.js";
import { applyGatewayFailure } from "../payments/paymentFailureService.js";
import { MAX_RETRIES, paymentRetryService } from "../payments/paymentRetryService.js";
import Invoice from "../models/Invoice.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { allocatePayout, calculateBill, toPaise } from "../payments/money.js";
import { calculateInvoiceAmounts, invoiceService } from "../services/invoiceService.js";
import { transactionLogger } from "../utils/transactionLogger.js";
import { effectiveState, isCaptureConfirmed, markPostProcessingCompleted, markPostProcessingFailed, markPostProcessingStarted, transitionPayment } from "../payments/paymentTransitions.js";
import {
  PAYMENT_STATUS as APPOINTMENT_PAYMENT_STATUS,
  APPOINTMENT_STATUS,
  STATUS_TRANSITIONS,
} from "../constants/appointmentStatus.js";
import RefundRequest from "../models/RefundRequest.js";
import { couponService } from "../payments/couponService.js";
import { commitWalletReservation, ensureReservationForPayment, getAvailableBalancePaise, paymentAllowsRelease, releaseWalletReservation, walletReservationDeps } from "../payments/walletReservationService.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";
import ConsultationHistory
from "../models/ConsultationHistory.js";
import DoctorPayout
from "../models/DoctorPayout.js";
import { atomicTransition } from "../services/appointmentTransitionService.js";
import { guardAppointmentAction } from "../services/appointmentGuard.js";
import { ACTION } from "../services/appointmentActionPolicy.js";

const ensureObjectId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
};

const populateAppointment = (query) =>
  query
    .populate("patientId", "name email role")
    .populate({
      path: "doctorId",
      select: "specialization fees userId",
      populate: { path: "userId", select: "name email role" },
    });

// Everything that must happen once a payment is CAPTURED: wallet debit,
// coupon consumption, appointment status flip, doctor payout, invoice,
// consultation history link, ledger entry, receipt email, realtime emit.
//
// This is called from verifyPayment right after signature verification, AND
// can be safely re-invoked later (by reconciliation) if it failed partway —
// every step below checks for its own prior completion before acting, so
// re-running this function never double-debits a wallet, double-uses a
// coupon, or creates a duplicate invoice/payout/ledger entry.
// Idempotent, atomic wallet debit for a payment (balance guard + per-payment
// transaction key + ledger key). Used both by the post-capture pipeline and by the
// wallet-only path, which must debit BEFORE the payment may be called captured.
const postWalletDebitLedger = async ({ payment, walletId, walletIdempotencyKey }) => {
  try {
    await TransactionLedger.create({
      userId: payment.userId,
      paymentId: payment._id,
      walletId,
      type: "wallet_debit",
      direction: "debit",
      amount: payment.walletAmount,
      currency: payment.currency,
      referenceId: payment._id.toString(),
      idempotencyKey: walletIdempotencyKey,
      metadata: { appointmentId: payment.appointmentId, via: "reservation" },
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
};

export const debitWalletForPayment = async (payment) => {
  const walletIdempotencyKey = `wallet:debit:${payment._id}`;
  if (!(payment.walletAmount > 0)) return { debited: false };
  // Phase 02: a payment with a wallet reservation consumes it (atomic hold -> debit,
  // exactly once). The wallet effect is written FIRST; the ledger row follows and is
  // replay-safe, so a crash between them is healed by the next pass, and no
  // success-only ledger row can exist without its wallet effect.
  const reservation = await walletReservationDeps.store.findReservation({ paymentId: payment._id });
  if (reservation) {
    try {
      const committed = await commitWalletReservation({ paymentId: payment._id, userId: payment.userId, source: "payment" });
      await postWalletDebitLedger({ payment, walletId: committed.reservation?.walletId, walletIdempotencyKey });
      return { debited: !committed.replay, replay: Boolean(committed.replay), reserved: true };
    } catch (commitError) {
      // A provider capture exists but the hold was already released (late capture after
      // release): the capture is real money, so fall through to the guarded, idempotent
      // direct debit below. If funds are gone it fails 409 and the payment stays
      // post_processing_failed / reconciliation-required with the capture preserved.
      if (commitError?.code !== "RESERVATION_NOT_ACTIVE") throw commitError;
    }
  }
  const walletAlreadyDebited = await TransactionLedger.findOne({ idempotencyKey: walletIdempotencyKey }).lean();
  if (walletAlreadyDebited) return { debited: false, replay: true };
  let wallet = await Wallet.findOneAndUpdate(
    {
      userId: payment.userId,
      $expr: { $gte: [{ $subtract: [{ $round: [{ $multiply: ["$balance", 100] }, 0] }, { $sum: { $ifNull: ["$holds.amountPaise", []] } }] }, toPaise(payment.walletAmount)] },
      transactions: { $not: { $elemMatch: { referenceType: "payment", referenceId: payment._id.toString() } } },
    },
    {
      $inc: { balance: -payment.walletAmount },
      $push: {
        transactions: {
          type: "payment",
          amount: payment.walletAmount,
          currency: payment.currency,
          status: "completed",
          referenceType: "payment",
          referenceId: payment._id.toString(),
          description: "Wallet contribution for appointment payment",
        },
      },
    },
    { returnDocument: "after" },
  );
  if (!wallet) {
    // Either the balance is insufficient, or the debit already landed on the wallet
    // document before a crash that lost the ledger row. Distinguish them: never debit twice.
    wallet = await Wallet.findOne({ userId: payment.userId, transactions: { $elemMatch: { referenceType: "payment", referenceId: payment._id.toString() } } });
    if (!wallet) throw new AppError("Wallet balance changed before payment verification. Please contact support.", 409);
  }
  try {
    await TransactionLedger.create({
      userId: payment.userId,
      paymentId: payment._id,
      walletId: wallet._id,
      type: "wallet_debit",
      direction: "debit",
      amount: payment.walletAmount,
      currency: payment.currency,
      referenceId: payment._id.toString(),
      idempotencyKey: walletIdempotencyKey,
      metadata: { appointmentId: payment.appointmentId },
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return { debited: true };
};

export const completePaymentPostProcessing = async (payment) => {
  // Always decide from the CURRENT stored state: the document passed in may be
  // stale (browser verify and webhook can both be mid-flight).
  const fresh = (await Payment.findById(payment._id)) || payment;
  // Fully completed already (browser verify finished before the webhook or
  // reconciliation arrived): nothing to redo, and in particular the payment
  // must not regress completed -> post_processing nor re-send the receipt.
  if (fresh.paymentState === "completed" && fresh.postProcessingState === "complete") {
    const [appointment, invoice] = await Promise.all([
      populateAppointment(Appointment.findById(payment.appointmentId)),
      fresh.invoiceId ? Invoice.findById(fresh.invoiceId) : Invoice.findOne({ paymentId: payment._id }),
    ]);
    return { appointment, invoice, replay: true, completedNow: false };
  }
  // Phase 01: compare-and-set transition with the REAL previous state (no
  // read-modify-save of a possibly stale document). Only a payment whose capture
  // is confirmed may enter post-processing.
  const started = await markPostProcessingStarted(fresh);
  if (started.outcome === "rejected" || started.outcome === "not_found") {
    throw new AppError("Payment is not in a state that allows post-capture processing", 409);
  }
  const paymentIdempotencyKey = `payment:capture:${payment._id}`;

  await debitWalletForPayment(payment);

  if (payment.couponId) {
    // F-005: normally a no-op (the reservation was made at order creation). It
    // only claims for legacy payments created before reservations existed. Money
    // is already captured here, so a coupon that is no longer claimable must be
    // surfaced for review rather than failing the capture pipeline.
    try {
      await couponService.markUsed({
        coupon: await Coupon.findById(payment.couponId),
        userId: payment.userId,
        paymentId: payment._id,
      });
    } catch (couponError) {
      if (!(couponError instanceof AppError)) throw couponError;
      transactionLogger.payment("Coupon claim rejected after capture", {
        paymentId: payment._id.toString(),
        code: couponError.details?.code,
      });
    }
  }

  const currentAppointment = await Appointment.findById(payment.appointmentId).lean();
  if (!currentAppointment) {
    throw new AppError("Appointment for this payment no longer exists", 404);
  }

  // Guard: only actually flip status to PAYMENT_COMPLETED if that's a legal
  // transition from wherever the appointment currently is. Without this
  // check, a patient cancelling (status -> CANCELLED) in the window between
  // "signature verified" and "post-processing finishes" would have this
  // unconditional update resurrect the cancelled appointment back to
  // PAYMENT_COMPLETED — putting it back in the active workflow and, worse,
  // making it eligible for a doctor payout for a consultation that never happens.
  const transitionIsLegal = (STATUS_TRANSITIONS[currentAppointment.status] || []).includes(
    APPOINTMENT_STATUS.PAYMENT_COMPLETED,
  );

  let appointment = null;
  if (transitionIsLegal) {
    // ATOMIC + CONDITIONAL: only flips if the appointment is STILL in the status
    // we validated (payment_pending). If a cancel/expiry won the race in the
    // meantime this returns null and we fall through to the auto-refund branch
    // below — a successful payment can never be silently overwritten, and a
    // cancelled appointment can never be resurrected. History is written in
    // the SAME atomic update.
    const flipped = await atomicTransition({
      appointmentId: payment.appointmentId,
      fromStatuses: [currentAppointment.status],
      set: {
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.PAID,
        status: APPOINTMENT_STATUS.PAYMENT_COMPLETED,
        paymentId: payment._id,
        paidAt: new Date(),
      },
      history: { status: APPOINTMENT_STATUS.PAYMENT_COMPLETED, fromStatus: currentAppointment.status, actorId: payment.userId, actorRole: "patient", reason: "Payment captured and verified", reasonCode: "PAYMENT_COMPLETED" },
      returnNullOnConflict: true,
    });
    if (flipped) appointment = await populateAppointment(Appointment.findById(flipped._id));
  }
  const flipWon = Boolean(appointment);
  // IDEMPOTENT REPLAY: a second pass (webhook after browser verify,
  // reconciliation, retry after a crash) finds the appointment already
  // PAYMENT_COMPLETED *by this very payment*. That is success, not a reason
  // to refund. Previously PAYMENT_COMPLETED -> PAYMENT_COMPLETED was judged
  // "illegal", which fabricated an auto RefundRequest for a paid appointment.
  const alreadyAppliedByThisPayment = !flipWon
    && currentAppointment.status === APPOINTMENT_STATUS.PAYMENT_COMPLETED
    && currentAppointment.paymentId
    && currentAppointment.paymentId.toString() === payment._id.toString();
  if (alreadyAppliedByThisPayment) {
    appointment = await populateAppointment(Appointment.findById(payment.appointmentId));
  }
  if (!appointment) {
    // Appointment moved to a status (almost always CANCELLED) that makes
    // PAYMENT_COMPLETED illegal. The money was still captured by the
    // gateway, so the patient is owed a refund — auto-create one, the same
    // way cancelAppointment does, instead of silently forcing a status the
    // business rules no longer allow.
    appointment = await populateAppointment(Appointment.findById(payment.appointmentId));

    const existingRefund = await RefundRequest.findOne({ paymentId: payment._id });
    if (!existingRefund) {
      await RefundRequest.create({
        paymentId: payment._id,
        requestedBy: payment.userId,
        amount: payment.totalAmount,
        reason: `Payment captured after appointment moved to "${currentAppointment.status}" — auto refund`,
        status: "pending",
        timeline: [
          {
            status: "pending",
            note: "Auto refund request created: payment settled after appointment was no longer payable",
            actorId: payment.userId,
          },
        ],
      });
    }
  }

  // P23 continuation — AUDIT FINDING: `findOne` then `create` here is a
  // check-then-act race. completePaymentPostProcessing can legitimately run
  // twice for the same payment concurrently (the synchronous verifyPayment
  // path and an async payment.captured webhook can both reach this line
  // before either has inserted), and both could pass the `!existingPayout`
  // check before either write lands. DoctorPayout.paymentId already has a
  // real unique index (Section 20's "prevent double payout per payment"),
  // so the loser's insert fails with a duplicate-key error rather than
  // silently creating a second payout — but that error was previously
  // unhandled, so the losing call reported the whole payment as
  // "post_processing_failed"/"reconciliation_required" for what is actually
  // a benign, already-resolved race. Now caught and treated as the
  // idempotent no-op it actually is.
  // Gate on the ACTUAL atomic flip result (`appointment` is non-null only when
  // this call really moved payment_pending -> payment_completed), not on the
  // pre-read legality — otherwise a lost race would still create a payout for
  // an appointment that was cancelled/expired in the meantime.
  // Also runs for an idempotent replay so a crash between the appointment
  // flip and this insert can be healed; DoctorPayout.paymentId is unique.
  if (flipWon || alreadyAppliedByThisPayment) {
    try {
      await DoctorPayout.create({
        doctorId: appointment.doctorId._id,
        paymentId: payment._id,
        appointmentId: appointment._id,
        ...allocatePayout(payment.totalAmount),
        status: "pending",
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Another concurrent call already created the payout for this
      // payment — nothing further to do, this is the expected idempotent
      // outcome of the race, not a real failure.
    }
  }

  // invoiceService.createInvoice is itself idempotent (returns the existing
  // invoice if one already exists for this payment) — safe to call again.
  const invoice = await invoiceService.createInvoice({ payment, appointment });
  if (!payment.invoiceId) {
    // Targeted write: a whole-document save() here could overwrite a newer state.
    await Payment.updateOne({ _id: payment._id, invoiceId: null }, { $set: { invoiceId: invoice._id } });
  }

  await Appointment.findByIdAndUpdate(appointment._id, { invoiceId: invoice._id });

  await ConsultationHistory.findOneAndUpdate(
    { appointmentId: appointment._id },
    { $set: { doctorId: appointment.doctorId._id, patientId: appointment.patientId._id, paymentId: payment._id } },
    { upsert: true },
  );

  const paymentLedgerAlreadyLogged = await TransactionLedger.findOne({ idempotencyKey: paymentIdempotencyKey }).lean();
  if (!paymentLedgerAlreadyLogged) {
    await TransactionLedger.create({
      userId: payment.userId,
      paymentId: payment._id,
      type: "payment",
      direction: "debit",
      amount: payment.totalAmount,
      currency: payment.currency,
      referenceId: payment.paymentId,
      idempotencyKey: paymentIdempotencyKey,
      metadata: {
        gatewayAmount: payment.gatewayAmount,
        walletAmount: payment.walletAmount,
        invoiceId: invoice._id,
      },
    });
  }

  // F-010: durable outbox instead of a fire-and-forget send (retry/backoff, no duplicates).
  await financialEmails.paymentReceipt({ payment, invoice, user: appointment.patientId });

  // CAS completion: exactly one caller observes `applied`, so the realtime event
  // and the automation trigger fire once even if verify and webhook both finish.
  const completed = await markPostProcessingCompleted(payment._id);
  const completedNow = completed.outcome === "applied";
  if (completedNow) await paymentEmitter.captured({ payment, invoice });

  return { appointment, invoice, completedNow };
};

// ---------------------------------------------------------------------------
// Phase 01 helpers
// ---------------------------------------------------------------------------
const ACTIVE_LEGACY_STATUSES = [
  PAYMENT_STATUS.CREATED, PAYMENT_STATUS.ORDER_CREATED, PAYMENT_STATUS.CHECKOUT_STARTED, PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.AUTHORIZED, PAYMENT_STATUS.VERIFICATION_PENDING, PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.POST_PROCESSING,
  PAYMENT_STATUS.POST_PROCESSING_FAILED, PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.RECONCILIATION_REQUIRED,
];

/**
 * The single active/conflicting payment for an appointment, if any. Flagged
 * payments are authoritative (partial unique index). Un-flagged legacy rows
 * (created before the slot flag existed) are treated as active when they are
 * in a live status, or failed-but-still-retryable, until migration 012
 * backfills the flag.
 */
export const findActiveAppointmentPayment = (appointmentId) =>
  Payment.findOne({
    appointmentId,
    $or: [
      { activeAppointmentSlot: true },
      { activeAppointmentSlot: { $exists: false }, status: { $in: ACTIVE_LEGACY_STATUSES } },
      { activeAppointmentSlot: { $exists: false }, status: PAYMENT_STATUS.FAILED, retryCount: { $lt: MAX_RETRIES } },
    ],
  }).sort({ createdAt: 1 }).lean();

const toOrderView = (payment, attempt) => ({
  id: attempt?.gatewayOrderId || payment.gatewayOrderId || payment.razorpayOrderId,
  amount: Math.round((attempt?.amount ?? (payment.gatewayAmount || payment.totalAmount)) * 100),
  currency: payment.currency,
});

const ORDERLESS_COMPLETION_GRACE_MS = 60 * 1000;
const isOrderless = (payment) => isPlaceholderOrderId(payment.razorpayOrderId) && !String(payment.razorpayOrderId).startsWith("wallet_");

/**
 * Classifies a payment for the frontend from BACKEND evidence only.
 * SUCCESS only when the provider capture is confirmed; PENDING while a
 * payable/verifying order exists; REQUIRES_RECONCILIATION when a human/recovery
 * process must decide; FAILED only for an authoritative, non-captured failure.
 */
export const classifyPaymentRecovery = (payment) => {
  if (!payment) return "NONE";
  if (isCaptureConfirmed(payment)) return "SUCCESS";
  const state = effectiveState(payment);
  if (state === "reconciliation_required" || payment.reconciliationState === "required") return "REQUIRES_RECONCILIATION";
  if (state === "failed" || payment.status === "failed") {
    // legacy shape: status failed + paymentState pending == a live retry order
    return payment.paymentState === "pending" ? "PENDING" : "FAILED";
  }
  if (state === "cancelled" || state === "expired") return "FAILED";
  return "PENDING";
};

/**
 * Completes an order-less payment (crash after the Payment row claimed the
 * appointment slot but before a provider order existed). Looks the order up by
 * its deterministic receipt before ever creating another one.
 */
const completeOrderlessPayment = async ({ payment, notes }) => {
  const last = await PaymentAttempt.findOne({ paymentId: payment._id }).sort({ attemptNumber: -1 });
  let attempt = last && last.status === "created" && isPlaceholderOrderId(last.gatewayOrderId) ? last : null;
  let order = null;
  if (attempt) {
    const adopted = await adoptExistingOrder({ attempt });
    if (adopted) ({ order, attempt } = adopted);
  } else {
    attempt = await reserveAttempt({ payment });
  }
  if (!order) {
    const opened = await openGatewayOrder({ payment, attempt, notes });
    if (opened.orphan) throw new AppError("Payment order could not be finalised. Please try again.", 409);
    ({ order, attempt } = opened);
  }
  const bound = await transitionPayment({
    paymentId: payment._id, to: "order_created", from: ["created"],
    filter: { razorpayOrderId: payment.razorpayOrderId },
    set: { gatewayOrderId: order.id, razorpayOrderId: order.id },
    source: "system", reason: "Provider order created",
  });
  if (bound.outcome === "rejected" || bound.outcome === "conflict") {
    throw new AppError("Payment changed while its order was being created. Please check payment status.", 409);
  }
  return { order, attempt, payment: bound.payment };
};

export const createPaymentOrder = asyncHandler(async (req, res) => {
  const {
    appointmentId,
    couponCode,
    idempotencyKey,
    walletAmount = 0,
  } = req.body;
  ensureObjectId(appointmentId, "appointment id");
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length < 12 || idempotencyKey.length > 200) {
    throw new AppError("A valid payment idempotency key is required", 400);
  }

  const appointment = await populateAppointment(Appointment.findById(appointmentId));

  if (!appointment) throw new AppError("Appointment not found", 404);
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new AppError("Cancelled appointments cannot be paid", 400);
  }
  if (
    appointment.status !== APPOINTMENT_STATUS.APPROVED &&
    appointment.status !== APPOINTMENT_STATUS.PAYMENT_PENDING
  ) {
    throw new AppError("Appointment must be approved before payment", 400);
  }
  if (appointment.patientId._id.toString() !== req.user._id.toString()) {
    throw new AppError("You can only pay for your own appointments", 403);
  }
  if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID) {
    throw new AppError("Appointment is already paid", 409);
  }
  // Time/state truth: no payment for an appointment whose slot has already passed.
  await guardAppointmentAction({ appointment, action: ACTION.PAY, actorRole: "patient" });

  const notesBase = { appointmentId: appointment._id.toString(), patientId: req.user._id.toString() };

  // Returns the response for a payment that already exists for this request.
  // Idempotent replay of the SAME key by the SAME user for the SAME appointment
  // returns the stored order; anything else is a conflict, never a second payment.
  const respondWithExisting = async (existing, { sameRequest }) => {
    if (!sameRequest) {
      throw new AppError("A payment is already active for this appointment", 409, {
        code: "ACTIVE_PAYMENT_EXISTS",
        paymentId: String(existing._id),
        recoveryState: classifyPaymentRecovery(existing),
        retryable: ["failed", "expired"].includes(effectiveState(existing)) && (existing.retryCount || 0) < MAX_RETRIES,
      });
    }
    if (isCaptureConfirmed(existing)) {
      throw new AppError("Payment has already been captured", 409, { code: "PAYMENT_ALREADY_CAPTURED", paymentId: String(existing._id) });
    }
    if (["failed", "expired"].includes(effectiveState(existing))) {
      // A failed/expired payment is resumed through the retry endpoint (same Payment,
      // new attempt), never by replaying the dead order as if it were payable.
      throw new AppError("This payment did not complete and must be retried", 409, {
        code: "ACTIVE_PAYMENT_EXISTS",
        paymentId: String(existing._id),
        recoveryState: classifyPaymentRecovery(existing),
        retryable: (existing.retryCount || 0) < MAX_RETRIES,
      });
    }
    let current = existing;
    let attempt = await PaymentAttempt.findOne({ paymentId: existing._id }).sort({ attemptNumber: -1 }).lean();
    if (isOrderless(existing)) {
      // Phase 02: a young order-less payment is almost certainly still being created by the request that
      // claimed it. A duplicate must NOT open its own provider order (that would leave an extra chargeable
      // order); only a payment stale enough to be a genuine crash leftover is completed here.
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (Number.isFinite(ageMs) && ageMs < ORDERLESS_COMPLETION_GRACE_MS) {
        throw new AppError("This payment is still being created. Please check its status in a moment.", 409, { code: "PAYMENT_CREATION_IN_PROGRESS", paymentId: String(existing._id), recoveryState: "PENDING" });
      }
      const finished = await completeOrderlessPayment({ payment: existing, notes: notesBase });
      current = finished.payment;
      attempt = finished.attempt;
    }
    const walletOnlyExisting = String(current.gatewayOrderId || "").startsWith("wallet_");
    return res.status(200).json({
      success: true,
      data: {
        walletOnly: walletOnlyExisting,
        payment: current,
        order: toOrderView(current, attempt),
        razorpayKeyId: paymentGateway.keyId(),
        gateway: walletOnlyExisting ? "wallet" : paymentGateway.mode(),
      },
      message: "Existing payment order returned successfully",
    });
  };

  const sameRequestOf = (existing) =>
    existing.idempotencyKey === idempotencyKey
    && String(existing.userId) === String(req.user._id)
    && String(existing.appointmentId) === String(appointment._id);

  let byKey = await Payment.findOne({ idempotencyKey }).sort({ createdAt: -1 }).lean();
  // A cancelled payment is terminal and released its slot: the same client key may
  // legitimately start a fresh payment (the browser keeps one key per appointment).
  if (byKey && effectiveState(byKey) === "cancelled") byKey = null;
  if (byKey) {
    if (!sameRequestOf(byKey)) {
      throw new AppError("This idempotency key was already used for a different payment", 409, { code: "IDEMPOTENCY_KEY_REUSED" });
    }
    return respondWithExisting(byKey, { sameRequest: true });
  }

  // One active payment per appointment, whatever idempotency key the client sends.
  const activeExisting = await findActiveAppointmentPayment(appointment._id);
  if (activeExisting) {
    // Crash recovery: an order-less payment owned by this user is completed with
    // its OWN key/slot instead of being blocked or duplicated.
    const stale = Date.now() - new Date(activeExisting.createdAt).getTime() > 60 * 1000;
    if (isOrderless(activeExisting) && String(activeExisting.userId) === String(req.user._id) && stale) {
      return respondWithExisting(activeExisting, { sameRequest: true });
    }
    return respondWithExisting(activeExisting, { sameRequest: sameRequestOf(activeExisting) });
  }

  const baseAmounts = await calculateInvoiceAmounts(appointment.doctorId.fees);
  const { coupon, discountAmount } = await couponService.validateAndCalculate({
    code: couponCode,
    userId: req.user._id,
    appointmentId: appointment._id,
    amount: baseAmounts.subtotal,
  });
  // FIX (billing accuracy): the admin-editable HospitalSetting.paymentSettings.taxRate
  // is what gets charged, not a disconnected env var.
  const taxRate = await getTaxRatePercent();
  const bill = calculateBill({ subtotal: baseAmounts.subtotal, discount: discountAmount, taxRate });
  const taxableSubtotal = bill.taxableSubtotal;
  const taxAmount = bill.tax;
  const totalAmount = bill.total;
  const requestedWalletAmount = Math.max(Number(walletAmount) || 0, 0);
  // Phase 02: spendable = posted balance minus ACTIVE holds (never a client value,
  // never a stale earlier read). The authoritative check is the atomic reservation below.
  const availableWalletPaise = requestedWalletAmount ? await getAvailableBalancePaise(req.user._id) : 0;
  // F-018: the SERVER decides the split. The wallet may cover the whole total
  // (wallet-only, no gateway order). A gateway remainder below INR 1 cannot be
  // charged, so in that case the wallet portion is reduced to leave exactly INR 1.
  const split = computePaymentSplit({ totalAmount, requestedWalletAmount, walletBalance: availableWalletPaise / 100 });
  if (split.error) throw new AppError("A minimum payable gateway amount of INR 1 is required", 400);
  const walletApplied = split.walletAmount;
  const gatewayAmount = split.gatewayAmount;
  const walletOnly = split.walletOnly;
  if (!walletOnly && gatewayAmount < 1) throw new AppError("A minimum payable gateway amount of INR 1 is required", 400);

  const receipt = `appt_${appointment._id.toString().slice(-12)}`;

  // F-005: the coupon is RESERVED atomically before any money-facing step, under
  // a payment id generated up front so the reservation and the Payment row share
  // one key. Anything that fails below releases it (see releaseCouponReservation).
  const newPaymentObjectId = new mongoose.Types.ObjectId();
  if (coupon) {
    await couponService.claim({ coupon, userId: req.user._id, paymentId: newPaymentObjectId });
  }
  const releaseCouponReservation = async () => {
    if (!coupon) return;
    try {
      await couponService.release({ couponId: coupon._id, paymentId: newPaymentObjectId });
    } catch (releaseError) {
      transactionLogger.payment("Coupon release failed after order failure", { couponId: coupon._id.toString(), error: releaseError.message });
    }
  };

  // Phase 01 — CLAIM FIRST. The Payment row (which owns the appointment's single
  // active-payment slot via a partial unique index) is inserted BEFORE any
  // provider order exists, with an explicit placeholder order id. Concurrent
  // requests therefore race on the unique index, not on a read-then-create check,
  // and a crash can never leave an untracked provider order: the order is created
  // afterwards, from a durable attempt, with a deterministic receipt.
  const placeholderOrderId = walletOnly ? `wallet_${newPaymentObjectId.toString()}` : `${PAYMENT_PLACEHOLDER_PREFIX}${newPaymentObjectId.toString()}`;
  let payment;
  try {
    payment = await Payment.create({
      _id: newPaymentObjectId,
      appointmentId: appointment._id,
      userId: req.user._id,
      doctorId: appointment.doctorId._id,
      amount: taxableSubtotal,
      discountAmount,
      couponId: coupon?._id,
      taxAmount,
      totalAmount,
      gatewayAmount,
      walletAmount: walletApplied,
      currency: "INR",
      status: PAYMENT_STATUS.CREATED,
      razorpayOrderId: placeholderOrderId,
      gatewayOrderId: placeholderOrderId,
      idempotencyKey,
      paymentState: "created",
      activeAppointmentSlot: true,
      stateHistory: [{ from: null, to: "created", source: "patient", reason: "Payment created", at: new Date() }],
      metadata: {
        receipt,
        couponCode: couponCode || null,
        insuranceClaimId: null,
        hospitalId: "primary",
        baseAmount: baseAmounts.subtotal,
        taxRate,
      },
    });
  } catch (error) {
    await releaseCouponReservation();
    if (error?.code === 11000) {
      // Lost the race for the appointment slot (or an idempotent duplicate): the winner's payment is authoritative.
      const winner = await findActiveAppointmentPayment(appointment._id);
      if (winner) return respondWithExisting(winner, { sameRequest: sameRequestOf(winner) });
    }
    throw error;
  }

  // Cleanup used when order creation definitively fails: the payment can never be
  // paid, so it is cancelled (this releases the appointment slot) and the coupon freed.
  const abandonPayment = async (reasonText) => {
    const cancelled = await transitionPayment({ paymentId: payment._id, to: "cancelled", from: ["created", "order_created", "pending"], source: "system", reason: String(reasonText).slice(0, 200) });
    await releaseCouponReservation();
    // Release the wallet hold only once the payment is provably cancelled with no capture.
    if (cancelled.payment && paymentAllowsRelease(cancelled.payment).ok) {
      try { await releaseWalletReservation({ paymentId: payment._id, reason: String(reasonText).slice(0, 200), source: "system" }); } catch (releaseError) {
        transactionLogger.payment("Wallet release failed after abandon; recovery will release", { paymentId: payment._id.toString(), error: releaseError.message });
      }
    }
  };

  // Phase 02: reserve the wallet portion BEFORE any provider order exists. Idempotent
  // per payment; a lost race for the funds is a definitive, user-facing 409.
  if (walletApplied > 0) {
    try {
      await ensureReservationForPayment(payment);
    } catch (reserveError) {
      if (reserveError?.code === "WALLET_INSUFFICIENT" || reserveError?.details?.code === "WALLET_INSUFFICIENT") {
        await abandonPayment("Wallet balance no longer covers the requested contribution");
        throw new AppError("Your available wallet balance changed. Please review the payment and try again.", 409, { code: "WALLET_INSUFFICIENT" });
      }
      throw reserveError; // ambiguous: the payment keeps its slot; recovery completes the hold
    }
  }

  let attempt;
  let razorpayOrder;
  if (walletOnly) {
    // Wallet-only: no provider order exists and none is faked.
    razorpayOrder = { id: placeholderOrderId, amount: 0, currency: "INR", internal: true };
    attempt = await PaymentAttempt.create({
      paymentId: payment._id, attemptNumber: 1, gateway: "internal_wallet", gatewayOrderId: placeholderOrderId,
      status: "created", amount: gatewayAmount, currency: "INR",
    });
    await transitionPayment({ paymentId: payment._id, to: "order_created", from: ["created"], source: "patient", reason: "Payment order created" });
  } else {
    try {
      attempt = await reserveAttempt({ payment });
      const opened = await openGatewayOrder({
        payment,
        attempt,
        receipt: `pay_${payment._id}_${attempt.attemptNumber}`,
        notes: { ...notesBase, walletApplied: String(walletApplied), couponCode: couponCode || "" },
      });
      if (opened.orphan) throw new AppError("Payment order could not be finalised. Please try again.", 409);
      razorpayOrder = opened.order;
      attempt = opened.attempt;
    } catch (error) {
      transactionLogger.payment("Razorpay order creation failed", {
        appointmentId: appointment._id.toString(),
        error: error?.response?.data || error.message,
      });
      const statusCode = Number(error?.statusCode || error?.response?.status);
      const definitive = statusCode >= 400 && statusCode < 500;
      if (definitive || error instanceof AppError) {
        await abandonPayment(`Provider order creation failed: ${error.message}`);
      }
      // Ambiguous (timeout/network): the payment keeps its slot and coupon; the next
      // request (or order recovery) looks the order up by receipt before creating another.
      throw error;
    }
    const bound = await transitionPayment({
      paymentId: payment._id, to: "order_created", from: ["created"],
      filter: { razorpayOrderId: placeholderOrderId },
      set: { gatewayOrderId: razorpayOrder.id, razorpayOrderId: razorpayOrder.id },
      source: "patient", reason: "Payment order created",
    });
    if (bound.outcome !== "applied") throw new AppError("Payment changed while its order was being created. Please check payment status.", 409);
    payment = bound.payment;
  }

  transactionLogger.payment("Razorpay order created", {
    paymentId: payment._id.toString(),
    appointmentId: appointment._id.toString(),
    razorpayOrderId: razorpayOrder.id,
  });

  // BUGFIX (audit finding): APPROVED -> PAYMENT_PENDING is the hop the post-capture
  // guard expects; applied at the point the patient commits to paying. Conditional +
  // audited. `paymentPendingAt` is the business timestamp the expiry job measures
  // the payment window from.
  try {
    await atomicTransition({
      appointmentId: appointment._id,
      fromStatuses: [APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.PAYMENT_PENDING],
      set: appointment.status === APPOINTMENT_STATUS.PAYMENT_PENDING && appointment.paymentPendingAt
        ? { status: APPOINTMENT_STATUS.PAYMENT_PENDING }
        : { status: APPOINTMENT_STATUS.PAYMENT_PENDING, paymentPendingAt: new Date() },
      history: { status: APPOINTMENT_STATUS.PAYMENT_PENDING, fromStatus: appointment.status, actorId: req.user._id, actorRole: "patient", reason: "Payment initiated", reasonCode: "PAYMENT_INITIATED" },
    });
  } catch (error) {
    // The appointment moved (e.g. cancelled) between the pay-guard and here: this
    // payment must not stay payable.
    await PaymentAttempt.updateOne({ _id: attempt._id, status: { $in: ["created", "checkout_started"] } }, { $set: { status: "cancelled", completedAt: new Date(), failureReason: "Appointment no longer payable" } });
    await abandonPayment("Appointment is no longer payable");
    throw error;
  }
  const pendingResult = await transitionPayment({
    paymentId: payment._id, to: "pending", from: ["order_created"], source: "system", reason: "Appointment entered payment pending",
  });
  if (pendingResult.payment && pendingResult.outcome !== "rejected") payment = pendingResult.payment;
  await PaymentAttempt.updateOne({ _id: attempt._id, status: "created" }, { $set: { status: "checkout_started", startedAt: new Date() } });

  if (walletOnly) {
    // Debit FIRST (atomic, idempotent). Only a successful debit may become a capture.
    try {
      await debitWalletForPayment(payment);
    } catch (debitError) {
      // A wallet-only payment has no provider order and no retry path: cancel it (this
      // releases the appointment slot) instead of leaving a retryable "failed" payment
      // whose retry would create a full-amount gateway order.
      // Only a DEFINITIVE wallet refusal may cancel. A transient error (the debit may
      // already have landed) leaves the payment for wallet-only recovery to finish.
      const definitive = ["RESERVATION_NOT_ACTIVE", "RESERVATION_RECOVERY_REQUIRED", "WALLET_INSUFFICIENT", "RESERVATION_NOT_FOUND"].includes(debitError?.code || debitError?.details?.code);
      if (!definitive) {
        transactionLogger.payment("Wallet-only debit outcome ambiguous; recovery will complete or release", { paymentId: payment._id.toString(), error: debitError.message });
        throw new AppError("Payment is being finalised. Please check payment status shortly.", 503, { code: "WALLET_PAYMENT_PENDING", paymentId: String(payment._id) });
      }
      const cancelled = await transitionPayment({ paymentId: payment._id, to: "cancelled", from: ["created", "order_created", "pending"], source: "wallet", reason: String(debitError.message).slice(0, 200) });
      await releaseCouponReservation();
      if (cancelled.payment && paymentAllowsRelease(cancelled.payment).ok) {
        await releaseWalletReservation({ paymentId: payment._id, reason: "Wallet-only payment could not be debited", source: "wallet" }).catch(() => {});
      }
      throw debitError;
    }
    const capture = await claimPaymentCapture({ payment, attempt: { attemptNumber: 1, gatewayOrderId: placeholderOrderId }, gatewayPaymentId: `wallet_${payment._id}`, source: "wallet", reason: "Fully paid from wallet balance" });
    await PaymentAttempt.findOneAndUpdate({ paymentId: payment._id, attemptNumber: 1 }, { gatewayPaymentId: `wallet_${payment._id}`, status: "captured", completedAt: new Date() });
    let invoice = null;
    let postProcessingIncomplete = false;
    try {
      invoice = (await completePaymentPostProcessing(capture.payment)).invoice;
    } catch (error) {
      postProcessingIncomplete = true;
      await markPostProcessingFailed(payment._id, error.message);
      transactionLogger.payment("Wallet-only payment captured but post-processing failed; flagged for reconciliation", { paymentId: payment._id.toString(), error: error.message });
    }
    const settled = await Payment.findById(payment._id);
    return res.status(201).json({
      success: true,
      data: { payment: settled, order: null, gateway: "wallet", walletOnly: true, invoice, postProcessingIncomplete },
      message: postProcessingIncomplete ? "Paid from wallet. Invoice generation is still finishing." : "Paid from wallet",
    });
  }

  res.status(201).json({
    success: true,
    data: {
      payment,
      order: razorpayOrder,
      razorpayKeyId: paymentGateway.keyId(),
      gateway: paymentGateway.mode(),
    },
    message: "Payment order created successfully",
  });
});

/**
 * Phase 01 — browser verification. The browser's success callback is only a
 * HINT: the server (1) resolves the paid order to its exact attempt/payment,
 * (2) checks ownership, (3) verifies the signature, (4) RE-FETCHES the provider
 * payment and validates order/amount/currency/status against the attempt's
 * authoritative allocation, and only then (5) claims the capture through the
 * same atomic path the webhook uses. Ambiguity never becomes a definitive
 * failure: it becomes `verification_pending` (HTTP 202/503) and the client
 * re-reads authoritative state.
 */
export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, paymentId, signature } = normalizeGatewayCallback(req.body);

  if (!razorpayOrderId || !paymentId || !signature) {
    throw new AppError("Razorpay order id, payment id, and signature are required", 400);
  }

  const resolved = await resolveGatewayOrder({ provider: paymentGateway.mode(), orderId: razorpayOrderId });
  if (resolved.kind !== "payment") throw new AppError("Payment order not found", 404);
  let { payment } = resolved;
  const { attempt } = resolved;
  // Ownership first: nothing below is revealed to or done for another user's payment.
  if (payment.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only verify your own payments", 403);
  }

  const respondCaptured = async (current, { replay }) => {
    const existingInvoice = await Invoice.findOne({ paymentId: current._id }).lean();
    return res.status(200).json({
      success: true,
      data: { payment: current, invoice: existingInvoice || null, postProcessingIncomplete: current.postProcessingState !== "complete", replay },
      message: replay ? "Payment was already verified" : "Payment verified successfully",
    });
  };

  if (isCaptureConfirmed(payment) && payment.gatewayPaymentId === paymentId) {
    // Idempotent replay (double click, retry, webhook already won).
    return respondCaptured(payment, { replay: true });
  }

  if (!paymentGateway.verifyPaymentSignature({ razorpayOrderId, paymentId, signature })) {
    // A bad signature proves nothing about the provider's state and must not be
    // able to push a payment into review. Reject; webhook/reconciliation decide.
    transactionLogger.payment("Payment verification rejected: invalid signature", { paymentId: payment._id.toString() });
    throw new AppError("Payment verification could not be confirmed. Your payment status is being checked.", 400);
  }

  const markVerificationPending = (why) => transitionPayment({
    paymentId: payment._id, to: "verification_pending",
    from: ["created", "order_created", "checkout_started", "pending", "authorized", "verification_pending"],
    set: { reconciliationState: "required" }, source: "gateway", reason: why,
  });

  let gatewayPayment;
  try {
    gatewayPayment = await paymentGateway.fetchPayment({ paymentId, orderId: razorpayOrderId, amount: attempt?.amount ?? (payment.gatewayAmount || payment.totalAmount), currency: payment.currency });
  } catch {
    await markVerificationPending("Gateway payment lookup failed");
    throw new AppError("Payment status could not be confirmed yet. Please check payment status again.", 503, { code: "VERIFICATION_PENDING" });
  }

  // Strict: the provider MUST report order, amount and currency. A missing value is
  // ambiguity, never a reason to substitute the expected value.
  const gwAmount = Number(gatewayPayment?.amount);
  const gwCurrency = typeof gatewayPayment?.currency === "string" ? gatewayPayment.currency.trim().toUpperCase() : "";
  if (!gatewayPayment?.order_id || !Number.isInteger(gwAmount) || gwAmount <= 0 || gwCurrency.length !== 3) {
    await markVerificationPending("Gateway response was incomplete");
    throw new AppError("Payment status could not be confirmed yet. Please check payment status again.", 503, { code: "VERIFICATION_PENDING" });
  }
  if (gatewayPayment.order_id !== razorpayOrderId) {
    throw new AppError("Payment order does not match this transaction", 400);
  }
  const expectedPaise = toPaise(attempt ? attempt.amount : (payment.gatewayAmount || payment.totalAmount));
  const expectedCurrency = String(attempt ? attempt.currency : payment.currency).toUpperCase();
  const allocationOk = !attempt || attemptMatchesAllocation(attempt, payment);
  if (!allocationOk || gwAmount !== expectedPaise || gwCurrency !== expectedCurrency) {
    await preserveUnapplicableCapture({ payment, attempt, entity: { id: paymentId, order_id: razorpayOrderId, amount: gwAmount, currency: gwCurrency }, source: "server_verification", disposition: allocationOk ? "amount_currency_mismatch" : "attempt_allocation_mismatch" });
    await transitionPayment({ paymentId: payment._id, to: "reconciliation_required", from: ["created", "order_created", "checkout_started", "pending", "authorized", "verification_pending", "failed"], set: { reconciliationState: "required" }, source: "gateway", reason: "Gateway amount or currency did not match authoritative payment" });
    throw new AppError("Payment details could not be reconciled. Please contact support.", 409, { code: "RECONCILIATION_REQUIRED" });
  }

  const providerStatus = String(gatewayPayment.status || "").toLowerCase();
  if (providerStatus === "failed") {
    // Authoritative failure for THIS attempt only, via the same attempt-aware path as the webhook.
    await applyGatewayFailure({ resolved, orderId: razorpayOrderId, entity: gatewayPayment, source: "gateway" });
    throw new AppError("Payment was not captured by the payment provider.", 402, { code: "PAYMENT_FAILED" });
  }
  if (!["captured", "processed"].includes(providerStatus)) {
    // created / authorized / refunded / unknown: not a failure and not yet a capture.
    await markVerificationPending(`Gateway payment status: ${providerStatus || "unknown"}`);
    return res.status(202).json({
      success: true,
      data: { payment: await Payment.findById(payment._id), invoice: null, confirming: true, postProcessingIncomplete: true },
      message: "Your payment is being confirmed. This usually takes a few moments.",
    });
  }

  const state = effectiveState(payment);
  if (!isCaptureConfirmed(payment) && (state === "cancelled" || state === "expired")) {
    await preserveUnapplicableCapture({ payment, attempt, entity: { id: paymentId, order_id: razorpayOrderId, amount: gwAmount, currency: gwCurrency }, source: "server_verification", disposition: `capture_on_${state}` });
    if (state === "expired") {
      await transitionPayment({ paymentId: payment._id, to: "reconciliation_required", from: ["expired"], set: { reconciliationState: "required" }, source: "gateway", reason: "Provider capture verified for an expired payment" });
    }
    throw new AppError("Your payment was received but this booking is no longer payable. Support has been notified and will resolve it.", 409, { code: "RECONCILIATION_REQUIRED" });
  }

  const capture = await claimPaymentCapture({
    payment,
    attempt,
    gatewayPaymentId: paymentId,
    signature,
    source: "server_verification",
    reason: "Gateway signature, order, amount and currency verified",
  });
  payment = capture.payment;
  if (!capture.won) {
    if (isCaptureConfirmed(payment) && payment.gatewayPaymentId !== paymentId) {
      await preserveUnapplicableCapture({ payment, attempt, entity: { id: paymentId, order_id: razorpayOrderId, amount: gwAmount, currency: gwCurrency }, source: "server_verification", disposition: "duplicate_capture" });
      throw new AppError("This payment was already settled by a different provider payment. Support has been notified.", 409, { code: "RECONCILIATION_REQUIRED" });
    }
    if (!isCaptureConfirmed(payment)) {
      await preserveUnapplicableCapture({ payment, attempt, entity: { id: paymentId, order_id: razorpayOrderId, amount: gwAmount, currency: gwCurrency }, source: "server_verification", disposition: "capture_rejected_state" });
      throw new AppError("This payment is no longer payable. Support has been notified.", 409, { code: "RECONCILIATION_REQUIRED" });
    }
  } else if (attempt) {
    await markAttemptCaptured({ paymentId: payment._id, gatewayOrderId: attempt.gatewayOrderId, gatewayPaymentId: paymentId });
    await supersedeOpenAttempts({ paymentId: payment._id, exceptGatewayOrderId: attempt.gatewayOrderId });
  }

  // Post-capture side effects are idempotent and resumable. Money has already
  // moved, so a failure here must NOT be reported as a failed payment; it is
  // recorded durably (post_processing_failed) and recovered by reconciliation.
  let invoice;
  let postProcessingIncomplete = false;

  try {
    const result = await completePaymentPostProcessing(payment);
    invoice = result.invoice;
  } catch (error) {
    postProcessingIncomplete = true;
    await markPostProcessingFailed(payment._id, error.message);
    transactionLogger.payment("Payment captured but post-processing failed — flagged for reconciliation", {
      paymentId: payment._id.toString(),
      error: error.message,
    });
  }

  transactionLogger.payment("Payment verified", {
    paymentId: payment._id.toString(),
    invoiceId: invoice?._id?.toString() || null,
    postProcessingIncomplete,
  });

  res.status(200).json({
    success: true,
    data: { payment: await Payment.findById(payment._id), invoice: invoice || null, postProcessingIncomplete },
    message: postProcessingIncomplete
      ? "Payment verified. Invoice/receipt generation is still finishing — it will appear shortly."
      : "Payment verified successfully",
  });
});

// P23 (Section 5) — RECOVERY. The frontend's authoritative source of truth when a
// checkout was interrupted (browser closed, callback missed, tab killed). Reports
// the real backend state plus attempt history so the UI never guesses and never
// silently creates a second payment order while one is unresolved. Pure read.
export const getPaymentStatus = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.appointmentId, "appointment id");

  const payment = await Payment.findOne({
    appointmentId: req.params.appointmentId,
    userId: req.user._id,
  })
    .sort({ createdAt: -1 })
    .populate("invoiceId", "invoiceNumber totalAmount pdfPath issuedAt")
    .lean();

  if (!payment) {
    return res.status(200).json({
      success: true,
      data: { payment: null, attempts: [], recoveryState: "NONE" },
      message: "No payment found for this appointment",
    });
  }

  const attempts = await PaymentAttempt.find({ paymentId: payment._id })
    .sort({ attemptNumber: 1 })
    .lean();

  const recoveryState = classifyPaymentRecovery(payment);
  const currentAttempt = attempts.filter((a) => a.gatewayOrderId === payment.gatewayOrderId)[0] || attempts[attempts.length - 1] || null;
  const retriesRemaining = Math.max(0, MAX_RETRIES - (payment.retryCount || 0));

  res.status(200).json({
    success: true,
    data: {
      payment,
      attempts,
      recoveryState,
      // Only a failed (never captured) payment with retries left may be retried; the
      // UI offers retry only from this flag, never from a local guess.
      retryAvailable: recoveryState === "FAILED" && ["failed", "expired"].includes(effectiveState(payment)) && retriesRemaining > 0,
      retriesRemaining,
      postProcessingComplete: payment.postProcessingState === "complete",
      currentOrder: recoveryState === "PENDING" && currentAttempt && !isPlaceholderOrderId(currentAttempt.gatewayOrderId) && !String(payment.gatewayOrderId || "").startsWith("wallet_") ? toOrderView(payment, currentAttempt) : null,
      razorpayKeyId: paymentGateway.keyId(),
      gateway: paymentGateway.mode(),
    },
    message: "Payment status fetched successfully",
  });
});

// P23 (Section 6) — RETRY. A failed/expired payment gets a genuinely new
// PaymentAttempt + gateway order on the SAME Payment document, through the one
// canonical retry-claim service (shared with cron/admin/webhook), so concurrent
// requests cannot both create orders and a captured payment can never be retried.
export const retryPayment = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, "payment id");

  const payment = await Payment.findById(req.params.id);
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only retry your own payments", 403);
  }
  if (isCaptureConfirmed(payment)) {
    throw new AppError("This payment has already been captured.", 409, { code: "PAYMENT_ALREADY_CAPTURED" });
  }

  let result;
  try {
    result = await paymentRetryService.createRetryAttempt(payment._id, {
      source: "patient", actorId: req.user._id, allowExpired: true, userId: req.user._id,
    });
  } catch (error) {
    transactionLogger.payment("Retry order creation failed", { paymentId: payment._id.toString(), error: error?.response?.data || error.message });
    throw error;
  }

  if (!result) {
    // Not claimable: either someone else already created the retry order (return it,
    // idempotently), the payment is no longer retryable, or retries are exhausted.
    const current = await Payment.findById(payment._id);
    if (current && isCaptureConfirmed(current)) throw new AppError("This payment has already been captured.", 409, { code: "PAYMENT_ALREADY_CAPTURED" });
    if (current && classifyPaymentRecovery(current) === "PENDING" && !isOrderless(current)) {
      const liveAttempt = await PaymentAttempt.findOne({ paymentId: current._id, gatewayOrderId: current.gatewayOrderId }).lean();
      return res.status(200).json({
        success: true,
        data: { payment: current, order: toOrderView(current, liveAttempt), razorpayKeyId: paymentGateway.keyId(), gateway: paymentGateway.mode(), attemptNumber: liveAttempt?.attemptNumber, reused: true },
        message: "A payment order is already awaiting checkout",
      });
    }
    if (current && (current.retryCount || 0) >= MAX_RETRIES) {
      throw new AppError("The retry limit for this payment was reached. Please start a new payment.", 409, { code: "RETRIES_EXHAUSTED" });
    }
    throw new AppError("This payment is not eligible for retry.", 409, { code: "RETRY_NOT_ELIGIBLE" });
  }

  transactionLogger.payment("Payment retry order created", {
    paymentId: payment._id.toString(),
    attemptNumber: result.attempt?.attemptNumber,
    razorpayOrderId: result.order.id,
  });

  res.status(201).json({
    success: true,
    data: {
      payment: result.payment,
      order: result.order,
      razorpayKeyId: paymentGateway.keyId(),
      gateway: paymentGateway.mode(),
      attemptNumber: result.attempt?.attemptNumber,
    },
    message: "Retry payment order created successfully",
  });
});

export const completeTestPayment = asyncHandler(async (req, res) => {
  if (paymentGateway.mode() !== "test") throw new AppError("Test payment gateway is disabled", 404);
  const razorpayOrderId = typeof req.body?.razorpayOrderId === "string" ? req.body.razorpayOrderId.trim() : "";
  if (!razorpayOrderId) throw new AppError("Razorpay order id is required", 400);
  const payment = await Payment.findOne({ gatewayOrderId: razorpayOrderId, userId: req.user._id });
  if (!payment) throw new AppError("Payment order not found", 404);
  // The test gateway must obey the same lifecycle as a real one: it can only
  // "pay" an order that is genuinely payable, never a captured/failed one.
  if (payment.status === PAYMENT_STATUS.CAPTURED) throw new AppError("Payment has already been completed", 409);
  if (![PAYMENT_STATUS.CREATED, PAYMENT_STATUS.ORDER_CREATED, PAYMENT_STATUS.CHECKOUT_STARTED, PAYMENT_STATUS.PENDING, PAYMENT_STATUS.AUTHORIZED, PAYMENT_STATUS.VERIFICATION_PENDING].includes(payment.status)) {
    throw new AppError("This payment order is no longer payable", 409);
  }
  const paymentId = `test_payment_${payment._id.toString()}`;
  const response = paymentGateway.buildPaymentResponse(
    payment.gatewayOrderId,
    paymentId,
    payment.gatewayAmount || payment.totalAmount,
    payment.currency,
  );
  return res.status(200).json({ success: true, data: response, message: "Test gateway response generated" });
});

export const getPayments = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;
  const filter = [ROLES.SUPER_ADMIN].includes(req.user.role) ? {} : { userId: req.user._id };

  // Advanced filters (Payment Center: status/date-range/doctor/amount/search)
  // applied server-side so pagination stays correct across filtered result
  // sets, instead of the previous approach of loading one page and letting
  // the frontend filter only what already loaded.
  if (req.query.status) {
    filter.status = { $in: String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (req.query.doctorId) filter.doctorId = req.query.doctorId;
  if (req.query.appointmentId) filter.appointmentId = req.query.appointmentId;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  if (req.query.minAmount || req.query.maxAmount) {
    filter.totalAmount = {};
    if (req.query.minAmount) filter.totalAmount.$gte = Number(req.query.minAmount);
    if (req.query.maxAmount) filter.totalAmount.$lte = Number(req.query.maxAmount);
  }
  // Free-text search against doctor name / specialization: resolve matching
  // doctor ids first via the existing User/Doctor models (small, indexed
  // lookups), then narrow the Payment filter by doctorId — keeps search
  // server-side and paginated rather than only searching one loaded page.
  if (req.query.search) {
    const regex = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const [matchingUsers, matchingDoctorsBySpecialization] = await Promise.all([
      mongoose.model("User").find({ name: regex }).select("_id").lean(),
      mongoose.model("Doctor").find({ specialization: regex }).select("_id").lean(),
    ]);
    const matchingDoctorsByUser = matchingUsers.length
      ? await mongoose.model("Doctor").find({ userId: { $in: matchingUsers.map((u) => u._id) } }).select("_id").lean()
      : [];
    const doctorIds = [
      ...matchingDoctorsByUser.map((d) => d._id),
      ...matchingDoctorsBySpecialization.map((d) => d._id),
    ];
    filter.doctorId = { $in: doctorIds.length ? doctorIds : [new mongoose.Types.ObjectId()] };
  }

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("appointmentId", "date timeSlot status")
      .populate("userId", "name email role")
      .populate({
        path: "doctorId",
        select: "specialization userId",
        populate: { path: "userId", select: "name email role" },
      })
      .populate("invoiceId", "invoiceNumber totalAmount pdfPath issuedAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  // Enrich with whether a refund request is already pending/approved for
  // each payment, so the frontend can hide "Request refund" instead of
  // letting the patient hit the duplicate-request 409 from createRefundRequest.
  const pendingRefundPaymentIds = payments.length
    ? await RefundRequest.find({
        paymentId: { $in: payments.map((p) => p._id) },
        status: { $in: ["pending", "approved"] },
      }).distinct("paymentId")
    : [];
  const pendingRefundSet = new Set(pendingRefundPaymentIds.map((id) => id.toString()));
  const enrichedPayments = payments.map((payment) => ({
    ...payment,
    pendingRefundRequest: pendingRefundSet.has(payment._id.toString()),
  }));

  res.status(200).json({
    success: true,
    data: {
      payments: enrichedPayments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    message: "Payments fetched successfully",
  });
});

export const getFinancialSummary = asyncHandler(async (_req, res) => {
  // BUGFIX: this was `[summary, [walletSummary], [subscriptionSummary]]` —
  // inconsistent destructuring where only the last two aggregation results
  // were unwrapped to their first element. `summary` stayed as the raw
  // aggregate() result ARRAY, so `data.totalEarnings` read undefined (arrays
  // don't have that property, only `data[0].totalEarnings` would), and
  // JSON.stringify on the response silently dropped every property this
  // function later attached (walletBalances, recurringRevenue,
  // activeSubscriptions, successRatio) since those are non-index properties
  // on an array. Confirmed by reproducing the exact pattern in isolation.
  const [[summary], [walletSummary], [subscriptionSummary]] = await Promise.all([
    Payment.aggregate([
    {
      $group: {
        _id: null,
        totalEarnings: {
          $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.CAPTURED] }, "$totalAmount", 0] },
        },
        refundedAmount: { $sum: "$refundedAmount" },
        failedPayments: {
          $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.FAILED] }, 1, 0] },
        },
        capturedPayments: {
          $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.CAPTURED] }, 1, 0] },
        },
        totalPayments: { $sum: 1 },
      },
    },
    ]),
    Wallet.aggregate([{ $group: { _id: null, walletBalances: { $sum: "$balance" } } }]),
    Subscription.aggregate([
      {
        $group: {
          _id: null,
          recurringRevenue: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, "$amount", 0] },
          },
          activeSubscriptions: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const data = summary || {
    totalEarnings: 0,
    refundedAmount: 0,
    failedPayments: 0,
    capturedPayments: 0,
    totalPayments: 0,
  };
  data.walletBalances = walletSummary?.walletBalances || 0;
  data.recurringRevenue = subscriptionSummary?.recurringRevenue || 0;
  data.activeSubscriptions = subscriptionSummary?.activeSubscriptions || 0;
  data.successRatio = data.totalPayments
    ? Number(((data.capturedPayments / data.totalPayments) * 100).toFixed(2))
    : 0;

  res.status(200).json({
    success: true,
    data,
    message: "Financial summary fetched successfully",
  });
});

// ─── Payment Center: patient/admin analytics ──────────────────────────────
// Real aggregates only, computed from Payment/RefundRequest/TransactionLedger
// — nothing here is fabricated or estimated. Scoped to the caller's own
// payments unless they are admin/super-admin (same ownership pattern as
// getPayments/getFinancialSummary above). Extracted into a plain data
// builder (mirroring buildPlatformOverviewData's pattern) so the AI
// expense-summary feature can reuse the exact same real aggregates instead
// of re-querying or approximating them.
export const buildPaymentAnalyticsData = async (user) => {
  const isAdmin = [ROLES.SUPER_ADMIN].includes(user.role);
  const ownerMatch = isAdmin ? {} : { userId: user._id };
  const capturedMatch = { ...ownerMatch, status: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] } };

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const [monthlyTrend, doctorWise, taxSummary, yearSummary, upcomingDues, refundSummary] = await Promise.all([
    // Monthly spending trend, last 6 months
    Payment.aggregate([
      { $match: { ...capturedMatch, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          totalAmount: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    // Doctor-wise + (via lookup) specialty-wise spending
    Payment.aggregate([
      { $match: capturedMatch },
      {
        $group: {
          _id: "$doctorId",
          totalAmount: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "doctors",
          localField: "_id",
          foreignField: "_id",
          as: "doctor",
        },
      },
      { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "doctor.userId",
          foreignField: "_id",
          as: "doctorUser",
        },
      },
      { $unwind: { path: "$doctorUser", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          totalAmount: 1,
          count: 1,
          specialization: "$doctor.specialization",
          doctorName: "$doctorUser.name",
        },
      },
    ]),
    // Tax summary — this calendar year
    Payment.aggregate([
      { $match: { ...capturedMatch, createdAt: { $gte: yearStart } } },
      { $group: { _id: null, totalTax: { $sum: "$taxAmount" }, totalSubtotal: { $sum: "$amount" }, totalPaid: { $sum: "$totalAmount" } } },
    ]),
    // Medical expense summary — all-time
    Payment.aggregate([
      { $match: capturedMatch },
      {
        $group: {
          _id: null,
          allTimeTotal: { $sum: "$totalAmount" },
          allTimeCount: { $sum: 1 },
          totalRefunded: { $sum: "$refundedAmount" },
        },
      },
    ]),
    // Upcoming dues — approved/payment_pending appointments not yet paid
    isAdmin
      ? Promise.resolve([])
      : Appointment.find({
          patientId: user._id,
          status: { $in: [APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.PAYMENT_PENDING] },
          paymentStatus: { $ne: APPOINTMENT_PAYMENT_STATUS.PAID },
        })
          .populate({ path: "doctorId", select: "specialization fees userId", populate: { path: "userId", select: "name" } })
          .select("date timeSlot status doctorId")
          .sort({ date: 1 })
          .limit(10)
          .lean(),
    // Refund summary
    RefundRequest.aggregate([
      ...(isAdmin ? [] : [{ $match: { requestedBy: user._id } }]),
      { $group: { _id: "$status", totalAmount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return {
    monthlySpending: monthlyTrend.map((entry) => ({
      month: `${monthNames[entry._id.month - 1]} ${entry._id.year}`,
      totalAmount: entry.totalAmount,
      count: entry.count,
    })),
    doctorWiseSpending: doctorWise.map((entry) => ({
      doctorId: entry._id,
      doctorName: entry.doctorName || "Doctor",
      specialization: entry.specialization || "General",
      totalAmount: entry.totalAmount,
      count: entry.count,
    })),
    specialtyWiseSpending: Object.values(
      doctorWise.reduce((acc, entry) => {
        const key = entry.specialization || "General";
        if (!acc[key]) acc[key] = { specialization: key, totalAmount: 0, count: 0 };
        acc[key].totalAmount += entry.totalAmount;
        acc[key].count += entry.count;
        return acc;
      }, {}),
    ).sort((a, b) => b.totalAmount - a.totalAmount),
    taxSummary: taxSummary[0] || { totalTax: 0, totalSubtotal: 0, totalPaid: 0 },
    expenseSummary: yearSummary[0] || { allTimeTotal: 0, allTimeCount: 0, totalRefunded: 0 },
    upcomingDues: upcomingDues.map((appt) => ({
      appointmentId: appt._id,
      date: appt.date,
      timeSlot: appt.timeSlot,
      status: appt.status,
      doctorName: appt.doctorId?.userId?.name,
      specialization: appt.doctorId?.specialization,
      estimatedAmount: appt.doctorId?.fees,
    })),
    refundSummary: refundSummary.reduce((acc, entry) => {
      acc[entry._id] = { totalAmount: entry.totalAmount, count: entry.count };
      return acc;
    }, {}),
  };
};

export const getPaymentAnalytics = asyncHandler(async (req, res) => {
  const data = await buildPaymentAnalyticsData(req.user);
  res.status(200).json({
    success: true,
    data,
    message: "Payment analytics fetched successfully",
  });
});

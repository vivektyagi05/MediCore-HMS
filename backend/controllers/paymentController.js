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
import PaymentAttempt from "../models/PaymentAttempt.js";
import { calculateBill, toPaise } from "../payments/money.js";
import { calculateInvoiceAmounts, invoiceService } from "../services/invoiceService.js";
import { emailService } from "../services/emailService.js";
import { transactionLogger } from "../utils/transactionLogger.js";
import { env } from "../config/env.js";
import { appendPaymentTransition } from "../payments/paymentStateMachine.js";
import {
  PAYMENT_STATUS as APPOINTMENT_PAYMENT_STATUS,
  APPOINTMENT_STATUS,
  STATUS_TRANSITIONS,
} from "../constants/appointmentStatus.js";
import RefundRequest from "../models/RefundRequest.js";
import { couponService } from "../payments/couponService.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";
import ConsultationHistory
from "../models/ConsultationHistory.js";
import DoctorPayout
from "../models/DoctorPayout.js";
import { appendAppointmentHistory } from "../services/appointmentHistoryService.js";

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
export const completePaymentPostProcessing = async (payment) => {
  if (payment.paymentState !== "post_processing") {
    const previousState = payment.paymentState || "captured";
    payment.paymentState = "post_processing";
    payment.postProcessingState = "pending";
    payment.stateHistory = payment.stateHistory || [];
    payment.stateHistory.push({ from: previousState, to: "post_processing", source: "system", reason: "Post-capture financial processing started", at: new Date() });
    await payment.save();
  }
  const walletIdempotencyKey = `wallet:debit:${payment._id}`;
  const paymentIdempotencyKey = `payment:capture:${payment._id}`;

  if (payment.walletAmount > 0) {
    const walletAlreadyDebited = await TransactionLedger.findOne({ idempotencyKey: walletIdempotencyKey }).lean();
    if (!walletAlreadyDebited) {
      const wallet = await Wallet.findOneAndUpdate(
        {
          userId: payment.userId,
          balance: { $gte: payment.walletAmount },
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
        throw new AppError("Wallet balance changed before payment verification. Please contact support.", 409);
      }

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
    }
  }

  if (payment.couponId) {
    await couponService.markUsed({
      coupon: await Coupon.findById(payment.couponId),
      userId: payment.userId,
      paymentId: payment._id,
    });
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

  let appointment;
  if (transitionIsLegal) {
    appointment = await populateAppointment(
      Appointment.findByIdAndUpdate(
        payment.appointmentId,
        {
          paymentStatus: APPOINTMENT_PAYMENT_STATUS.PAID,
          status: APPOINTMENT_STATUS.PAYMENT_COMPLETED,
          paymentId: payment._id,
          paidAt: new Date(),
        },
        { returnDocument: "after" },
      ),
    );
    // Record the payment-driven lifecycle transition on the canonical appointment.
    if (appointment) appendAppointmentHistory({ appointment, status: APPOINTMENT_STATUS.PAYMENT_COMPLETED, fromStatus: currentAppointment.status, actorId: payment.userId, actorRole: "patient", reason: "Payment captured and verified" });
    if (appointment) await appointment.save();
  } else {
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
  if (transitionIsLegal) {
    try {
      await DoctorPayout.create({
        doctorId: appointment.doctorId._id,
        paymentId: payment._id,
        appointmentId: appointment._id,
        grossAmount: Number(payment.totalAmount.toFixed(2)),
        platformFee: Number((payment.totalAmount * 0.1).toFixed(2)),
        doctorAmount: Number((payment.totalAmount * 0.9).toFixed(2)),
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
    payment.invoiceId = invoice._id;
    await payment.save();
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

  try {
    await emailService.sendPaymentReceipt({
      patient: appointment.patientId,
      invoice,
      pdfPath: invoice.pdfPath,
    });
  } catch (error) {
    transactionLogger.payment("Payment receipt email failed", {
      paymentId: payment._id.toString(),
      error: error.message,
    });
  }

  payment.postProcessingState = "complete";
  payment.paymentState = "completed";
  payment.reconciliationState = "matched";
  payment.stateHistory = payment.stateHistory || [];
  payment.stateHistory.push({ from: "post_processing", to: "completed", source: "system", reason: "Financial post-processing completed", at: new Date() });
  await payment.save();

  await paymentEmitter.captured({ payment, invoice });

  return { appointment, invoice };
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
    if (
    appointment.status ===
    APPOINTMENT_STATUS.CANCELLED
  ) {

    throw new AppError(
      "Cancelled appointments cannot be paid",
      400
    );
  }
  if (
    appointment.status !== APPOINTMENT_STATUS.APPROVED &&
    appointment.status !== APPOINTMENT_STATUS.PAYMENT_PENDING
  ) {
    throw new AppError(
      "Appointment must be approved before payment",
      400
    );
  }
  if (appointment.patientId._id.toString() !== req.user._id.toString()) {
    throw new AppError("You can only pay for your own appointments", 403);
  }
  if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID) {
    throw new AppError("Appointment is already paid", 409);
  }

  const existingPayment = await Payment.findOne({
    ...(idempotencyKey ? { idempotencyKey } : { appointmentId, userId: req.user._id }),
    status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CAPTURED] },
  }).lean();

  if (existingPayment) {
    if (idempotencyKey && existingPayment.idempotencyKey === idempotencyKey && existingPayment.status !== PAYMENT_STATUS.CAPTURED) {
      return res.status(200).json({
        success: true,
        data: {
          payment: existingPayment,
          order: {
            id: existingPayment.razorpayOrderId,
            amount: Math.round((existingPayment.gatewayAmount || existingPayment.totalAmount) * 100),
            currency: existingPayment.currency,
          },
          razorpayKeyId: env.razorpayKeyId,
        },
        message: "Existing payment order returned successfully",
      });
    }

    throw new AppError(
      existingPayment.status === PAYMENT_STATUS.CAPTURED
        ? "Payment has already been captured"
        : "A payment order is already active for this appointment",
      409,
    );
  }

  const baseAmounts = calculateInvoiceAmounts(appointment.doctorId.fees);
  const { coupon, discountAmount } = await couponService.validateAndCalculate({
    code: couponCode,
    userId: req.user._id,
    appointmentId: appointment._id,
    amount: baseAmounts.subtotal,
  });
  const configuredTaxRate = Number(process.env.CONSULTATION_TAX_RATE);
  const taxRate = Number.isFinite(configuredTaxRate) && configuredTaxRate >= 0 && configuredTaxRate <= 100
    ? configuredTaxRate
    : 0;
  const bill = calculateBill({ subtotal: baseAmounts.subtotal, discount: discountAmount, taxRate });
  const taxableSubtotal = bill.taxableSubtotal;
  const taxAmount = bill.tax;
  const totalAmount = bill.total;
  const requestedWalletAmount = Math.max(Number(walletAmount) || 0, 0);
  const wallet = requestedWalletAmount
    ? await Wallet.findOneAndUpdate(
        { userId: req.user._id },
        { $setOnInsert: { userId: req.user._id, balance: 0, currency: "INR" } },
        { returnDocument: "after", upsert: true },
      )
    : null;
  const walletApplied = requestedWalletAmount
    ? Number(Math.min(requestedWalletAmount, wallet.balance, Math.max(totalAmount - 1, 0)).toFixed(2))
    : 0;
  const gatewayAmount = Number((totalAmount - walletApplied).toFixed(2));

  if (gatewayAmount < 1) {
    throw new AppError("A minimum payable gateway amount of INR 1 is required", 400);
  }

  const receipt =
  `appt_${appointment._id.toString().slice(-12)}`;


  // CLEANUP (audit finding): this block previously logged full Razorpay
  // order payloads and raw gateway error bodies to console via debug
  // console.log/console.error left over from local troubleshooting -- a
  // security/PII concern in production logs. Routed through the existing
  // transactionLogger instead, matching the pattern already used elsewhere
  // in this file and in refundController.
  let razorpayOrder;
  try {
    razorpayOrder = await paymentGateway.createOrder({
      amount: gatewayAmount,
      currency: "INR",
      receipt,
      notes: {
        appointmentId: appointment._id.toString(),
        patientId: req.user._id.toString(),
        walletApplied: String(walletApplied),
        couponCode: couponCode || "",
        module: "hms_finance",
      },
    });
  } catch (error) {
    transactionLogger.payment("Razorpay order creation failed", {
      appointmentId: appointment._id.toString(),
      error: error?.response?.data || error.message,
    });
    throw error;
  }

  let payment;
  try {
    payment = await Payment.create({
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
      razorpayOrderId: razorpayOrder.id,
      gatewayOrderId: razorpayOrder.id,
      idempotencyKey,
      paymentState: "order_created",
      stateHistory: [{ from: "created", to: "order_created", source: "patient", reason: "Payment order created", at: new Date() }],
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
    if (error?.code === 11000 && error?.keyPattern?.idempotencyKey) {
      const existing = await Payment.findOne({ idempotencyKey }).lean();
      if (existing) {
        return res.status(200).json({
          success: true,
          data: {
            payment: existing,
            order: { id: existing.gatewayOrderId || existing.razorpayOrderId, amount: Math.round((existing.gatewayAmount || existing.totalAmount) * 100), currency: existing.currency },
            razorpayKeyId: paymentGateway.keyId(),
            gateway: paymentGateway.mode(),
          },
          message: "Existing payment order returned successfully",
        });
      }
    }
    throw error;
  }

  await PaymentAttempt.create({
    paymentId: payment._id,
    attemptNumber: 1,
    gateway: paymentGateway.mode(),
    gatewayOrderId: razorpayOrder.id,
    status: "created",
    amount: gatewayAmount,
    currency: "INR",
  });

  transactionLogger.payment("Razorpay order created", {
    paymentId: payment._id.toString(),
    appointmentId: appointment._id.toString(),
    razorpayOrderId: razorpayOrder.id,
  });

  // BUGFIX (audit finding): STATUS_TRANSITIONS only allows APPROVED ->
  // PAYMENT_PENDING -> PAYMENT_COMPLETED, and completePaymentPostProcessing's
  // guard below only flips the appointment to PAYMENT_COMPLETED when its
  // CURRENT status is PAYMENT_PENDING (see paymentStatusGuard.test.mjs).
  // Nothing in this flow was ever making that first hop — every legitimately
  // successful payment was landing on an appointment still stuck at
  // APPROVED, failing the guard, and silently auto-refunding a real payment
  // instead of completing it. This is the exact same legal transition the
  // guard already expects, applied at the point the patient actually commits
  // to paying (order created), so cancellation between here and capture
  // still correctly blocks the later PAYMENT_COMPLETED flip.
  await Appointment.findByIdAndUpdate(appointment._id, { status: APPOINTMENT_STATUS.PAYMENT_PENDING });
  payment.paymentState = "pending";
  payment.stateHistory.push({ from: "order_created", to: "pending", source: "system", reason: "Appointment entered payment pending", at: new Date() });
  await payment.save();
  await PaymentAttempt.findOneAndUpdate(
    { paymentId: payment._id, attemptNumber: 1 },
    { status: "checkout_started", startedAt: new Date() },
  );

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

export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, paymentId, signature } = req.body;

  if (!razorpayOrderId || !paymentId || !signature) {
    throw new AppError("Razorpay order id, payment id, and signature are required", 400);
  }

  const payment = await Payment.findOne({ razorpayOrderId }).select("+signature");
  if (!payment) throw new AppError("Payment order not found", 404);
  if (payment.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only verify your own payments", 403);
  }
  if (payment.status === PAYMENT_STATUS.CAPTURED) {
    throw new AppError("Payment has already been verified", 409);
  }

  if (payment.paymentState === "completed" || payment.paymentState === "post_processing") {
    return res.status(200).json({ success: true, data: { payment, invoice: null, postProcessingIncomplete: payment.postProcessingState !== "complete" }, message: "Payment is already being processed" });
  }

  const isValidSignature = paymentGateway.verifyPaymentSignature({ razorpayOrderId, paymentId, signature });
  if (!isValidSignature) {
    const previousState = payment.paymentState || "pending";
    payment.paymentState = "verification_pending";
    payment.reconciliationState = "required";
    payment.stateHistory.push({ from: previousState, to: "verification_pending", source: "patient", reason: "Gateway signature verification failed; authoritative state requires review", at: new Date() });
    await payment.save();
    throw new AppError("Payment verification could not be confirmed. Your payment status is being checked.", 400);
  }

  let gatewayPayment;
  try {
    gatewayPayment = await paymentGateway.fetchPayment({ paymentId, orderId: payment.gatewayOrderId || razorpayOrderId, amount: payment.gatewayAmount || payment.totalAmount, currency: payment.currency });
  } catch {
    const previousState = payment.paymentState || "pending";
    payment.paymentState = "verification_pending";
    payment.reconciliationState = "required";
    payment.stateHistory.push({ from: previousState, to: "verification_pending", source: "gateway", reason: "Gateway payment lookup failed", at: new Date() });
    await payment.save();
    throw new AppError("Payment status could not be confirmed yet. Please check payment status again.", 503);
  }

  const expectedPaise = toPaise(payment.gatewayAmount || payment.totalAmount);
  const gatewayAmountPaise = gatewayPayment?.amount == null ? expectedPaise : Number(gatewayPayment.amount);
  const gatewayCurrency = String(gatewayPayment?.currency || payment.currency).toUpperCase();
  if (gatewayPayment?.order_id && gatewayPayment.order_id !== payment.gatewayOrderId) {
    throw new AppError("Payment order does not match this transaction", 400);
  }
  if (gatewayAmountPaise !== expectedPaise || gatewayCurrency !== payment.currency) {
    const previousState = payment.paymentState || "pending";
    payment.paymentState = "reconciliation_required";
    payment.reconciliationState = "required";
    payment.stateHistory.push({ from: previousState, to: "reconciliation_required", source: "gateway", reason: "Gateway amount or currency did not match authoritative payment", at: new Date() });
    await payment.save();
    throw new AppError("Payment details could not be reconciled. Please contact support.", 409);
  }
  if (gatewayPayment?.status && !["captured", "processed"].includes(String(gatewayPayment.status).toLowerCase())) {
    payment.paymentState = "failed";
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failedAt = new Date();
    payment.stateHistory.push({ from: "pending", to: "failed", source: "gateway", reason: `Gateway payment status: ${gatewayPayment.status}`, at: new Date() });
    await payment.save();
    throw new AppError("Payment was not captured by the payment provider.", 402);
  }

  payment.paymentId = paymentId;
  payment.gatewayPaymentId = paymentId;
  payment.signature = signature;
  payment.status = PAYMENT_STATUS.CAPTURED;
  payment.paymentState = "captured";
  payment.reconciliationState = "matched";
  payment.paidAt = new Date();
  payment.postProcessingState = "pending";
  payment.stateHistory.push({ from: "pending", to: "captured", source: "server_verification", reason: "Gateway signature, order, amount and currency verified", at: new Date() });
  await payment.save();
  await PaymentAttempt.findOneAndUpdate(
    { paymentId: payment._id, gatewayOrderId: razorpayOrderId },
    { gatewayPaymentId: paymentId, status: "captured", completedAt: new Date() },
  );

  // Post-capture side effects (wallet debit, coupon, appointment update,
  // payout, invoice, consultation history, ledger, email, realtime) are
  // idempotent and extracted into completePaymentPostProcessing so they can
  // be safely retried. Money has already moved (signature verified), so a
  // failure here must NOT be reported to the patient as a failed payment —
  // that would risk a confusing duplicate payment attempt. Instead we log
  // clearly and let reconciliation finish the job; the same idempotent
  // function can be re-run without side-effect duplication.
  let invoice;
  let postProcessingIncomplete = false;

  try {
    const result = await completePaymentPostProcessing(payment);
    invoice = result.invoice;
  } catch (error) {
    postProcessingIncomplete = true;
    payment.postProcessingState = "failed";
    payment.paymentState = "post_processing_failed";
    payment.reconciliationState = "required";
    payment.stateHistory = payment.stateHistory || [];
    payment.stateHistory.push({ from: "post_processing", to: "post_processing_failed", source: "system", reason: error.message, at: new Date() });
    await payment.save().catch(() => {});
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
    data: { payment, invoice: invoice || null, postProcessingIncomplete },
    message: postProcessingIncomplete
      ? "Payment verified. Invoice/receipt generation is still finishing — it will appear shortly."
      : "Payment verified successfully",
  });
});

// P23 (Section 5) — RECOVERY. The frontend's authoritative source of truth
// when a checkout was interrupted (browser closed, callback missed, tab
// killed before the Razorpay handler fired). Resolves the most recent
// Payment for this appointment belonging to the caller and reports its
// real backend state plus its attempt history, so the UI never has to
// guess or silently create a second payment order while one is unresolved.
// This never mutates state — it is a pure read of the same fields
// verifyPayment/webhookHandler already maintain.
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

  // Coarse recovery classification the frontend can branch on directly
  // (Section 5) without re-deriving payment-state semantics itself.
  let recoveryState = "UNKNOWN";
  if (["captured", "post_processing", "completed", "partially_refunded", "refunded"].includes(payment.status)) {
    recoveryState = "SUCCESS";
  } else if (payment.status === "failed") {
    recoveryState = "FAILED";
  } else if (["created", "pending"].includes(payment.status) || payment.paymentState === "verification_pending") {
    recoveryState = "PENDING";
  } else if (payment.status === "reconciliation_required" || payment.reconciliationState === "required") {
    recoveryState = "REQUIRES_RECONCILIATION";
  } else if (["cancelled", "expired"].includes(payment.status)) {
    recoveryState = "FAILED";
  }

  res.status(200).json({
    success: true,
    data: { payment, attempts, recoveryState },
    message: "Payment status fetched successfully",
  });
});

// P23 (Section 6) — RETRY. A failed/expired payment gets a genuinely new
// PaymentAttempt + a genuinely new gateway order, on the SAME Payment
// document (never a second Payment for the same appointment — the
// frontend must never fabricate a new attempt locally). Blocked once the
// payment has already captured, or once it has moved into a state retry
// cannot legally reach (paymentStateMachine enforces the actual hop).
export const retryPayment = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id, "payment id");

  const payment = await Payment.findById(req.params.id);
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only retry your own payments", 403);
  }
  if (!["failed", "expired"].includes(payment.status)) {
    throw new AppError("This payment is not eligible for retry.", 409);
  }

  const previousAttemptCount = await PaymentAttempt.countDocuments({ paymentId: payment._id });

  const receipt = `retry_${payment._id.toString().slice(-12)}_${previousAttemptCount + 1}`;
  let razorpayOrder;
  try {
    razorpayOrder = await paymentGateway.createOrder({
      amount: payment.gatewayAmount || payment.totalAmount,
      currency: payment.currency,
      receipt,
      notes: {
        appointmentId: payment.appointmentId.toString(),
        patientId: req.user._id.toString(),
        retryOfPaymentId: payment._id.toString(),
        module: "hms_finance",
      },
    });
  } catch (error) {
    transactionLogger.payment("Retry order creation failed", {
      paymentId: payment._id.toString(),
      error: error?.response?.data || error.message,
    });
    throw error;
  }

  await PaymentAttempt.create({
    paymentId: payment._id,
    attemptNumber: previousAttemptCount + 1,
    gateway: paymentGateway.mode(),
    gatewayOrderId: razorpayOrder.id,
    status: "created",
    amount: payment.gatewayAmount || payment.totalAmount,
    currency: payment.currency,
    startedAt: new Date(),
  });

  payment.razorpayOrderId = razorpayOrder.id;
  payment.gatewayOrderId = razorpayOrder.id;
  payment.retryCount = (payment.retryCount || 0) + 1;
  payment.paymentState = "order_created";
  appendPaymentTransition(payment, PAYMENT_STATUS.ORDER_CREATED, {
    actorId: req.user._id,
    source: "patient",
    reason: `Retry attempt ${previousAttemptCount + 1}`,
  });
  await payment.save();

  transactionLogger.payment("Payment retry order created", {
    paymentId: payment._id.toString(),
    attemptNumber: previousAttemptCount + 1,
    razorpayOrderId: razorpayOrder.id,
  });

  res.status(201).json({
    success: true,
    data: {
      payment,
      order: razorpayOrder,
      razorpayKeyId: paymentGateway.keyId(),
      gateway: paymentGateway.mode(),
      attemptNumber: previousAttemptCount + 1,
    },
    message: "Retry payment order created successfully",
  });
});

export const completeTestPayment = asyncHandler(async (req, res) => {
  if (paymentGateway.mode() !== "test") throw new AppError("Test payment gateway is disabled", 404);
  const { razorpayOrderId } = req.body;
  const payment = await Payment.findOne({ gatewayOrderId: razorpayOrderId, userId: req.user._id });
  if (!payment) throw new AppError("Payment order not found", 404);
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
  const filter = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role) ? {} : { userId: req.user._id };

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
  const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(user.role);
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

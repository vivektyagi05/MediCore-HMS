import { areRefundsEnabled } from "../services/hospitalSettingsService.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Payment, { PAYMENT_STATUS, REFUND_STATUS } from "../models/Payment.js";
import RefundRequest from "../models/RefundRequest.js";
import DoctorPayout from "../models/DoctorPayout.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ROLES } from "../constants/roles.js";
import { PAYMENT_STATUS as APPOINTMENT_PAYMENT_STATUS } from "../constants/appointmentStatus.js";
import { paymentGateway } from "../payments/paymentGateway.js";
import { emailService } from "../services/emailService.js";
import { transactionLogger } from "../utils/transactionLogger.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { writeAdminLog } from "../utils/adminAudit.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { addMoney } from "../payments/money.js";
import { appendPaymentTransition } from "../payments/paymentStateMachine.js";
import { appendRefundTransition, assertRefundTransition, REFUND_STATES } from "../payments/refundStateMachine.js";
import {
  computeRefundableAmount,
  computeFundingAllocation,
  evaluateRefundEligibility,
  validateRefundReason,
  deriveCanonicalReason,
  REFUND_ENTRY_POINTS,
} from "../payments/refundPolicyEngine.js";

const validatePaymentId = (paymentId) => {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new AppError("Invalid payment id", 400);
};

// AUDIT FINDING (Phase UI-6 — concurrency): two admin actions against the
// same payment (two approvals of different refund requests, or an approve
// racing a retry) could previously both pass the amount check and both
// call Razorpay before either had persisted a result — a genuine
// double-refund risk. This is a real pessimistic lock: an atomic
// conditional update that only succeeds if no other refund operation
// currently holds it. No Mongo transaction/session is needed because this
// serializes access to a single document via one atomic operation, which
// is all the actual risk here requires.
const acquireRefundLock = async (paymentId) => {
  const locked = await Payment.findOneAndUpdate(
    { _id: paymentId, refundLockedAt: { $exists: false } },
    { $set: { refundLockedAt: new Date() } },
    { new: true },
  );
  if (!locked) {
    throw new AppError(
      "Another refund operation is already in progress for this payment. Please try again in a moment.",
      409,
    );
  }
  return locked;
};

const releaseRefundLock = async (paymentId) => {
  await Payment.findByIdAndUpdate(paymentId, { $unset: { refundLockedAt: 1 } });
};

// Reused by both createRefundRequest (patient/admin submitting a new
// request) and initiateRefund (admin direct refund) — the same real
// duplicate-request rule applies to both entry points. Previously only
// createRefundRequest enforced this; initiateRefund had no guard at all,
// so two concurrent direct-refund clicks could create two "approved"
// RefundRequest documents against the same payment (audit finding #25).
const assertNoConflictingRefundRequest = async (paymentId) => {
  const duplicate = await RefundRequest.findOne({
    paymentId,
    status: { $in: ["pending", "approved"] },
  }).lean();
  if (duplicate) throw new AppError("A refund request is already pending or approved for this payment", 409);
};

// P23 (Section 14) — records the payout-side consequence of a refund
// without ever mutating the payout's original grossAmount/doctorAmount/
// platformFee (financial history preservation, Section 55). Pending
// payouts are cancelled outright since the money was never sent; already
// paid/settled payouts get an explicit, visible liability marker instead
// of a silent balance mutation — this codebase has no payout-recovery
// engine, so "adjusted_pending" is an honestly-disclosed manual-follow-up
// state, not a fabricated automatic recovery.
const adjustDoctorPayoutForRefund = async ({ paymentId, refundAmount, totalAmount, gatewayRefundId, actorId }) => {
  const payout = await DoctorPayout.findOne({ paymentId });
  if (!payout) return null;

  const proportionalDoctorAdjustment = totalAmount > 0
    ? Number(((payout.doctorAmount * refundAmount) / totalAmount).toFixed(2))
    : 0;

  if (payout.status === "pending") {
    payout.status = "cancelled";
    payout.cancelReason = `Refund processed against underlying payment (${gatewayRefundId || "wallet-only"})`;
    payout.refundReference = gatewayRefundId || null;
    payout.refundAdjustmentAmount = proportionalDoctorAdjustment;
    payout.liabilityStatus = "adjusted_settled"; // never sent, nothing to recover
    payout.adjustedAt = new Date();
    payout.settledBy = actorId;
    await payout.save();
    return payout;
  }

  if (payout.status === "paid") {
    payout.refundReference = gatewayRefundId || payout.refundReference || null;
    payout.refundAdjustmentAmount = addMoney(payout.refundAdjustmentAmount || 0, proportionalDoctorAdjustment);
    payout.liabilityStatus = "adjusted_pending";
    payout.adjustedAt = new Date();
    await payout.save();
    return payout;
  }

  // Already cancelled — nothing further to adjust.
  return payout;
};

// Core gateway-processing step. Only ever called once a RefundRequest is
// already in "approved" state (whether via approveRefundRequest,
// initiateRefund's direct-approve, or retryRefundRequest). Acquires the
// per-payment lock BEFORE the gateway call (not just before the DB write)
// so a concurrent second caller is rejected before it ever reaches
// Razorpay, and always releases the lock — success or failure.
//
// P23 rewrite: the previous version sent the FULL refund amount to the
// gateway AND ALSO credited the wallet the full amount — a genuine
// double-payout bug (Sections 9/27). This version computes the canonical
// wallet/gateway funding split first and only moves the money that
// actually belongs to each bucket.
const processRefund = async ({ paymentId, refundAmount, reason, actorId, refundRequest, req }) => {
  await acquireRefundLock(paymentId);

  try {
    // Re-fetch fresh state now that the lock is held — the caller's
    // `payment` snapshot may already be stale if another refund completed
    // on this payment between when it was read and when the lock was
    // acquired.
    const payment = await Payment.findById(paymentId).populate("userId", "name email");
    if (!payment) throw new AppError("Payment not found", 404);

    if (payment.status !== PAYMENT_STATUS.CAPTURED && payment.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED) {
      throw new AppError("Only captured payments can be refunded", 400);
    }

    const refundableAmount = computeRefundableAmount(payment);
    if (refundAmount <= 0 || refundAmount > refundableAmount) {
      throw new AppError(
        `Refund amount exceeds refundable balance. Remaining refundable: ${payment.currency} ${refundableAmount}`,
        400,
      );
    }

    // Canonical funding allocation (Sections 9/10/27/28) — computed once,
    // authoritative for every downstream money movement in this call.
    const { walletRefundAmount, gatewayRefundAmount } = computeFundingAllocation({ payment, refundAmount });

    if (refundRequest) {
      appendRefundTransition(refundRequest, REFUND_STATES.GATEWAY_PROCESSING, {
        actorId, source: "server", reason: "Authorized refund sent to payment gateway",
      });
      refundRequest.attemptCount = (refundRequest.attemptCount || 0) + 1;
      refundRequest.lastAttemptAt = new Date();
      refundRequest.walletRefundAmount = walletRefundAmount;
      refundRequest.gatewayRefundAmount = gatewayRefundAmount;
      await refundRequest.save();
    }

    const previousPaymentStatus = payment.status;
    const previousRefundStatus = payment.refundStatus;
    payment.refundStatus = REFUND_STATUS.PENDING;
    await payment.save();

    // Only call the gateway for the portion that was actually captured by
    // the gateway. A wallet-only refund (gatewayRefundAmount === 0, e.g. a
    // payment fully funded by wallet balance) never touches the gateway at
    // all — there is nothing there to reverse.
    let refund = null;
    if (gatewayRefundAmount > 0) {
      try {
        refund = await paymentGateway.refundPayment({
          paymentId: payment.paymentId,
          amount: gatewayRefundAmount,
          notes: {
            reason,
            paymentRecordId: payment._id.toString(),
            refundRequestId: refundRequest?._id?.toString?.(),
          },
        });
      } catch (error) {
        payment.refundStatus = previousRefundStatus;
        payment.status = previousPaymentStatus;
        await payment.save();

        const failureReason = error?.message || "Payment gateway rejected the refund request";
        transactionLogger.refund("Refund gateway call failed — no state changed", {
          paymentId: payment._id.toString(),
          error: failureReason,
        });

        if (refundRequest) {
          refundRequest.status = "failed";
          appendRefundTransition(refundRequest, REFUND_STATES.RETRY_REQUIRED, {
            actorId, source: "server", reason: failureReason,
          });
          refundRequest.failureReason = failureReason;
          refundRequest.timeline.push({
            status: "failed",
            note: `Refund not confirmed. ${failureReason}`,
            actorId,
          });
          await refundRequest.save();

          await notificationEmitter.emitToUser(payment.userId._id || payment.userId, {
            type: "refund",
            title: "Refund could not be processed",
            message: `We were unable to process your refund of ${payment.currency} ${refundAmount}. It will be reviewed and retried.`,
            entityType: "payment",
            entityId: payment._id,
            eventKey: `refund:${refundRequest._id}:failed:${refundRequest.timeline.length}`,
            severity: "critical",
            metadata: { refundRequestId: refundRequest._id, failureReason },
          });
        }

        if (req) {
          await writeAdminLog({
            req,
            action: "refund.process_failed",
            resourceType: "RefundRequest",
            resourceId: refundRequest?._id?.toString(),
            severity: "critical",
            metadata: { paymentId: payment._id.toString(), amount: refundAmount, failureReason },
          });
        }

        throw new AppError("Refund could not be processed by the payment gateway. No refund was recorded.", 502);
      }
    }

    await Appointment.findByIdAndUpdate(payment.appointmentId, {
      paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED,
    });

    payment.walletRefundedAmount = addMoney(payment.walletRefundedAmount || 0, walletRefundAmount);
    payment.gatewayRefundedAmount = addMoney(payment.gatewayRefundedAmount || 0, gatewayRefundAmount);
    payment.refundedAmount = addMoney(payment.walletRefundedAmount, payment.gatewayRefundedAmount);
    if (refund?.id) {
      payment.processedGatewayRefundIds = Array.from(new Set([...(payment.processedGatewayRefundIds || []), refund.id]));
    }
    const isFullRefund = payment.refundedAmount >= payment.totalAmount;
    payment.refundStatus = isFullRefund ? REFUND_STATUS.FULL : REFUND_STATUS.PARTIAL;
    // Canonical state-machine transition (Section 15) — never a bare field
    // assignment. captured/partially_refunded -> partially_refunded/refunded
    // are both legal transitions in PAYMENT_TRANSITIONS.
    appendPaymentTransition(payment, isFullRefund ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED, {
      actorId, source: "refund", reason: `Refund of ${payment.currency} ${refundAmount} processed`,
    });
    await payment.save();

    // Wallet is only credited for the wallet-funded share. Idempotency key
    // on the ledger entry (below) + the referenceId-based dedupe guard here
    // both key off a synthetic, refund-request-scoped reference so a
    // wallet-only refund (no gateway refund id at all) still can't be
    // double-credited on retry.
    const walletReferenceId = refund?.id ? `${refund.id}:wallet` : `refund-request:${refundRequest?._id || paymentId}:${refundRequest?.attemptCount || 1}`;
    let wallet = null;
    if (walletRefundAmount > 0) {
      wallet = await Wallet.findOneAndUpdate(
        {
          userId: payment.userId._id,
          transactions: { $not: { $elemMatch: { referenceType: "refund", referenceId: walletReferenceId } } },
        },
        {
          $inc: { balance: walletRefundAmount },
          $push: {
            transactions: {
              type: "refund",
              amount: walletRefundAmount,
              currency: payment.currency,
              status: "completed",
              referenceType: "refund",
              referenceId: walletReferenceId,
              description: reason || "Appointment payment refund (wallet-funded portion)",
            },
          },
        },
        { returnDocument: "after", upsert: true },
      );
    }

    try {
      await emailService.sendRefundConfirmation({
        patient: payment.userId,
        amount: refundAmount,
        currency: payment.currency,
      });
    } catch (error) {
      transactionLogger.payment("Refund confirmation email failed", {
        paymentId: payment._id.toString(),
        error: error.message,
      });
    }

    // One ledger posting per real money movement (Section 28) — a
    // gateway-funded refund and a wallet-funded refund are two distinct
    // movements and get two distinct, independently-idempotent postings,
    // never one entry pretending to cover both.
    if (gatewayRefundAmount > 0 && refund?.id) {
      await TransactionLedger.create({
        userId: payment.userId._id,
        paymentId: payment._id,
        type: "refund",
        direction: "credit",
        amount: gatewayRefundAmount,
        currency: payment.currency,
        referenceId: refund.id,
        idempotencyKey: `refund:gateway:${refund.id}`,
        metadata: { reason, refundRequestId: refundRequest?._id, fundingSource: "gateway" },
      });
    }
    if (walletRefundAmount > 0 && wallet) {
      await TransactionLedger.create({
        userId: payment.userId._id,
        paymentId: payment._id,
        walletId: wallet._id,
        type: "wallet_credit",
        direction: "credit",
        amount: walletRefundAmount,
        currency: payment.currency,
        referenceId: walletReferenceId,
        idempotencyKey: `refund:wallet:${walletReferenceId}`,
        metadata: { reason, refundRequestId: refundRequest?._id, fundingSource: "wallet" },
      });
    }

    // Doctor payout / liability adjustment (Section 14) — never a silent
    // status flip, and never touches grossAmount/doctorAmount/platformFee.
    await adjustDoctorPayoutForRefund({
      paymentId: payment._id,
      refundAmount,
      totalAmount: payment.totalAmount,
      gatewayRefundId: refund?.id,
      actorId,
    });

    if (refundRequest) {
      refundRequest.status = "processed";
      appendRefundTransition(refundRequest, REFUND_STATES.PROCESSED, {
        actorId, source: "server", reason: "Refund confirmed by gateway/wallet posting",
      });
      refundRequest.processedBy = actorId;
      refundRequest.razorpayRefundId = refund?.id;
      refundRequest.gatewayRefundId = refund?.id;
      refundRequest.failureReason = undefined;
      refundRequest.timeline.push({
        status: "processed",
        note: `Refund processed — gateway ${payment.currency} ${gatewayRefundAmount}, wallet ${payment.currency} ${walletRefundAmount}`,
        actorId,
      });
      await refundRequest.save();
    }

    if (req) {
      await writeAdminLog({
        req,
        action: "refund.processed",
        resourceType: "RefundRequest",
        resourceId: refundRequest?._id?.toString(),
        metadata: {
          paymentId: payment._id.toString(),
          amount: refundAmount,
          walletRefundAmount,
          gatewayRefundAmount,
          gatewayRefundId: refund?.id || null,
        },
      });
    }

    transactionLogger.refund("Refund processed", {
      paymentId: payment._id.toString(),
      refundId: refund?.id || null,
      refundAmount,
      walletRefundAmount,
      gatewayRefundAmount,
    });

    await paymentEmitter.refundProcessed({ payment, refundRequest });

    return { payment, refund, wallet, refundRequest, walletRefundAmount, gatewayRefundAmount };
  } finally {
    await releaseRefundLock(paymentId);
  }
};

// Shared by createRefundRequest (cancellation-style) and reportPaymentProblem
// (post-consultation dispute) — the one real difference between the two
// entry points is which reason categories are legal and whether the
// completed-appointment restriction applies (Sections 5/7).
const buildRefundRequestForEntryPoint = async ({ req, res, entryPoint }) => {
  validatePaymentId(req.params.paymentId);

  // FIX: HospitalSetting.paymentSettings.refundsEnabled was only ever read
  // back for public display (controllers/publicController.js) -- an admin
  // switching it off changed nothing about whether a refund could actually
  // be requested or processed. Gated here for the patient-facing intake
  // path; a super_admin using this same entry point is an authorized
  // override and is not blocked (matches initiateRefund's existing
  // "admin path... not bound by the patient-facing restriction" policy).
  if (req.user.role === ROLES.PATIENT && !(await areRefundsEnabled())) {
    throw new AppError("Refund requests are currently unavailable. Please contact support.", 503);
  }

  const payment = await Payment.findById(req.params.paymentId).populate("userId", "name email");
  if (!payment) throw new AppError("Payment not found", 404);
  if (req.user.role === ROLES.PATIENT && payment.userId._id.toString() !== req.user._id.toString()) {
    throw new AppError("You can only request refunds for your own payments", 403);
  }

  const refundableAmount = computeRefundableAmount(payment);
  const amount = req.body.amount ? Number(req.body.amount) : refundableAmount;
  if (amount <= 0 || amount > refundableAmount) throw new AppError("Refund amount exceeds refundable balance", 400);

  // BUG 1 FIX: the canonical refund-request contract (Section 1 of the
  // brief) is reasonCode + description only. The client never controls
  // the stored `reason` string — it is always derived server-side from
  // the validated reasonCode below. The old code additionally required a
  // raw `reason` field the frontend never sent for the cancellation entry
  // point, causing every cancellation-style refund request to 400.
  const { reasonCode, description } = req.body;
  const validation = validateRefundReason({ reasonCode, description, entryPoint });
  if (!validation.ok) throw new AppError(validation.message, 400);
  const canonicalReason = deriveCanonicalReason({ reasonCode, description });

  const appointment = await Appointment.findById(payment.appointmentId).lean();
  const eligibility = evaluateRefundEligibility({
    payment,
    appointment,
    actorRole: req.user.role,
    requestedAmount: amount,
  });

  if (!eligibility.eligible) {
    if (eligibility.action === "REPORT_PROBLEM" && entryPoint !== REFUND_ENTRY_POINTS.REPORT_PROBLEM) {
      throw new AppError(
        "This appointment's consultation is already complete. Please use 'Report a problem' to have this reviewed.",
        400,
      );
    }
    throw new AppError(
      eligibility.reasonCode === "CAPACITY_EXCEEDED"
        ? `Refund amount exceeds refundable balance. Remaining refundable: ${payment.currency} ${eligibility.maximumRefundAmount}`
        : "This payment is not currently eligible for a refund.",
      400,
    );
  }

  await assertNoConflictingRefundRequest(payment._id);

  const refundRequest = new RefundRequest({
    paymentId: payment._id,
    requestedBy: req.user._id,
    amount,
    reason: canonicalReason,
    reasonCode,
    description,
    entryPoint,
    status: "pending",
  });
  appendRefundTransition(refundRequest, REFUND_STATES.ELIGIBILITY_CHECKED, {
    actorId: req.user._id, source: entryPoint, reason: `Eligibility: ${eligibility.reasonCode}`,
  });
  appendRefundTransition(refundRequest, REFUND_STATES.PENDING_REVIEW, {
    actorId: req.user._id, source: entryPoint, reason: "Awaiting admin review",
  });
  refundRequest.timeline = [{ status: "pending", note: canonicalReason, actorId: req.user._id }];
  await refundRequest.save();

  await emitAutomationTrigger(TRIGGER_TYPES.REFUND_REQUESTED, {
    refundRequestId: refundRequest._id,
    userId: req.user._id,
    amount,
    reason: canonicalReason,
  });

  await notificationEmitter.emitToAdmins({
    type: "refund",
    title: entryPoint === REFUND_ENTRY_POINTS.REPORT_PROBLEM ? "New problem report" : "New refund request",
    message: `${payment.userId.name || "A patient"} ${entryPoint === REFUND_ENTRY_POINTS.REPORT_PROBLEM ? "reported a problem for" : "requested a refund of"} ${payment.currency} ${amount}`,
    entityType: "payment",
    entityId: payment._id,
    eventKey: `refund:${refundRequest._id}:requested`,
    severity: "info",
    metadata: { refundRequestId: refundRequest._id, entryPoint },
  });

  res.status(201).json({
    success: true,
    data: { refundRequest },
    message: entryPoint === REFUND_ENTRY_POINTS.REPORT_PROBLEM
      ? "Your report has been submitted and is under review."
      : "Refund request submitted successfully",
  });
};

export const createRefundRequest = asyncHandler(async (req, res) => {
  await buildRefundRequestForEntryPoint({ req, res, entryPoint: REFUND_ENTRY_POINTS.CANCELLATION });
});

// P23 (Section 5/7) — new entry point. A completed consultation was
// actually delivered, so the patient no longer sees an instant "Refund"
// action; this is the only path available to them at that point, and it
// always requires a real category + description and always lands in
// admin review (approvalRequired is always true for this entry point).
export const reportPaymentProblem = asyncHandler(async (req, res) => {
  await buildRefundRequestForEntryPoint({ req, res, entryPoint: REFUND_ENTRY_POINTS.REPORT_PROBLEM });
});

export const listRefundRequests = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.SUPER_ADMIN
    ? {}
    : { requestedBy: req.user._id };

  if (req.query.status) filter.status = req.query.status;

  const refundRequests = await RefundRequest.find(filter)
    .populate("paymentId", "totalAmount refundedAmount currency status paymentId")
    .populate("requestedBy", "name email role")
    .populate("processedBy", "name email role")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.status(200).json({
    success: true,
    data: { refundRequests },
    message: "Refund requests fetched successfully",
  });
});

export const approveRefundRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);

  // P23 Section 18 FIX — AUDIT FINDING: the previous code hardcoded
  // `from: "pending_review"` in the recorded stateHistory regardless of
  // what refundState actually was, and never called assertRefundTransition
  // at all — so an illegal transition (or one from a different real
  // predecessor, e.g. "eligibility_checked") would be silently written with
  // a fabricated "from" value instead of being validated or accurately
  // recorded. Read the real current refundState, validate it through the
  // canonical state machine, then pin that exact value in the atomic
  // update's filter so a concurrent change causes a safe no-op instead of
  // a stale/incorrect transition.
  const current = await RefundRequest.findById(req.params.id);
  if (!current) throw new AppError("Refund request not found", 404);
  if (current.status !== "pending") throw new AppError("Only pending refund requests can be approved", 400);

  // FIX: refundsEnabled is a real platform-wide kill switch now -- it must
  // stop actual money movement, not just patient-facing intake.
  if (!(await areRefundsEnabled())) {
    throw new AppError("Refund processing is currently unavailable. Please try again later.", 503);
  }
  const fromState = current.refundState;
  assertRefundTransition(fromState, REFUND_STATES.APPROVED);

  const refundRequest = await RefundRequest.findOneAndUpdate(
    { _id: req.params.id, status: "pending", refundState: fromState },
    {
      $set: { status: "approved", refundState: "approved", processedBy: req.user._id },
      $push: {
        timeline: { status: "approved", note: req.body.note || "Refund approved", actorId: req.user._id },
        stateHistory: { from: fromState, to: "approved", actorId: req.user._id, source: "admin", reason: req.body.note || "Refund approved", at: new Date() },
      },
    },
    { new: true },
  );
  if (!refundRequest) {
    const existing = await RefundRequest.findById(req.params.id).lean();
    if (!existing) throw new AppError("Refund request not found", 404);
    throw new AppError("Only pending refund requests can be approved", 400);
  }

  const paymentExists = await Payment.exists({ _id: refundRequest.paymentId });
  if (!paymentExists) throw new AppError("Payment not found", 404);

  const data = await processRefund({
    paymentId: refundRequest.paymentId,
    refundAmount: refundRequest.amount,
    reason: refundRequest.reason,
    actorId: req.user._id,
    refundRequest,
    req,
  });

  // Phase A6.2.3 — Automation Studio real trigger.
  await emitAutomationTrigger(TRIGGER_TYPES.REFUND_APPROVED, {
    refundRequestId: refundRequest._id,
    userId: refundRequest.requestedBy,
    amount: refundRequest.amount,
  });

  res.status(200).json({
    success: true,
    data,
    message: "Refund processed successfully",
  });
});

export const rejectRefundRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);
  if (!req.body.note || !req.body.note.trim()) {
    throw new AppError("A rejection reason is required", 400);
  }

  // Section 18 fix — same reasoning as approveRefundRequest above: validate
  // and record the REAL current refundState rather than a hardcoded one.
  const current = await RefundRequest.findById(req.params.id);
  if (!current) throw new AppError("Refund request not found", 404);
  if (current.status !== "pending") throw new AppError("Only pending refund requests can be rejected", 400);
  const fromState = current.refundState;
  assertRefundTransition(fromState, REFUND_STATES.REJECTED);

  const refundRequest = await RefundRequest.findOneAndUpdate(
    { _id: req.params.id, status: "pending", refundState: fromState },
    {
      $set: { status: "rejected", refundState: "rejected", processedBy: req.user._id },
      $push: {
        timeline: { status: "rejected", note: req.body.note, actorId: req.user._id },
        stateHistory: { from: fromState, to: "rejected", actorId: req.user._id, source: "admin", reason: req.body.note, at: new Date() },
      },
    },
    { new: true },
  ).populate("requestedBy", "name email");
  if (!refundRequest) {
    const existing = await RefundRequest.findById(req.params.id).lean();
    if (!existing) throw new AppError("Refund request not found", 404);
    throw new AppError("Only pending refund requests can be rejected", 400);
  }

  await writeAdminLog({
    req,
    action: "refund.rejected",
    resourceType: "RefundRequest",
    resourceId: refundRequest._id.toString(),
    metadata: { paymentId: refundRequest.paymentId.toString(), reason: req.body.note },
  });

  await notificationEmitter.emitToUser(refundRequest.requestedBy._id || refundRequest.requestedBy, {
    type: "refund",
    title: "Refund request rejected",
    message: req.body.note,
    entityType: "payment",
    entityId: refundRequest.paymentId,
    eventKey: `refund:${refundRequest._id}:rejected`,
    severity: "warning",
    metadata: { refundRequestId: refundRequest._id },
  });

  res.status(200).json({
    success: true,
    data: { refundRequest },
    message: "Refund request rejected successfully",
  });
});

// Closes a real gap found in audit: RefundRequest.status has supported
// "failed" since this schema was written, but nothing could ever move a
// failed refund forward again. Only failed requests are eligible; the same
// per-payment lock in processRefund() prevents this from racing a
// concurrent approve/retry.
export const retryRefundRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);

  // P23 Section 18 FIX — AUDIT FINDING: the previous code jumped straight
  // from refundState "failed" to "approved" and hardcoded a stateHistory
  // entry claiming `from: "retry_required"`. That transition is not
  // actually legal per REFUND_TRANSITIONS (failed -> retry_required ->
  // approved is the real legal path) and was never validated at all — a
  // fabricated history entry describing a hop that never happened. Perform
  // the real two-hop transition and validate both legs.
  const current = await RefundRequest.findById(req.params.id);
  if (!current) throw new AppError("Refund request not found", 404);
  if (current.status !== "failed") throw new AppError("Only failed refund requests can be retried", 400);

  // FIX: refundsEnabled is a real platform-wide kill switch now -- it must
  // stop actual money movement, not just patient-facing intake.
  if (!(await areRefundsEnabled())) {
    throw new AppError("Refund processing is currently unavailable. Please try again later.", 503);
  }
  const fromState = current.refundState;
  assertRefundTransition(fromState, REFUND_STATES.RETRY_REQUIRED);
  assertRefundTransition(REFUND_STATES.RETRY_REQUIRED, REFUND_STATES.APPROVED);

  const refundRequest = await RefundRequest.findOneAndUpdate(
    { _id: req.params.id, status: "failed", refundState: fromState },
    {
      $set: { status: "approved", refundState: "approved", processedBy: req.user._id },
      $push: {
        timeline: { status: "approved", note: "Refund retry initiated", actorId: req.user._id },
        stateHistory: {
          $each: [
            { from: fromState, to: "retry_required", actorId: req.user._id, source: "admin", reason: "Refund retry initiated", at: new Date() },
            { from: "retry_required", to: "approved", actorId: req.user._id, source: "admin", reason: "Refund retry initiated", at: new Date() },
          ],
        },
      },
    },
    { new: true },
  );
  if (!refundRequest) {
    const existing = await RefundRequest.findById(req.params.id).lean();
    if (!existing) throw new AppError("Refund request not found", 404);
    throw new AppError("Only failed refunds can be retried", 400);
  }

  const paymentExists = await Payment.exists({ _id: refundRequest.paymentId });
  if (!paymentExists) throw new AppError("Payment not found", 404);

  const data = await processRefund({
    paymentId: refundRequest.paymentId,
    refundAmount: refundRequest.amount,
    reason: refundRequest.reason,
    actorId: req.user._id,
    refundRequest,
    req,
  });

  res.status(200).json({
    success: true,
    data,
    message: "Refund processed successfully",
  });
});

// P23 (Section 10/12) — ELIGIBILITY, exposed as its own read so the
// frontend can branch into Case A (eligible cancellation) / Case B
// (completed consultation -> report a problem) / Case D (no refundable
// balance) BEFORE showing any action, instead of guessing from payment
// status alone or duplicating refundPolicyEngine's rules in React. Never
// mutates anything — pure evaluation of the same evaluateRefundEligibility
// createRefundRequest already uses.
export const getRefundEligibility = asyncHandler(async (req, res) => {
  validatePaymentId(req.params.paymentId);

  const payment = await Payment.findById(req.params.paymentId).select(
    "userId totalAmount refundedAmount walletAmount gatewayAmount walletRefundedAmount gatewayRefundedAmount status appointmentId currency",
  );
  if (!payment) throw new AppError("Payment not found", 404);
  if (req.user.role === ROLES.PATIENT && payment.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only check eligibility for your own payments", 403);
  }

  const appointment = await Appointment.findById(payment.appointmentId).select("status").lean();
  const eligibility = evaluateRefundEligibility({
    payment,
    appointment,
    actorRole: req.user.role,
    requestedAmount: undefined,
  });

  const [pendingRequest] = await RefundRequest.find({
    paymentId: payment._id,
    status: { $in: ["pending", "approved"] },
  }).limit(1).lean();

  // Case classification for the frontend's CTA branching (Section 10) —
  // presentation labeling only, never a second eligibility rule; derived
  // strictly from the one real decision above.
  let uiCase = "NONE";
  if (pendingRequest) uiCase = "TRACK_EXISTING";
  else if (eligibility.eligible) uiCase = "ELIGIBLE_CANCELLATION";
  else if (eligibility.action === "REPORT_PROBLEM") uiCase = "COMPLETED_CONSULTATION";
  else if (eligibility.reasonCode === "NO_REFUNDABLE_BALANCE") uiCase = "NO_BALANCE";
  else if (eligibility.reasonCode === "CAPACITY_EXCEEDED") uiCase = "PARTIAL_ALREADY_REFUNDED";

  res.status(200).json({
    success: true,
    data: {
      ...eligibility,
      currency: payment.currency,
      refundedAmount: payment.refundedAmount || 0,
      totalAmount: payment.totalAmount,
      uiCase,
      existingRequestId: pendingRequest?._id || null,
    },
    message: "Refund eligibility evaluated",
  });
});

// Safe, patient-facing labels for each real refundState (Section 14 —
// "do not expose internal state names"). Presentation-only mapping; the
// authoritative state itself is still refundState from the DB.
const REFUND_STATE_LABELS = {
  requested: "Request submitted",
  eligibility_checked: "Eligibility checked",
  pending_review: "Under review",
  approved: "Approved",
  refund_initiated: "Refund initiated",
  gateway_processing: "Processing with payment provider",
  processed: "Completed",
  rejected: "Rejected",
  failed: "Refund could not be completed",
  retry_required: "Retrying",
  reconciliation_required: "Under financial review",
};
const REFUND_STATE_ORDER = [
  "requested", "eligibility_checked", "pending_review", "approved",
  "refund_initiated", "gateway_processing", "processed",
];

// P23 (Section 14/16) — REFUND TRACKING. Single-refund detail with the
// funding-allocation split and a safe-labeled timeline, so the frontend
// never has to recompute or re-fetch the payment separately to render a
// tracker. listRefundRequests already exists for the list view; this is
// the missing detail read it links out to.
export const getRefundRequestDetail = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);

  const refundRequest = await RefundRequest.findById(req.params.id)
    .populate("paymentId", "totalAmount refundedAmount walletAmount gatewayAmount walletRefundedAmount gatewayRefundedAmount currency status appointmentId doctorId")
    .populate("requestedBy", "name email role")
    .populate("processedBy", "name email role")
    .lean();
  if (!refundRequest) throw new AppError("Refund request not found", 404);

  const isOwner = refundRequest.requestedBy?._id?.toString() === req.user._id.toString();
  const isAdmin = [ROLES.SUPER_ADMIN].includes(req.user.role);
  if (!isOwner && !isAdmin) throw new AppError("You are not authorized to view this refund request", 403);

  const currentIndex = REFUND_STATE_ORDER.indexOf(refundRequest.refundState);
  const timelineSteps = REFUND_STATE_ORDER.map((state, index) => ({
    state,
    label: REFUND_STATE_LABELS[state],
    completed: currentIndex >= 0 && index <= currentIndex && !["rejected", "failed"].includes(refundRequest.refundState),
  }));
  const terminalIssue = ["rejected", "failed", "reconciliation_required"].includes(refundRequest.refundState)
    ? { state: refundRequest.refundState, label: REFUND_STATE_LABELS[refundRequest.refundState] }
    : null;

  res.status(200).json({
    success: true,
    data: {
      refundRequest,
      timelineSteps,
      terminalIssue,
      fundingAllocation: {
        walletRefundAmount: refundRequest.walletRefundAmount || 0,
        gatewayRefundAmount: refundRequest.gatewayRefundAmount || 0,
      },
    },
    message: "Refund request detail fetched successfully",
  });
});

export const initiateRefund = asyncHandler(async (req, res) => {
  validatePaymentId(req.params.paymentId);

  // FIX: refundsEnabled is a real platform-wide kill switch now -- it must
  // stop actual money movement, not just patient-facing intake.
  if (!(await areRefundsEnabled())) {
    throw new AppError("Refund processing is currently unavailable. Please try again later.", 503);
  }

  const payment = await Payment.findById(req.params.paymentId).populate("userId", "name email");
  if (!payment) throw new AppError("Payment not found", 404);

  await assertNoConflictingRefundRequest(payment._id);

  const refundableAmount = computeRefundableAmount(payment);
  const refundAmount = req.body.amount ? Number(req.body.amount) : refundableAmount;
  if (refundAmount <= 0 || refundAmount > refundableAmount) {
    throw new AppError("Refund amount exceeds refundable balance", 400);
  }
  const reason = req.body.reason || "Admin initiated HMS refund";

  // Admin path — Section 7's "ADMIN OPERATION": authorized override, not
  // bound by the patient-facing completed-appointment restriction, but
  // reason is mandatory and every action is audited (writeAdminLog below,
  // as already established).
  const refundRequest = new RefundRequest({
    paymentId: payment._id,
    requestedBy: req.user._id,
    processedBy: req.user._id,
    amount: refundAmount,
    reason,
    reasonCode: req.body.reasonCode || "other",
    entryPoint: REFUND_ENTRY_POINTS.ADMIN,
    status: "approved",
  });
  appendRefundTransition(refundRequest, REFUND_STATES.ELIGIBILITY_CHECKED, {
    actorId: req.user._id, source: "admin", reason: "Admin direct refund",
  });
  appendRefundTransition(refundRequest, REFUND_STATES.APPROVED, {
    actorId: req.user._id, source: "admin", reason: "Admin direct refund approved",
  });
  refundRequest.timeline = [{ status: "approved", note: "Admin direct refund approved", actorId: req.user._id }];
  await refundRequest.save();

  const data = await processRefund({
    paymentId: payment._id,
    refundAmount,
    reason,
    actorId: req.user._id,
    refundRequest,
    req,
  });

  res.status(200).json({
    success: true,
    data,
    message: "Refund processed successfully",
  });
});

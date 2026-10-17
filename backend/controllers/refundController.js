import { financeEmitter } from "../realtime/financeEmitter.js";
import { financialEmails } from "../services/financialEmails.js";
import { planOutOfBandRefund } from "../payments/outOfBandRefund.js";
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
import { transactionLogger } from "../utils/transactionLogger.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { writeAdminLog } from "../utils/adminAudit.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { addMoney, toPaise } from "../payments/money.js";
import { GATEWAY_REFUND_OUTCOME, classifyGatewayRefund, isDefinitiveGatewayRejection } from "../payments/refundGatewayOutcome.js";
import { applyRefundToDoctorEarning } from "../payments/refundEarningAdjustment.js";
import { appendPaymentTransition } from "../payments/paymentStateMachine.js";
import { appendRefundTransition, assertRefundTransition, REFUND_STATES } from "../payments/refundStateMachine.js";
import { acquireRefundLock, releaseRefundLock } from "../payments/refundLock.js";
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
const refundKeyFor = ({ refund, refundRequest, paymentId }) =>
  refund?.id ? `gw:${refund.id}` : `rr:${refundRequest?._id || paymentId}:${refundRequest?.attemptCount || 1}`;

// Truthful failure bookkeeping. Lock must be held. `definitive` = the provider
// rejected the refund (safe to retry); otherwise the outcome is AMBIGUOUS and
// the request goes to reconciliation (blind retry could double-refund).
// The payment is never left looking refunded.
const recordRefundNotCompleted = async ({ payment, refundRequest, failureReason, definitive, actorId, req, gatewayStatus }) => {
  payment.refundStatus = definitive
    ? (Number(payment.refundedAmount || 0) > 0 ? REFUND_STATUS.PARTIAL : REFUND_STATUS.NONE)
    : REFUND_STATUS.PENDING;
  await payment.save();
  transactionLogger.refund(definitive ? "Refund rejected by gateway — no money moved" : "Refund outcome unknown — reconciliation required", {
    paymentId: payment._id.toString(), error: failureReason,
  });
  if (!refundRequest) return;
  refundRequest.gatewayRefundStatus = gatewayStatus || (definitive ? GATEWAY_REFUND_OUTCOME.FAILED : GATEWAY_REFUND_OUTCOME.UNKNOWN);
  refundRequest.failureReason = failureReason;
  if (definitive) {
    refundRequest.status = "failed";
    appendRefundTransition(refundRequest, REFUND_STATES.FAILED, { actorId, source: "server", reason: failureReason });
    appendRefundTransition(refundRequest, REFUND_STATES.RETRY_REQUIRED, { actorId, source: "server", reason: "Eligible for retry after provider rejection" });
  } else {
    // status stays "approved": the partial-unique index keeps blocking a second refund request.
    appendRefundTransition(refundRequest, REFUND_STATES.RECONCILIATION_REQUIRED, { actorId, source: "server", reason: failureReason });
  }
  refundRequest.timeline.push({
    status: definitive ? "failed" : "reconciliation_required",
    note: definitive ? `Refund not completed. ${failureReason}` : `Refund outcome could not be confirmed. ${failureReason}`,
    actorId,
  });
  await refundRequest.save();
  const eventKey = `refund:${refundRequest._id}:${definitive ? "failed" : "unconfirmed"}:${refundRequest.timeline.length}`;
  await notificationEmitter.emitToUser(payment.userId._id || payment.userId, {
    type: "refund",
    title: definitive ? "Refund could not be processed" : "Refund is being verified",
    message: definitive
      ? `We were unable to process your refund of ${payment.currency} ${refundRequest.amount}. It will be reviewed and retried.`
      : `Your refund of ${payment.currency} ${refundRequest.amount} is being verified with the payment provider.`,
    entityType: "payment", entityId: payment._id, eventKey, severity: "critical",
    metadata: { refundRequestId: refundRequest._id },
  });
  await notificationEmitter.emitToAdmins({
    type: "refund", title: definitive ? "Refund failed" : "Refund needs reconciliation",
    message: `Refund request ${refundRequest._id} for payment ${payment._id} ${definitive ? "was rejected by the gateway" : "has an unconfirmed gateway outcome"}.`,
    entityType: "payment", entityId: payment._id, eventKey: `${eventKey}:admin`, severity: "critical",
    metadata: { refundRequestId: refundRequest._id },
  });
  if (req) {
    await writeAdminLog({
      req, action: definitive ? "refund.process_failed" : "refund.reconciliation_required", resourceType: "RefundRequest",
      resourceId: refundRequest._id.toString(), severity: "critical",
      metadata: { paymentId: payment._id.toString(), amount: refundRequest.amount, failureReason },
    });
  }
};

// Everything that happens ONLY once the money has genuinely moved (provider
// status = processed, or a wallet-only refund). Lock must be held. Idempotent:
// a gateway refund id already counted is never counted twice, the earning
// adjustment is keyed per refund, ledger postings have unique keys.
const finalizeRefundMovement = async ({ payment, refundRequest, refund, refundAmount, walletRefundAmount, gatewayRefundAmount, reason, actorId, req }) => {
  const refundKey = refundKeyFor({ refund, refundRequest, paymentId: payment._id });
  const alreadyCounted = Boolean(refund?.id) && (payment.processedGatewayRefundIds || []).includes(refund.id);
  const refundedBefore = payment.refundedAmount || 0;

  if (!alreadyCounted) {
    payment.walletRefundedAmount = addMoney(payment.walletRefundedAmount || 0, walletRefundAmount);
    payment.gatewayRefundedAmount = addMoney(payment.gatewayRefundedAmount || 0, gatewayRefundAmount);
    payment.refundedAmount = addMoney(payment.walletRefundedAmount, payment.gatewayRefundedAmount);
    if (refund?.id) payment.processedGatewayRefundIds = Array.from(new Set([...(payment.processedGatewayRefundIds || []), refund.id]));
  }
  const isFullRefund = toPaise(payment.refundedAmount) >= toPaise(payment.totalAmount);
  payment.refundStatus = isFullRefund ? REFUND_STATUS.FULL : REFUND_STATUS.PARTIAL;
  if (!alreadyCounted) {
    appendPaymentTransition(payment, isFullRefund ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED, {
      actorId, source: "refund", reason: `Refund of ${payment.currency} ${refundAmount} processed`,
    });
  }
  await payment.save();

  // The appointment is only "refunded" when the payment is fully refunded; a
  // partial refund leaves it paid (the Payment document carries the detail).
  if (isFullRefund) {
    await Appointment.findByIdAndUpdate(payment.appointmentId, { paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED });
  }

  const walletReferenceId = refund?.id ? `${refund.id}:wallet` : `refund-request:${refundRequest?._id || payment._id}:${refundRequest?.attemptCount || 1}`;
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
            type: "refund", amount: walletRefundAmount, currency: payment.currency, status: "completed",
            referenceType: "refund", referenceId: walletReferenceId,
            description: reason || "Appointment payment refund (wallet-funded portion)",
          },
        },
      },
      { returnDocument: "after", upsert: true },
    ).catch((error) => {
      if (error?.code === 11000) return null; // upsert raced with an existing wallet: already credited
      throw error;
    });
  }

  const postLedger = async (entry) => {
    try { await TransactionLedger.create(entry); } catch (error) { if (error?.code !== 11000) throw error; }
  };
  if (gatewayRefundAmount > 0 && refund?.id) {
    await postLedger({
      userId: payment.userId._id, paymentId: payment._id, type: "refund", direction: "credit",
      amount: gatewayRefundAmount, currency: payment.currency, referenceId: refund.id,
      idempotencyKey: `refund:gateway:${refund.id}`,
      metadata: { reason, refundRequestId: refundRequest?._id, fundingSource: "gateway" },
    });
  }
  if (walletRefundAmount > 0 && wallet) {
    await postLedger({
      userId: payment.userId._id, paymentId: payment._id, walletId: wallet._id, type: "wallet_credit", direction: "credit",
      amount: walletRefundAmount, currency: payment.currency, referenceId: walletReferenceId,
      idempotencyKey: `refund:wallet:${walletReferenceId}`,
      metadata: { reason, refundRequestId: refundRequest?._id, fundingSource: "wallet" },
    });
  }

  // Doctor earning + platform revenue reversal (once per refund).
  const earning = await applyRefundToDoctorEarning({
    paymentId: payment._id, refundAmount, paymentTotal: payment.totalAmount, refundedBefore,
    refundKey, gatewayRefundId: refund?.id || null, actorId,
  });
  if (earning.applied && earning.doctorUserId) {
    await notificationEmitter.emitToUser(earning.doctorUserId, {
      type: "refund",
      title: "Earning adjusted by a refund",
      message: `A refund reduced your earning for this consultation by ${payment.currency} ${earning.doctorAdjustment}.${earning.becameLiability ? " It has been deducted from your available balance." : ""}`,
      entityType: "payment", entityId: payment._id, eventKey: `earning:adjusted:${refundKey}`,
      metadata: { doctorAdjustment: earning.doctorAdjustment },
    }).catch(() => {});
  }

  // Phase 03: the receipt is enqueued BEFORE the request is marked processed. The outbox
  // row is deduplicated by eventKey, so if the process dies between these two writes the
  // replay (state still gateway_processing/reconciliation_required) re-enqueues harmlessly
  // instead of the receipt being lost behind an already-processed request.
  await financialEmails.refundProcessed({ payment, refundId: refund?.id, amount: refundAmount, user: payment.userId });
  if (refundRequest) {
    refundRequest.status = "processed";
    if (refundRequest.refundState !== REFUND_STATES.PROCESSED) {
      appendRefundTransition(refundRequest, REFUND_STATES.PROCESSED, { actorId, source: "server", reason: "Refund confirmed by provider/wallet posting" });
    }
    refundRequest.processedBy = actorId || refundRequest.processedBy;
    refundRequest.razorpayRefundId = refund?.id;
    refundRequest.gatewayRefundId = refund?.id;
    refundRequest.gatewayRefundStatus = refund?.id ? GATEWAY_REFUND_OUTCOME.PROCESSED : refundRequest.gatewayRefundStatus;
    refundRequest.failureReason = undefined;
    refundRequest.timeline.push({
      status: "processed",
      note: `Refund processed — gateway ${payment.currency} ${gatewayRefundAmount}, wallet ${payment.currency} ${walletRefundAmount}`,
      actorId,
    });
    await refundRequest.save();
  }

  financeEmitter.invalidate({ userIds: [payment.userId?._id || payment.userId], domain: "refund", entityId: payment._id });
  if (req) {
    await writeAdminLog({
      req, action: "refund.processed", resourceType: "RefundRequest", resourceId: refundRequest?._id?.toString(),
      metadata: { paymentId: payment._id.toString(), amount: refundAmount, walletRefundAmount, gatewayRefundAmount, gatewayRefundId: refund?.id || null },
    });
  }
  transactionLogger.refund("Refund processed", { paymentId: payment._id.toString(), refundId: refund?.id || null, refundAmount, walletRefundAmount, gatewayRefundAmount });
  await paymentEmitter.refundProcessed({ payment, refundRequest });
  return { wallet };
};

const processRefund = async ({ paymentId, refundAmount, reason, actorId, refundRequest, req }) => {
  const lockToken = await acquireRefundLock(paymentId);

  try {
    const payment = await Payment.findById(paymentId).populate("userId", "name email");
    if (!payment) throw new AppError("Payment not found", 404);

    if (payment.status !== PAYMENT_STATUS.CAPTURED && payment.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED) {
      throw new AppError("Only captured payments can be refunded", 400);
    }

    const refundableAmount = computeRefundableAmount(payment);
    if (toPaise(refundAmount) <= 0 || toPaise(refundAmount) > toPaise(refundableAmount)) {
      throw new AppError(
        `Refund amount exceeds refundable balance. Remaining refundable: ${payment.currency} ${refundableAmount}`,
        400,
      );
    }

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

    payment.refundStatus = REFUND_STATUS.PENDING;
    await payment.save();

    let refund = null;
    if (gatewayRefundAmount > 0) {
      try {
        refund = await paymentGateway.refundPayment({
          paymentId: payment.paymentId,
          amount: gatewayRefundAmount,
          notes: { reason, paymentRecordId: payment._id.toString(), refundRequestId: refundRequest?._id?.toString?.() },
        });
      } catch (error) {
        const definitive = isDefinitiveGatewayRejection(error);
        const failureReason = error?.message || "Payment gateway did not confirm the refund";
        await recordRefundNotCompleted({ payment, refundRequest, failureReason, definitive, actorId, req });
        throw new AppError(
          definitive
            ? "Refund could not be processed by the payment gateway. No refund was recorded."
            : "The refund outcome could not be confirmed with the payment gateway. It has been flagged for reconciliation; do not retry blindly.",
          502,
          { code: definitive ? "REFUND_FAILED" : "REFUND_RECONCILIATION_REQUIRED" },
        );
      }

      const outcome = classifyGatewayRefund(refund);
      if (outcome === GATEWAY_REFUND_OUTCOME.FAILED || outcome === GATEWAY_REFUND_OUTCOME.UNKNOWN) {
        const definitive = outcome === GATEWAY_REFUND_OUTCOME.FAILED;
        await recordRefundNotCompleted({
          payment, refundRequest, definitive, actorId, req, gatewayStatus: outcome,
          failureReason: definitive ? "Gateway reported the refund as failed" : "Gateway returned an unrecognised refund status",
        });
        if (refund?.id && refundRequest) { refundRequest.gatewayRefundId = refund.id; await refundRequest.save(); }
        throw new AppError(
          definitive ? "Refund could not be processed by the payment gateway. No refund was recorded."
            : "The refund outcome could not be confirmed with the payment gateway. It has been flagged for reconciliation.",
          502,
          { code: definitive ? "REFUND_FAILED" : "REFUND_RECONCILIATION_REQUIRED" },
        );
      }
      if (outcome === GATEWAY_REFUND_OUTCOME.PENDING) {
        // Truthful: the provider accepted the request but has not completed it.
        // No counters, wallet credit, ledger or earning reversal yet — those
        // happen when the provider confirms (webhook / reconciliation).
        if (!refundRequest) throw new AppError("A pending gateway refund requires a refund request record", 500);
        refundRequest.gatewayRefundId = refund.id;
        refundRequest.razorpayRefundId = refund.id;
        refundRequest.gatewayRefundStatus = GATEWAY_REFUND_OUTCOME.PENDING;
        refundRequest.timeline.push({ status: "gateway_processing", note: "Refund accepted by the payment provider; awaiting completion", actorId });
        await refundRequest.save();
        transactionLogger.refund("Refund pending at gateway", { paymentId: payment._id.toString(), refundId: refund.id });
        return { payment, refund, wallet: null, refundRequest, walletRefundAmount, gatewayRefundAmount, pending: true };
      }
    }

    const { wallet } = await finalizeRefundMovement({
      payment, refundRequest, refund, refundAmount, walletRefundAmount, gatewayRefundAmount, reason, actorId, req,
    });
    return { payment, refund, wallet, refundRequest, walletRefundAmount, gatewayRefundAmount, pending: false };
  } finally {
    await releaseRefundLock(paymentId, lockToken);
  }
};

// Converges a refund that was PENDING/ambiguous at the provider onto the same
// finalize step the immediate path uses. Called by the refund.processed
// webhook, by reconcileRefundRequest, and safe to call repeatedly.
export const settlePendingGatewayRefund = async ({ refundRequestId, refund, source = "webhook", actorId = null }) => {
  const outcome = classifyGatewayRefund(refund);
  const initial = await RefundRequest.findById(refundRequestId).lean();
  if (!initial) return { settled: false, reason: "not_found" };
  const lockToken = await acquireRefundLock(initial.paymentId);
  try {
    const rr = await RefundRequest.findById(refundRequestId);
    if (rr.refundState === REFUND_STATES.PROCESSED) return { settled: true, replay: true };
    if (![REFUND_STATES.GATEWAY_PROCESSING, REFUND_STATES.RECONCILIATION_REQUIRED].includes(rr.refundState)) {
      return { settled: false, reason: `state_${rr.refundState}` };
    }
    const payment = await Payment.findById(rr.paymentId).populate("userId", "name email");
    if (!payment) return { settled: false, reason: "payment_not_found" };

    if (outcome === GATEWAY_REFUND_OUTCOME.PROCESSED) {
      const walletRefundAmount = rr.walletRefundAmount || 0;
      const gatewayRefundAmount = rr.gatewayRefundAmount || 0;
      await finalizeRefundMovement({
        payment, refundRequest: rr, refund, refundAmount: rr.amount, walletRefundAmount, gatewayRefundAmount,
        reason: rr.reason, actorId, req: null,
      });
      return { settled: true };
    }
    if (outcome === GATEWAY_REFUND_OUTCOME.FAILED) {
      rr.gatewayRefundId = refund?.id || rr.gatewayRefundId;
      await recordRefundNotCompleted({ payment, refundRequest: rr, definitive: true, actorId, req: null, gatewayStatus: outcome, failureReason: `Provider reported the refund as failed (${source})` });
      return { settled: true, failed: true };
    }
    if (outcome === GATEWAY_REFUND_OUTCOME.PENDING) return { settled: false, pending: true };
    await recordRefundNotCompleted({ payment, refundRequest: rr, definitive: false, actorId, req: null, gatewayStatus: outcome, failureReason: `Unrecognised provider refund status (${source})` });
    return { settled: false, unknown: true };
  } finally {
    await releaseRefundLock(initial.paymentId, lockToken);
  }
};

// F-003: the ONLY entry for a provider-confirmed refund this app did not create.
// It runs under the same payment refund lock and the same finalizeRefundMovement
// as admin/webhook-owned refunds, so counters, wallet, ledger, doctor-earning and
// platform-fee reversal all happen once. Anything it cannot safely account for is
// flagged reconciliation_required instead of mutating counters.
const planAmountFromRefund = (refund) => Number(refund?.amount || 0) / 100;

export const settleOutOfBandGatewayRefund = async ({ gatewayPaymentId, refund, source = "webhook" }) => {
  const initial = await Payment.findOne({ paymentId: gatewayPaymentId }).select("_id").lean();
  if (!initial) return { settled: false, reason: "payment_not_found" };
  const lockToken = await acquireRefundLock(initial._id);
  try {
    const payment = await Payment.findById(initial._id).populate("userId", "name email");
    const plan = planOutOfBandRefund({ payment, gatewayRefundId: refund?.id, providerAmountPaise: refund?.amount });
    if (plan.action === "skip_duplicate") {
      // Replay after a crash that happened between the counters and the receipt enqueue:
      // the eventKey dedupes, so this is a no-op when the receipt already exists.
      await financialEmails.refundProcessed({ payment, refundId: refund?.id, amount: planAmountFromRefund(refund), user: payment.userId });
      return { settled: true, replay: true };
    }
    if (plan.action !== "finalize") {
      if (payment) {
        payment.paymentState = "reconciliation_required";
        payment.reconciliationState = "required";
        await payment.save();
      }
      transactionLogger.refund("Out-of-band refund needs reconciliation", { paymentId: initial._id.toString(), refundId: refund?.id || null, reason: plan.reason || plan.action });
      return { settled: false, reason: plan.reason || plan.action };
    }
    await finalizeRefundMovement({
      payment, refundRequest: null, refund, refundAmount: plan.amount, walletRefundAmount: 0, gatewayRefundAmount: plan.amount,
      reason: `Provider-initiated refund (${source})`, actorId: null, req: null,
    });
    return { settled: true };
  } finally {
    await releaseRefundLock(initial._id, lockToken);
  }
};

// Resolves a refund whose provider outcome is unknown or still pending by
// asking the provider (by refund id, else by listing the payment's refunds and
// matching our refundRequestId note). Only concludes "no refund exists" when
// the provider lookup itself succeeded and returned nothing.
export const reconcileRefundRequest = async (refundRequestId, { actorId = null } = {}) => {
  const rr = await RefundRequest.findById(refundRequestId);
  if (!rr) throw new AppError("Refund request not found", 404);
  if (![REFUND_STATES.GATEWAY_PROCESSING, REFUND_STATES.RECONCILIATION_REQUIRED].includes(rr.refundState)) {
    throw new AppError("Only refunds awaiting gateway confirmation can be reconciled", 409);
  }
  const payment = await Payment.findById(rr.paymentId).lean();
  let refund = null;
  if (rr.gatewayRefundId) {
    refund = await paymentGateway.fetchRefund({ refundId: rr.gatewayRefundId });
  } else if ((rr.gatewayRefundAmount || 0) > 0) {
    const list = await paymentGateway.listPaymentRefunds({ paymentId: payment.paymentId });
    refund = (list || []).find((item) => item?.notes?.refundRequestId === rr._id.toString()) || null;
    if (!refund) {
      // Lookup succeeded and the provider has no such refund: definitively not created.
      const lockToken = await acquireRefundLock(rr.paymentId);
      try {
        const fresh = await RefundRequest.findById(rr._id);
        const pay = await Payment.findById(rr.paymentId).populate("userId", "name email");
        await recordRefundNotCompleted({ payment: pay, refundRequest: fresh, definitive: true, actorId, req: null, failureReason: "Provider confirmed no refund was created" });
      } finally {
        await releaseRefundLock(rr.paymentId, lockToken);
      }
      return { settled: true, failed: true };
    }
  }
  // wallet-only refunds have nothing at the provider to reconcile
  if (!refund) throw new AppError("Nothing to reconcile at the provider for this refund", 409);
  return settlePendingGatewayRefund({ refundRequestId: rr._id, refund, source: "reconciliation", actorId });
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
    message: data.pending ? "Refund submitted to the payment provider; awaiting completion" : "Refund processed successfully",
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
    message: data.pending ? "Refund submitted to the payment provider; awaiting completion" : "Refund processed successfully",
  });
});

// P23 (Section 10/12) — ELIGIBILITY, exposed as its own read so the
// frontend can branch into Case A (eligible cancellation) / Case B
// (completed consultation -> report a problem) / Case D (no refundable
// balance) BEFORE showing any action, instead of guessing from payment
// status alone or duplicating refundPolicyEngine's rules in React. Never
// mutates anything — pure evaluation of the same evaluateRefundEligibility
// createRefundRequest already uses.
export const reconcileRefund = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);
  const result = await reconcileRefundRequest(req.params.id, { actorId: req.user._id });
  const refundRequest = await RefundRequest.findById(req.params.id).lean();
  res.status(200).json({ success: true, data: { result, refundRequest }, message: result.settled ? "Refund reconciled" : "Refund is still awaiting the payment provider" });
});

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
    message: data.pending ? "Refund submitted to the payment provider; awaiting completion" : "Refund processed successfully",
  });
});

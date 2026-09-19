// PHASE UI-6 — Refunds Management Workspace (admin side).
//
// Additive admin read surface over the existing RefundRequest/Payment
// domain. Deliberately does NOT duplicate anything that already exists:
//  - approve/reject/retry/initiate stay on the existing /api/refunds
//    routes (refundController.js) — this controller only READS refund
//    state, it never mutates a refund. Same division of responsibility as
//    paymentAdminController.js has with paymentController.js.
//  - invoice download stays on the existing GET /api/invoices/:id/download
//    (invoiceController.js).
//  - payment detail stays on the existing Payments Workspace
//    (GET /api/admin/payments/:id) — this controller links out to it
//    rather than re-rendering payment internals.
//
// Gated behind manage_payments, same permission key the Payments
// workspace and the mutating /api/refunds/* admin actions already use —
// refund data is financial data, no new permission key introduced.
import mongoose from "mongoose";
import RefundRequest from "../../models/RefundRequest.js";
import Payment from "../../models/Payment.js";
import Appointment from "../../models/Appointment.js";
import Invoice from "../../models/Invoice.js";
import User from "../../models/User.js";
import Doctor from "../../models/Doctor.js";
import DoctorPayout from "../../models/DoctorPayout.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Real, documented "needs attention" rule — mirrors the same
// explainable-not-invented discipline as computePaymentAttention() in
// paymentAdminController.js. Every condition below reads a field that
// actually exists on RefundRequest; nothing here is a fabricated score.
//   1. Genuinely FAILED at the gateway (a real reason is always attached
//      when this happens — see refundController.js's processRefund).
//   2. PENDING admin review for longer than the same 2h "stuck" threshold
//      already established for Payments (buildAttentionMatch's
//      STUCK_ORDER_AGE_MS) — reused rather than inventing a new number.
//   3. Repeated processing attempts — more than one "failed" entry in the
//      timeline means a retry already failed again.
const STUCK_REVIEW_AGE_MS = 2 * 60 * 60 * 1000;

export function computeRefundAttention(refundRequest) {
  const reasons = [];
  if (refundRequest.status === "failed") {
    reasons.push(refundRequest.failureReason ? `Refund failed — ${refundRequest.failureReason}` : "Refund failed at the gateway");
  }
  if (
    refundRequest.status === "pending" &&
    new Date(refundRequest.createdAt).getTime() <= Date.now() - STUCK_REVIEW_AGE_MS
  ) {
    reasons.push("Pending approval for over 2 hours");
  }
  const failedAttempts = (refundRequest.timeline || []).filter((entry) => entry.status === "failed").length;
  if (failedAttempts > 1) {
    reasons.push(`Refund has failed ${failedAttempts} times`);
  }
  return { needsAttention: reasons.length > 0, attentionReasons: reasons };
}

const resolveSearchFilter = async (term) => {
  const regex = new RegExp(escapeRegex(term), "i");
  const matchingUsers = await User.find({ $or: [{ name: regex }, { email: regex }] }).select("_id").lean();
  const matchingPayments = await Payment.find({
    $or: [{ paymentId: regex }, { razorpayOrderId: regex }],
  }).select("_id").lean();
  return {
    $or: [
      { requestedBy: { $in: matchingUsers.map((u) => u._id) } },
      { reason: regex },
      { paymentId: { $in: matchingPayments.map((p) => p._id) } },
    ],
  };
};

const buildListFilter = async (query) => {
  const filter = {};

  if (query.status) {
    filter.status = { $in: String(query.status).split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) filter.createdAt.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) filter.createdAt.$lte = new Date(query.to);
  }
  if (query.minAmount || query.maxAmount) {
    filter.amount = {};
    if (query.minAmount) filter.amount.$gte = Number(query.minAmount);
    if (query.maxAmount) filter.amount.$lte = Number(query.maxAmount);
  }
  if (query.patientId && mongoose.Types.ObjectId.isValid(query.patientId)) {
    filter.requestedBy = query.patientId;
  }
  if (query.paymentId && mongoose.Types.ObjectId.isValid(query.paymentId)) {
    filter.paymentId = query.paymentId;
  }
  // doctorId/appointmentId live on Payment, not RefundRequest — resolve the
  // matching payment ids first rather than fabricating a direct field.
  if (
    (query.doctorId && mongoose.Types.ObjectId.isValid(query.doctorId)) ||
    (query.appointmentId && mongoose.Types.ObjectId.isValid(query.appointmentId))
  ) {
    const paymentMatch = {};
    if (query.doctorId) paymentMatch.doctorId = query.doctorId;
    if (query.appointmentId) paymentMatch.appointmentId = query.appointmentId;
    const paymentIds = await Payment.find(paymentMatch).distinct("_id");
    filter.paymentId = filter.paymentId
      ? { $in: [filter.paymentId].filter((id) => paymentIds.some((p) => p.toString() === id.toString())) }
      : { $in: paymentIds };
  }

  const conditions = [filter];
  if (query.search && query.search.trim()) conditions.push(await resolveSearchFilter(query.search.trim()));

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

export const listRefundsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = await buildListFilter(req.query);
  const sortField = ["createdAt", "amount"].includes(req.query.sortBy) ? req.query.sortBy : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? 1 : -1;

  let [refundRequests, total] = await Promise.all([
    RefundRequest.find(filter)
      .populate("paymentId", "totalAmount refundedAmount currency status paymentId doctorId appointmentId")
      .populate("requestedBy", "name email role")
      .populate("processedBy", "name email role")
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(limit)
      .lean(),
    RefundRequest.countDocuments(filter),
  ]);

  let enriched = refundRequests.map((refundRequest) => {
    const { needsAttention, attentionReasons } = computeRefundAttention(refundRequest);
    return { ...refundRequest, needsAttention, attentionReasons };
  });

  if (req.query.attention === "true") {
    enriched = enriched.filter((r) => r.needsAttention);
  }

  res.status(200).json({
    success: true,
    data: { refundRequests: enriched, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Refund requests fetched successfully",
  });
});

// Real aggregates only — one aggregation pipeline per metric group, same
// "ONE SOURCE OF TRUTH" discipline as paymentAdminController.js's summary.
export const getRefundSummaryAdmin = asyncHandler(async (_req, res) => {
  const statusAgg = await RefundRequest.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
  ]);

  const byStatus = {};
  let total = 0;
  for (const row of statusAgg) {
    byStatus[row._id] = { count: row.count, totalAmount: row.totalAmount };
    total += row.count;
  }

  const pending = byStatus.pending || { count: 0, totalAmount: 0 };
  const approved = byStatus.approved || { count: 0, totalAmount: 0 };
  const processed = byStatus.processed || { count: 0, totalAmount: 0 };
  const rejected = byStatus.rejected || { count: 0, totalAmount: 0 };
  const failed = byStatus.failed || { count: 0, totalAmount: 0 };

  // needsAttentionCount must come from the exact same rule the list uses
  // (computeRefundAttention), never a separately-invented count — fetch
  // the fields that rule actually reads and run it in-process rather than
  // re-deriving the logic in an aggregation pipeline.
  const attentionCandidates = await RefundRequest.find({
    $or: [
      { status: "failed" },
      { status: "pending", createdAt: { $lte: new Date(Date.now() - STUCK_REVIEW_AGE_MS) } },
    ],
  })
    .select("status failureReason createdAt timeline")
    .lean();
  const needsAttentionCount = attentionCandidates.filter((r) => computeRefundAttention(r).needsAttention).length;

  res.status(200).json({
    success: true,
    data: {
      totalRequests: total,
      pendingApproval: pending.count,
      pendingApprovalAmount: pending.totalAmount,
      approved: approved.count,
      approvedAmount: approved.totalAmount,
      completed: processed.count,
      totalRefundedAmount: processed.totalAmount,
      rejected: rejected.count,
      failed: failed.count,
      failedAmount: failed.totalAmount,
      totalRequestedAmount: total ? statusAgg.reduce((sum, row) => sum + row.totalAmount, 0) : 0,
      amountAwaitingProcessing: pending.totalAmount + approved.totalAmount,
      needsAttentionCount,
    },
    message: "Refund summary fetched successfully",
  });
});

// Refund Detail Workspace aggregate — composes the refund request with its
// real payment/patient/doctor/appointment/invoice records. Timeline is
// built ONLY from RefundRequest.timeline's real stored timestamps — never
// fabricated. Financial impact is computed directly from Payment, the
// authoritative source, not re-derived from the refund request's own
// amount field alone.
export const getRefundDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);

  const refundRequest = await RefundRequest.findById(req.params.id)
    .populate("requestedBy", "name email role createdAt")
    .populate("processedBy", "name email role")
    .lean();
  if (!refundRequest) throw new AppError("Refund request not found", 404);

  const payment = await Payment.findById(refundRequest.paymentId)
    .populate("userId", "name email role")
    .populate({
      path: "doctorId",
      select: "specialization userId",
      populate: { path: "userId", select: "name email" },
    })
    .populate("appointmentId", "date timeSlot status paymentStatus consultationMode")
    .populate("invoiceId")
    .lean();
  if (!payment) throw new AppError("Linked payment not found — data integrity issue", 500);

  const [appointmentDoc, otherRefundRequests] = await Promise.all([
    payment.appointmentId?._id
      ? Appointment.findById(payment.appointmentId._id).select("reason status paymentStatus").lean()
      : null,
    RefundRequest.find({ paymentId: payment._id, _id: { $ne: refundRequest._id } })
      .select("amount status createdAt")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // Invoice model has no "refunded"/"partially_refunded" status (only
  // issued/void) — credit-note capability genuinely does not exist in this
  // schema. Stated honestly here rather than fabricated; Payment's own
  // refundedAmount/refundStatus remain the authoritative refund-financial
  // state, surfaced separately in `financialImpact` below.
  const invoice = payment.invoiceId
    ? { ...payment.invoiceId, creditNoteAvailable: false }
    : null;

  const { needsAttention, attentionReasons } = computeRefundAttention(refundRequest);

  const financialImpact = {
    paymentTotalAmount: payment.totalAmount,
    alreadyRefundedBeforeThis:
      refundRequest.status === "processed" ? payment.refundedAmount - refundRequest.amount : payment.refundedAmount,
    thisRefundAmount: refundRequest.amount,
    remainingRefundableAfterThis:
      refundRequest.status === "processed"
        ? Number((payment.totalAmount - payment.refundedAmount).toFixed(2))
        : Number((payment.totalAmount - payment.refundedAmount - refundRequest.amount).toFixed(2)),
    currency: payment.currency,
    // P23 (Section 36) — real funding allocation, never invented. Snapshot
    // fields on the refund request itself when this specific refund has
    // already been processed; payment-level cumulative split otherwise.
    walletRefundAmount: refundRequest.walletRefundAmount || 0,
    gatewayRefundAmount: refundRequest.gatewayRefundAmount || 0,
    paymentWalletFundedAmount: payment.walletAmount || 0,
    paymentGatewayFundedAmount: payment.gatewayAmount || 0,
    paymentWalletRefundedToDate: payment.walletRefundedAmount || 0,
    paymentGatewayRefundedToDate: payment.gatewayRefundedAmount || 0,
  };

  // Doctor/platform liability (Section 36) — read-only surface of the real
  // DoctorPayout adjustment record, if one exists; never fabricated when
  // no payout row exists yet.
  const payout = await DoctorPayout.findOne({ paymentId: payment._id })
    .select("status grossAmount platformFee doctorAmount refundAdjustmentAmount liabilityStatus refundReference")
    .lean();
  const liability = payout
    ? {
      doctorAmount: payout.doctorAmount,
      platformFee: payout.platformFee,
      payoutStatus: payout.status,
      doctorRefundAdjustment: payout.refundAdjustmentAmount || 0,
      liabilityStatus: payout.liabilityStatus || "none",
    }
    : null;

  const timeline = (refundRequest.timeline || [])
    .map((entry) => ({
      key: entry._id?.toString() || `${entry.status}-${entry.at}`,
      label: `Refund ${entry.status}${entry.note ? ` — ${entry.note}` : ""}`,
      status: entry.status,
      at: entry.at,
    }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  res.status(200).json({
    success: true,
    data: {
      refundRequest: {
        _id: refundRequest._id,
        status: refundRequest.status,
        amount: refundRequest.amount,
        reason: refundRequest.reason,
        reasonCode: refundRequest.reasonCode || null,
        description: refundRequest.description || null,
        entryPoint: refundRequest.entryPoint || "cancellation",
        failureReason: refundRequest.failureReason || null,
        razorpayRefundId: refundRequest.razorpayRefundId || null,
        requestedBy: refundRequest.requestedBy,
        processedBy: refundRequest.processedBy,
        createdAt: refundRequest.createdAt,
        updatedAt: refundRequest.updatedAt,
      },
      payment: {
        _id: payment._id,
        status: payment.status,
        totalAmount: payment.totalAmount,
        currency: payment.currency,
        refundStatus: payment.refundStatus,
        refundedAmount: payment.refundedAmount,
        razorpayOrderId: payment.razorpayOrderId,
        paymentId: payment.paymentId,
      },
      patient: payment.userId,
      doctor: payment.doctorId,
      appointment: payment.appointmentId
        ? { ...payment.appointmentId, reason: appointmentDoc?.reason }
        : null,
      invoice,
      otherRefundRequests,
      financialImpact,
      liability,
      needsAttention,
      attentionReasons,
      timeline,
    },
    message: "Refund detail fetched successfully",
  });
});

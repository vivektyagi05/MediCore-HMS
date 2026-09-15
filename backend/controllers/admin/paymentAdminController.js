// PHASE UI-5 — Payments Management Workspace (admin side).
//
// Additive admin read surface over the existing Payment/RefundRequest/
// Invoice domain. Deliberately does NOT duplicate anything that already
// exists:
//  - order creation / verification stays on the existing
//    POST /api/payments/orders and /api/payments/verify
//    (paymentController.js) — untouched.
//  - refund request/approve/reject/initiate stays on the existing
//    /api/refunds routes (refundController.js) — this controller only
//    READS refund state, it never mutates a refund.
//  - invoice download stays on the existing GET /api/invoices/:id/download
//    (invoiceController.js) — this controller only reads invoice metadata.
//  - the retry/dead-letter concept (Payment.retryCount/nextRetryAt) and its
//    one real action (mark-reviewed) already exist in the Monitoring
//    Platform (monitoringAggregates.js buildPaymentRetryQueue() +
//    POST /api/admin/monitoring/retry-queue/:paymentId/resolve). This
//    controller surfaces that same real state for context; it does not
//    add a second resolve endpoint.
//
// The whole surface is gated behind manage_payments (not just individual
// fields) because, unlike Appointments/Patients, financial transaction
// data IS the entire subject matter here — there is no non-financial
// "restricted view" of a Payments workspace worth building.
import mongoose from "mongoose";
import Payment, { PAYMENT_STATUS, REFUND_STATUS } from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import Invoice from "../../models/Invoice.js";
import Appointment from "../../models/Appointment.js";
import User from "../../models/User.js";
import Doctor from "../../models/Doctor.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";

const PAYMENT_MAX_RETRIES = 3; // mirrors paymentRetryService.js's own MAX_RETRIES — see that file.

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Real, documented "needs attention" rule — every condition below reads a
// field that actually exists on Payment; nothing here is a fabricated
// score. Mirrors the same "explainable, not invented" discipline as
// appointmentAdminController.js's ATTENTION_MATCH.
//   1. Payment genuinely FAILED and has not been marked reviewed yet
//      (retryResolvedAt is null) — includes both "still retryable" and
//      "exhausted retries / dead-letter" failed payments.
//   2. A refund request is genuinely PENDING admin action for this payment.
//   3. Order was CREATED or is PENDING (checkout started, gateway step
//      never completed/captured) more than 2 hours ago — an abandoned or
//      stuck checkout that will never resolve itself.
const STUCK_ORDER_AGE_MS = 2 * 60 * 60 * 1000;

const buildAttentionMatch = (pendingRefundPaymentIds) => ({
  $or: [
    { status: PAYMENT_STATUS.FAILED, retryResolvedAt: null },
    { _id: { $in: pendingRefundPaymentIds } },
    {
      status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING] },
      createdAt: { $lte: new Date(Date.now() - STUCK_ORDER_AGE_MS) },
    },
  ],
});

// Same logic as buildAttentionMatch, applied to an already-loaded plain
// object (used for the per-row `needsAttention`/`attentionReasons` flags
// on list results, and by the reusable payment attention test).
export function computePaymentAttention(payment, hasPendingRefundRequest) {
  const reasons = [];
  if (payment.status === PAYMENT_STATUS.FAILED && !payment.retryResolvedAt) {
    reasons.push(
      payment.retryCount >= PAYMENT_MAX_RETRIES
        ? "Payment failed — retries exhausted (dead-letter)"
        : "Payment failed — awaiting retry",
    );
  }
  if (hasPendingRefundRequest) {
    reasons.push("Refund request pending review");
  }
  if (
    [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING].includes(payment.status) &&
    new Date(payment.createdAt).getTime() <= Date.now() - STUCK_ORDER_AGE_MS
  ) {
    reasons.push("Checkout stuck — order created but never completed");
  }
  return { needsAttention: reasons.length > 0, attentionReasons: reasons };
}

const resolveSearchFilter = async (term) => {
  const regex = new RegExp(escapeRegex(term), "i");
  const [matchingUsers, matchingDoctorsBySpecialization] = await Promise.all([
    User.find({ name: regex }).select("_id").lean(),
    Doctor.find({ specialization: regex }).select("_id").lean(),
  ]);
  const matchingDoctorsByUser = matchingUsers.length
    ? await Doctor.find({ userId: { $in: matchingUsers.map((u) => u._id) } }).select("_id").lean()
    : [];
  const doctorIds = [
    ...matchingDoctorsByUser.map((d) => d._id),
    ...matchingDoctorsBySpecialization.map((d) => d._id),
  ];
  return {
    $or: [
      { userId: { $in: matchingUsers.map((u) => u._id) } },
      { doctorId: { $in: doctorIds } },
      { razorpayOrderId: regex },
      { paymentId: regex },
    ],
  };
};

const buildListFilter = async (query, pendingRefundPaymentIds) => {
  const filter = {};

  if (query.status) {
    filter.status = { $in: String(query.status).split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (query.refundStatus) {
    filter.refundStatus = { $in: String(query.refundStatus).split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (query.doctorId && mongoose.Types.ObjectId.isValid(query.doctorId)) filter.doctorId = query.doctorId;
  if (query.patientId && mongoose.Types.ObjectId.isValid(query.patientId)) filter.userId = query.patientId;
  if (query.appointmentId && mongoose.Types.ObjectId.isValid(query.appointmentId)) {
    filter.appointmentId = query.appointmentId;
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) filter.createdAt.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) filter.createdAt.$lte = new Date(query.to);
  }
  if (query.minAmount || query.maxAmount) {
    filter.totalAmount = {};
    if (query.minAmount) filter.totalAmount.$gte = Number(query.minAmount);
    if (query.maxAmount) filter.totalAmount.$lte = Number(query.maxAmount);
  }

  const conditions = [filter];
  if (query.attention === "true") conditions.push(buildAttentionMatch(pendingRefundPaymentIds));
  if (query.search && query.search.trim()) conditions.push(await resolveSearchFilter(query.search.trim()));

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

export const listPaymentsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  // Needed both for the `attention=true` filter AND for per-row enrichment,
  // so resolved once up front rather than twice.
  const pendingRefundPaymentIds = await RefundRequest.find({ status: "pending" }).distinct("paymentId");

  const filter = await buildListFilter(req.query, pendingRefundPaymentIds);
  const sortField = ["createdAt", "totalAmount"].includes(req.query.sortBy) ? req.query.sortBy : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? 1 : -1;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("userId", "name email role")
      .populate({
        path: "doctorId",
        select: "specialization userId",
        populate: { path: "userId", select: "name email" },
      })
      .populate("appointmentId", "date timeSlot status")
      .populate("invoiceId", "invoiceNumber")
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  const pendingRefundSet = new Set(pendingRefundPaymentIds.map((id) => id.toString()));
  const enriched = payments.map((payment) => {
    const hasPendingRefund = pendingRefundSet.has(payment._id.toString());
    const { needsAttention, attentionReasons } = computePaymentAttention(payment, hasPendingRefund);
    return { ...payment, pendingRefundRequest: hasPendingRefund, needsAttention, attentionReasons };
  });

  res.status(200).json({
    success: true,
    data: { payments: enriched, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Payments fetched successfully",
  });
});

// Executive Payment Overview — real aggregates only, one aggregation
// pipeline per metric group (never five controllers computing the same
// total, per the mission's "ONE SOURCE OF TRUTH" rule).
export const getPaymentSummaryAdmin = asyncHandler(async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const pendingRefundPaymentIds = await RefundRequest.find({ status: "pending" }).distinct("paymentId");

  const [statusAgg, todayAgg, pendingRefundAgg, deadLetterCount, refundedTodayAgg, attentionCount] = await Promise.all([
    Payment.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          captured: { $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.CAPTURED] }, 1, 0] } },
          collected: {
            $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.CAPTURED] }, "$totalAmount", 0] },
          },
        },
      },
    ]),
    RefundRequest.aggregate([
      { $match: { status: "pending" } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]),
    Payment.countDocuments({
      status: PAYMENT_STATUS.FAILED,
      retryCount: { $gte: PAYMENT_MAX_RETRIES },
      retryResolvedAt: null,
    }),
    Payment.aggregate([
      { $match: { refundStatus: { $in: [REFUND_STATUS.FULL, REFUND_STATUS.PARTIAL] }, updatedAt: { $gte: startOfToday } } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: "$refundedAmount" } } },
    ]),
    Payment.countDocuments(buildAttentionMatch(pendingRefundPaymentIds)),
  ]);

  const byStatus = {};
  let totalPayments = 0;
  for (const row of statusAgg) {
    byStatus[row._id] = { count: row.count, totalAmount: row.totalAmount };
    totalPayments += row.count;
  }

  const captured = byStatus[PAYMENT_STATUS.CAPTURED] || { count: 0, totalAmount: 0 };
  const failed = byStatus[PAYMENT_STATUS.FAILED] || { count: 0, totalAmount: 0 };
  const refunded = byStatus[PAYMENT_STATUS.REFUNDED] || { count: 0, totalAmount: 0 };
  const partiallyRefunded = byStatus[PAYMENT_STATUS.PARTIALLY_REFUNDED] || { count: 0, totalAmount: 0 };
  const pending =
    (byStatus[PAYMENT_STATUS.CREATED]?.count || 0) + (byStatus[PAYMENT_STATUS.PENDING]?.count || 0);
  const pendingAmount =
    (byStatus[PAYMENT_STATUS.CREATED]?.totalAmount || 0) + (byStatus[PAYMENT_STATUS.PENDING]?.totalAmount || 0);

  // Refunded amount is tracked on Payment.refundedAmount (accumulates
  // across partial refunds), not on the REFUNDED/PARTIALLY_REFUNDED
  // status buckets' totalAmount (which sums the original payment amount,
  // a different real number) — summed directly instead of reusing
  // statusAgg's totalAmount for this metric.
  const refundedAmountAgg = await Payment.aggregate([
    { $match: { refundedAmount: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: "$refundedAmount" } } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalPayments,
      capturedPayments: captured.count,
      pendingPayments: pending,
      failedPayments: failed.count,
      refundedPayments: refunded.count,
      partiallyRefundedPayments: partiallyRefunded.count,
      grossCollected: captured.totalAmount,
      pendingAmount,
      failedAmount: failed.totalAmount,
      refundedAmount: refundedAmountAgg[0]?.total || 0,
      todaysPayments: todayAgg[0]?.count || 0,
      todaysCollection: todayAgg[0]?.collected || 0,
      todaysCaptured: todayAgg[0]?.captured || 0,
      refundsRequiringReview: pendingRefundAgg[0]?.count || 0,
      refundsRequiringReviewAmount: pendingRefundAgg[0]?.totalAmount || 0,
      deadLetterPayments: deadLetterCount,
      refundedToday: refundedTodayAgg[0]?.count || 0,
      refundedTodayAmount: refundedTodayAgg[0]?.totalAmount || 0,
      // Real deduplicated count (a payment can match more than one
      // attention condition) — the exact same set the `attention=true`
      // list filter returns, not a sum of the individual reason counts.
      needsAttentionCount: attentionCount,
    },
    message: "Payment summary fetched successfully",
  });
});

// Payment Detail Workspace aggregate — composes the payment with its real
// patient/appointment/doctor/refund/invoice records. Never fabricates a
// failure reason: Payment has no failure-reason/gateway-error field in
// this schema, so that is stated explicitly rather than invented.
export const getPaymentDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid payment id", 400);

  const payment = await Payment.findById(req.params.id)
    .populate("userId", "name email role createdAt")
    .populate({
      path: "doctorId",
      select: "specialization fees userId",
      populate: { path: "userId", select: "name email" },
    })
    .populate("appointmentId", "date timeSlot status paymentStatus consultationMode")
    .populate("invoiceId")
    .lean();

  if (!payment) throw new AppError("Payment not found", 404);

  const [refundRequests, appointmentDoc] = await Promise.all([
    RefundRequest.find({ paymentId: payment._id })
      .populate("requestedBy", "name email role")
      .populate("processedBy", "name email role")
      .sort({ createdAt: -1 })
      .lean(),
    payment.appointmentId?._id
      ? Appointment.findById(payment.appointmentId._id).select("reason status paymentStatus").lean()
      : null,
  ]);

  const hasPendingRefund = refundRequests.some((r) => r.status === "pending" || r.status === "approved");
  const { needsAttention, attentionReasons } = computePaymentAttention(payment, hasPendingRefund);

  // Timeline — ONLY real stored timestamps. This schema has no per-
  // transition log beyond createdAt/paidAt/failedAt/retryResolvedAt, so
  // intermediate gateway states are honestly not reconstructable and are
  // deliberately not fabricated here (same discipline as
  // appointmentAdminController.js's detail timeline).
  const timeline = [{ key: "created", label: "Payment order created", at: payment.createdAt }];
  if (payment.paidAt) timeline.push({ key: "paid", label: "Payment captured", at: payment.paidAt });
  if (payment.failedAt) timeline.push({ key: "failed", label: "Payment failed", at: payment.failedAt });
  if (payment.retryResolvedAt) {
    timeline.push({ key: "retry-resolved", label: "Marked reviewed (retry queue)", at: payment.retryResolvedAt });
  }
  for (const refund of refundRequests) {
    for (const entry of refund.timeline || []) {
      timeline.push({
        key: `refund-${refund._id}-${entry._id}`,
        label: `Refund ${entry.status}${entry.note ? ` — ${entry.note}` : ""}`,
        at: entry.at,
      });
    }
  }
  if (payment.invoiceId?.issuedAt) {
    timeline.push({ key: "invoice", label: `Invoice ${payment.invoiceId.invoiceNumber} issued`, at: payment.invoiceId.issuedAt });
  }
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  res.status(200).json({
    success: true,
    data: {
      payment: {
        _id: payment._id,
        status: payment.status,
        amount: payment.amount,
        discountAmount: payment.discountAmount,
        taxAmount: payment.taxAmount,
        totalAmount: payment.totalAmount,
        gatewayAmount: payment.gatewayAmount,
        walletAmount: payment.walletAmount,
        currency: payment.currency,
        gateway: payment.gateway,
        razorpayOrderId: payment.razorpayOrderId,
        paymentId: payment.paymentId,
        refundStatus: payment.refundStatus,
        refundedAmount: payment.refundedAmount,
        retryCount: payment.retryCount,
        nextRetryAt: payment.nextRetryAt,
        retryResolvedAt: payment.retryResolvedAt,
        maxRetries: PAYMENT_MAX_RETRIES,
        // Explicit, honest statement rather than a fabricated reason —
        // this schema has no gateway-error/failure-reason field.
        failureReasonAvailable: false,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      },
      patient: payment.userId,
      doctor: payment.doctorId,
      appointment: payment.appointmentId
        ? {
            ...payment.appointmentId,
            reason: appointmentDoc?.reason,
          }
        : null,
      invoice: payment.invoiceId || null,
      refundRequests,
      needsAttention,
      attentionReasons,
      timeline,
    },
    message: "Payment detail fetched successfully",
  });
});

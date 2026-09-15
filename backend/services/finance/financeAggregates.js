// PHASE UI-7 — Finance Executive Command Center.
//
// Single source of truth for every financial number shown anywhere in the
// Finance surface (Executive Dashboard, Finance Operations/Collections,
// Invoice Operations). Mirrors the discipline already established by
// paymentAdminController.js's computePaymentAttention and
// refundAdminController.js's computeRefundAttention: every figure here is
// a real aggregation over Payment/RefundRequest/Invoice/AdminActivityLog —
// nothing is estimated, fabricated, or hardcoded.
//
// AUDIT FINDING (Phase UI-7): before this file existed, the legacy
// AdminFinanceDashboard.jsx called paymentController.js's
// getFinancialSummary (patient/legacy fields: totalEarnings, successRatio,
// walletBalances, recurringRevenue) while the Payments workspace used a
// completely different aggregate shape (grossCollected, pendingAmount,
// etc) from paymentAdminController.js's getPaymentSummaryAdmin — two
// independently-computed "revenue" numbers with no guarantee of agreement.
// This module does not replace either (both remain valid, narrower-scope
// aggregates used by their own pages), but it IS the one place Finance's
// own KPIs are computed, so Finance never disagrees with itself across its
// own Overview/Collections/Reconciliation/Attention views.
//
// Reused, not duplicated: computePaymentAttention (paymentAdminController)
// and computeRefundAttention (refundAdminController) are imported directly
// rather than re-implemented, so Finance's attention queue can never drift
// from what the Payments/Refunds workspaces themselves consider "needs
// attention".
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import Invoice from "../../models/Invoice.js";
import Doctor from "../../models/Doctor.js";
import AdminActivityLog from "../../models/AdminActivityLog.js";
import { computePaymentAttention } from "../../controllers/admin/paymentAdminController.js";
import { computeRefundAttention } from "../../controllers/admin/refundAdminController.js";
import { reconciliationService } from "../../payments/reconciliationService.js";

const PAYMENT_MAX_RETRIES = 3; // mirrors paymentRetryService.js / paymentAdminController.js

const CAPTURED_LIKE = [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.PARTIALLY_REFUNDED];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// ─── 1. Finance Overview (KPI layer) ──────────────────────────────────────
// Every KPI below reads a real field. gatewayAmount/walletAmount are real,
// distinct Payment fields (the split between what was actually charged via
// Razorpay vs covered by wallet balance) — genuinely different numbers
// from totalAmount, not a relabeling of the same figure.
export async function buildFinanceOverview() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [capturedLikeAgg, statusAgg, invoiceAgg, pendingRefundAgg, todayAgg] = await Promise.all([
    Payment.aggregate([
      { $match: { status: { $in: CAPTURED_LIKE } } },
      {
        $group: {
          _id: null,
          grossRevenue: { $sum: "$totalAmount" },
          gatewayCollected: { $sum: { $ifNull: ["$gatewayAmount", 0] } },
          walletCollected: { $sum: { $ifNull: ["$walletAmount", 0] } },
          refundedAmount: { $sum: "$refundedAmount" },
          taxCollected: { $sum: { $ifNull: ["$taxAmount", 0] } },
          count: { $sum: 1 },
          withInvoice: { $sum: { $cond: [{ $ifNull: ["$invoiceId", false] }, 1, 0] } },
        },
      },
    ]),
    Payment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } }]),
    Invoice.aggregate([
      { $match: { status: "issued" } },
      { $group: { _id: null, totalAmount: { $sum: "$totalAmount" }, taxAmount: { $sum: "$taxAmount" }, count: { $sum: 1 } } },
    ]),
    RefundRequest.aggregate([
      { $match: { status: "pending" } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { paidAt: { $gte: startOfToday }, status: { $in: CAPTURED_LIKE } } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } },
    ]),
  ]);

  const byStatus = {};
  let totalPayments = 0;
  for (const row of statusAgg) {
    byStatus[row._id] = { count: row.count, totalAmount: row.totalAmount };
    totalPayments += row.count;
  }
  const failed = byStatus[PAYMENT_STATUS.FAILED] || { count: 0, totalAmount: 0 };
  const pendingCount = (byStatus[PAYMENT_STATUS.CREATED]?.count || 0) + (byStatus[PAYMENT_STATUS.PENDING]?.count || 0);
  const pendingAmount =
    (byStatus[PAYMENT_STATUS.CREATED]?.totalAmount || 0) + (byStatus[PAYMENT_STATUS.PENDING]?.totalAmount || 0);

  const captured = capturedLikeAgg[0] || {
    grossRevenue: 0,
    gatewayCollected: 0,
    walletCollected: 0,
    refundedAmount: 0,
    taxCollected: 0,
    count: 0,
    withInvoice: 0,
  };
  const invoiceTotals = invoiceAgg[0] || { totalAmount: 0, taxAmount: 0, count: 0 };
  const pendingRefunds = pendingRefundAgg[0] || { count: 0, totalAmount: 0 };
  const today = todayAgg[0] || { count: 0, totalAmount: 0 };

  return {
    grossRevenue: round2(captured.grossRevenue),
    netRevenue: round2(captured.grossRevenue - captured.refundedAmount),
    gatewayCollected: round2(captured.gatewayCollected),
    walletCollected: round2(captured.walletCollected),
    taxCollected: round2(captured.taxCollected),
    refundedAmount: round2(captured.refundedAmount),
    refundsPendingCount: pendingRefunds.count,
    refundsPendingAmount: round2(pendingRefunds.totalAmount),
    outstandingAmount: round2(pendingAmount),
    outstandingCount: pendingCount,
    failedAmount: round2(failed.totalAmount),
    failedCount: failed.count,
    invoiceValue: round2(invoiceTotals.totalAmount),
    invoiceCount: invoiceTotals.count,
    capturedPaymentsWithInvoice: captured.withInvoice,
    capturedPaymentsCount: captured.count,
    totalPayments,
    todaysCollection: round2(today.totalAmount),
    todaysCollectionCount: today.count,
  };
}

// ─── 2. Financial Health Score ────────────────────────────────────────────
// Deterministic, fully explainable — a plain mean of five 0-100 factors,
// each derived directly from buildFinanceOverview()'s real numbers (plus
// one attention count). Never an arbitrary/invented percentage. Returns
// null (not a fabricated score) when there isn't enough data yet (zero
// payments ever recorded).
export async function buildFinancialHealth(overview, attentionCount) {
  const totalCapturedOrFailed = overview.capturedPaymentsCount + overview.failedCount;
  if (overview.totalPayments === 0) {
    return { score: null, reason: "No payment activity recorded yet — health score unavailable.", factors: [] };
  }

  const paymentSuccessRate = totalCapturedOrFailed
    ? (overview.capturedPaymentsCount / totalCapturedOrFailed) * 100
    : 100;

  const grossPlusOutstanding = overview.grossRevenue + overview.outstandingAmount;
  const refundPressure = overview.grossRevenue
    ? Math.max(0, 100 - (overview.refundedAmount / overview.grossRevenue) * 100)
    : 100;
  const outstandingHealth = grossPlusOutstanding
    ? Math.max(0, 100 - (overview.outstandingAmount / grossPlusOutstanding) * 100)
    : 100;
  const invoiceCoverage = overview.capturedPaymentsCount
    ? (overview.capturedPaymentsWithInvoice / overview.capturedPaymentsCount) * 100
    : 100;
  const attentionHealth = overview.totalPayments
    ? Math.max(0, 100 - (attentionCount / overview.totalPayments) * 100)
    : 100;

  const factors = [
    { key: "paymentSuccessRate", label: "Payment success rate", value: round2(paymentSuccessRate), description: `${overview.capturedPaymentsCount} captured vs ${overview.failedCount} failed` },
    { key: "refundPressure", label: "Refund pressure (inverted)", value: round2(refundPressure), description: `₹${overview.refundedAmount} refunded against ₹${overview.grossRevenue} gross revenue` },
    { key: "outstandingHealth", label: "Outstanding receivables health", value: round2(outstandingHealth), description: `₹${overview.outstandingAmount} outstanding of ₹${round2(grossPlusOutstanding)} total exposure` },
    { key: "invoiceCoverage", label: "Invoice coverage", value: round2(invoiceCoverage), description: `${overview.capturedPaymentsWithInvoice} of ${overview.capturedPaymentsCount} captured payments have an invoice on file` },
    { key: "attentionHealth", label: "Operational attention load", value: round2(attentionHealth), description: `${attentionCount} of ${overview.totalPayments} payments currently need attention` },
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.value, 0) / factors.length);

  return {
    score,
    formula: "Simple mean of five 0-100 factors: payment success rate, refund pressure (inverted), outstanding receivables health, invoice coverage, and operational attention load. Documented, not weighted arbitrarily.",
    factors,
  };
}

// ─── 3. Revenue Intelligence (trend) ──────────────────────────────────────
const DATE_FORMAT_BY_PERIOD = {
  daily: "%Y-%m-%d",
  weekly: "%G-W%V",
  monthly: "%Y-%m",
};

export async function buildRevenueTrend({ period = "daily", from, to } = {}) {
  const format = DATE_FORMAT_BY_PERIOD[period] || DATE_FORMAT_BY_PERIOD.daily;
  const dateMatch = {};
  if (from && !Number.isNaN(Date.parse(from))) dateMatch.$gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) dateMatch.$lte = new Date(to);
  // Default window: last 30 buckets' worth of raw range so an empty
  // filter still returns something meaningful rather than the entire
  // history in one call.
  if (!dateMatch.$gte) {
    const days = period === "monthly" ? 365 : period === "weekly" ? 180 : 30;
    dateMatch.$gte = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  const [revenueRows, failedRows, refundRows] = await Promise.all([
    Payment.aggregate([
      { $match: { status: { $in: CAPTURED_LIKE }, paidAt: { $ne: null, ...dateMatch } } },
      {
        $group: {
          _id: { $dateToString: { format, date: "$paidAt" } },
          grossRevenue: { $sum: "$totalAmount" },
          netRevenue: { $sum: { $subtract: ["$totalAmount", "$refundedAmount"] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.FAILED, failedAt: { $ne: null, ...dateMatch } } },
      { $group: { _id: { $dateToString: { format, date: "$failedAt" } }, count: { $sum: 1 }, amount: { $sum: "$totalAmount" } } },
      { $sort: { _id: 1 } },
    ]),
    RefundRequest.aggregate([
      { $match: { status: "processed", updatedAt: dateMatch } },
      { $group: { _id: { $dateToString: { format, date: "$updatedAt" } }, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    period,
    revenue: revenueRows.map((r) => ({ bucket: r._id, grossRevenue: round2(r.grossRevenue), netRevenue: round2(r.netRevenue), count: r.count })),
    failures: failedRows.map((r) => ({ bucket: r._id, count: r.count, amount: round2(r.amount) })),
    refunds: refundRows.map((r) => ({ bucket: r._id, count: r.count, amount: round2(r.amount) })),
    hasData: revenueRows.length > 0 || failedRows.length > 0 || refundRows.length > 0,
  };
}

// ─── 4. Revenue Breakdown ─────────────────────────────────────────────────
// By doctor (real relationship, Payment.doctorId) and by collection method
// (gateway vs wallet — a real distinct split on Payment, not a fabricated
// "payment method" the schema doesn't have; the gateway field itself is a
// constant "razorpay" for every payment in this codebase, so a breakdown
// "by gateway" would be a single trivial bucket and is deliberately not
// presented as if it were a real dimension).
export async function buildRevenueBreakdown() {
  const [byDoctor, byStatus] = await Promise.all([
    Payment.aggregate([
      { $match: { status: { $in: CAPTURED_LIKE } } },
      { $group: { _id: "$doctorId", grossRevenue: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      { $sort: { grossRevenue: -1 } },
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
          doctorId: "$_id",
          doctorName: { $ifNull: ["$doctorUser.name", "Unknown doctor"] },
          specialization: "$doctor.specialization",
          grossRevenue: 1,
          count: 1,
          _id: 0,
        },
      },
    ]),
    Payment.aggregate([
      { $group: { _id: "$status", totalAmount: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const overview = await Payment.aggregate([
    { $match: { status: { $in: CAPTURED_LIKE } } },
    { $group: { _id: null, gatewayCollected: { $sum: { $ifNull: ["$gatewayAmount", 0] } }, walletCollected: { $sum: { $ifNull: ["$walletAmount", 0] } } } },
  ]);

  return {
    byDoctor: byDoctor.map((d) => ({ ...d, grossRevenue: round2(d.grossRevenue) })),
    byStatus: byStatus.map((s) => ({ status: s._id, totalAmount: round2(s.totalAmount), count: s.count })),
    byCollectionMethod: [
      { label: "Gateway (Razorpay)", value: round2(overview[0]?.gatewayCollected || 0) },
      { label: "Wallet", value: round2(overview[0]?.walletCollected || 0) },
    ],
  };
}

// ─── 5. Collections / Receivables ─────────────────────────────────────────
// AUDIT NOTE: Invoice has no due-date field and Payment has no invoice-due
// concept either — real invoice-aging ("8-30 days overdue") is genuinely
// not calculable from this schema and is NOT fabricated here. What IS
// real: how long a pending/created checkout or a failed payment has been
// sitting unresolved since it was created — that's a real, stored
// timestamp, and the buckets below are built from it honestly labeled as
// "time since checkout started", not invoice overdue age.
const AGING_BUCKETS = [
  { key: "0-24h", maxMs: 24 * 60 * 60 * 1000 },
  { key: "1-3d", maxMs: 3 * 24 * 60 * 60 * 1000 },
  { key: "3-7d", maxMs: 7 * 24 * 60 * 60 * 1000 },
  { key: "7d+", maxMs: Infinity },
];

// Exported for the dependency-free collectionsAging test — same function
// buildCollections() uses internally, never reimplemented in the test.
export const bucketFor = (ageMs) => AGING_BUCKETS.find((b) => ageMs <= b.maxMs)?.key || "7d+";

export async function buildCollections() {
  const outstanding = await Payment.find({ status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING] } })
    .select("totalAmount createdAt userId doctorId")
    .populate("userId", "name email")
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  const failed = await Payment.find({ status: PAYMENT_STATUS.FAILED, retryResolvedAt: null })
    .select("totalAmount createdAt retryCount nextRetryAt userId")
    .populate("userId", "name email")
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  const now = Date.now();
  const aging = { "0-24h": { count: 0, amount: 0 }, "1-3d": { count: 0, amount: 0 }, "3-7d": { count: 0, amount: 0 }, "7d+": { count: 0, amount: 0 } };
  for (const payment of outstanding) {
    const bucket = bucketFor(now - new Date(payment.createdAt).getTime());
    aging[bucket].count += 1;
    aging[bucket].amount = round2(aging[bucket].amount + payment.totalAmount);
  }

  const highValueOutstanding = [...outstanding]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10);

  const retryCandidates = failed.filter((p) => p.retryCount < PAYMENT_MAX_RETRIES && p.nextRetryAt);
  const deadLetter = failed.filter((p) => p.retryCount >= PAYMENT_MAX_RETRIES);

  return {
    outstandingCount: outstanding.length,
    outstandingAmount: round2(outstanding.reduce((sum, p) => sum + p.totalAmount, 0)),
    aging,
    highValueOutstanding,
    failedCount: failed.length,
    failedAmount: round2(failed.reduce((sum, p) => sum + p.totalAmount, 0)),
    retryCandidates: retryCandidates.slice(0, 20),
    deadLetterCount: deadLetter.length,
    agingLimitation: "Aging is measured from checkout start time (Payment.createdAt), not invoice due date — this schema has no invoice due-date field.",
  };
}

// ─── 6. Reconciliation ────────────────────────────────────────────────────
// AUDIT FINDING (Phase UI-7): a real reconciliation engine already exists
// — backend/payments/reconciliationService.js, already exposed at
// GET /api/finance/reconciliation and POST /api/finance/reconciliation/
// repair (financeController.js), and already used by the legacy
// FinanceHistory.jsx page. Its generateReport() already detects
// duplicate_order / missing_capture_reference / refund_exceeds_payment,
// and findIncompletePayments() already detects captured payments missing
// an Invoice OR a DoctorPayout. This function REUSES both rather than
// re-deriving the same checks — the two genuinely new checks below
// (status/refund mismatch, duplicate pending refund requests, invoice
// amount mismatch) are additive, not overlapping. Detection only — never
// auto-corrects a financial record here (Section 13); the existing
// repairIncompletePayments() remains the one real, narrowly-scoped repair
// action, reachable from Finance Operations via a deep link, not
// duplicated here.
export async function buildReconciliation() {
  const AMOUNT_TOLERANCE = 1; // ₹1 — floating point / rounding tolerance, not a business rule

  const [existingReport, incompletePayments, statusRefundMismatch] = await Promise.all([
    reconciliationService.generateReport(),
    reconciliationService.findIncompletePayments(),
    Payment.find({
      $or: [
        { status: PAYMENT_STATUS.REFUNDED, $expr: { $lt: ["$refundedAmount", "$totalAmount"] } },
        { status: PAYMENT_STATUS.CAPTURED, refundedAmount: { $gt: 0 } },
        { status: PAYMENT_STATUS.PARTIALLY_REFUNDED, refundedAmount: { $lte: 0 } },
      ],
    })
      .select("totalAmount refundedAmount status")
      .limit(50)
      .lean(),
  ]);

  const duplicatePendingRefundsAgg = await RefundRequest.aggregate([
    { $match: { status: { $in: ["pending", "approved"] } } },
    { $group: { _id: "$paymentId", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  // Invoice.totalAmount should match its linked Payment.totalAmount — a
  // real relationship check, not an invented rule.
  const invoicesWithPayment = await Invoice.find({ paymentId: { $ne: null } })
    .select("invoiceNumber totalAmount paymentId")
    .populate("paymentId", "totalAmount")
    .limit(500)
    .lean();
  const invoiceAmountMismatch = invoicesWithPayment.filter(
    (inv) => inv.paymentId && Math.abs((inv.totalAmount || 0) - (inv.paymentId.totalAmount || 0)) > AMOUNT_TOLERANCE,
  );

  const byType = (type) => existingReport.issues.filter((i) => i.type === type);

  const issues = [
    {
      type: "duplicate_order",
      severity: "critical",
      count: byType("duplicate_order").length,
      title: "Duplicate Razorpay order references",
      description: "More than one Payment record shares the same razorpayOrderId — detected by the existing reconciliation engine.",
      records: byType("duplicate_order"),
    },
    {
      type: "missing_capture_reference",
      severity: "warning",
      count: byType("missing_capture_reference").length,
      title: "Captured payment missing a gateway payment reference",
      description: "Payment.status is 'captured' but the gateway paymentId was never recorded.",
      records: byType("missing_capture_reference"),
    },
    {
      type: "refund_exceeds_captured",
      severity: "critical",
      count: byType("refund_exceeds_payment").length,
      title: "Refunded amount exceeds captured amount",
      description: "Payment.refundedAmount is greater than Payment.totalAmount — a data integrity issue.",
      records: byType("refund_exceeds_payment"),
    },
    {
      type: "captured_incomplete",
      severity: "warning",
      count: incompletePayments.length,
      title: "Captured payments missing invoice or payout",
      description: "These payments were captured but never finished generating an Invoice and/or DoctorPayout record. A real repair action already exists (Reconciliation Repair) to safely re-run this.",
      records: incompletePayments,
    },
    {
      type: "status_refund_mismatch",
      severity: "warning",
      count: statusRefundMismatch.length,
      title: "Payment status disagrees with refunded amount",
      description: "The payment's status (captured/refunded/partially_refunded) does not match its refundedAmount.",
      records: statusRefundMismatch,
    },
    {
      type: "duplicate_pending_refund_requests",
      severity: "critical",
      count: duplicatePendingRefundsAgg.length,
      title: "Duplicate pending/approved refund requests",
      description: "More than one pending or approved refund request exists for the same payment.",
      records: duplicatePendingRefundsAgg,
    },
    {
      type: "invoice_amount_mismatch",
      severity: "warning",
      count: invoiceAmountMismatch.length,
      title: "Invoice amount does not match linked payment",
      description: "Invoice.totalAmount differs from its linked Payment.totalAmount by more than ₹1.",
      records: invoiceAmountMismatch,
    },
  ];

  return {
    issues,
    totalIssues: issues.reduce((sum, i) => sum + i.count, 0),
    checkedPayments: existingReport.checked,
    generatedAt: existingReport.generatedAt,
    resolutionNote: "Detection only — no financial record is modified automatically here. 'Captured payments missing invoice or payout' can be safely repaired via the existing Reconciliation Repair action; every other item requires manual resolution in the relevant Payment/Refund/Invoice workspace.",
  };
}

// ─── 7. Financial Operations Queue (attention) ────────────────────────────
// Reuses the exact same rules the Payments and Refunds workspaces use
// (imported, not reimplemented), plus reconciliation issues surfaced as
// attention items. This is the ONE place Finance decides "needs
// attention" — never a separately-invented list.
export async function buildFinanceAttentionQueue() {
  const pendingRefundPaymentIds = await RefundRequest.find({ status: "pending" }).distinct("paymentId");
  const pendingRefundSet = new Set(pendingRefundPaymentIds.map((id) => id.toString()));

  const [attentionPayments, pendingRefundRequests, reconciliation] = await Promise.all([
    Payment.find({
      $or: [
        { status: PAYMENT_STATUS.FAILED, retryResolvedAt: null },
        { _id: { $in: pendingRefundPaymentIds } },
        { status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING] }, createdAt: { $lte: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
      ],
    })
      .select("status retryResolvedAt retryCount createdAt totalAmount userId")
      .populate("userId", "name email")
      .limit(100)
      .lean(),
    RefundRequest.find({ status: { $in: ["pending", "failed"] } })
      .select("status failureReason createdAt timeline amount paymentId")
      .limit(100)
      .lean(),
    buildReconciliation(),
  ]);

  const paymentItems = attentionPayments.map((payment) => {
    const { needsAttention, attentionReasons } = computePaymentAttention(payment, pendingRefundSet.has(payment._id.toString()));
    return {
      type: "payment",
      severity: attentionReasons.some((r) => r.includes("dead-letter")) ? "critical" : "warning",
      title: "Payment needs attention",
      what: attentionReasons.join("; "),
      why: needsAttention ? "This payment does not match the platform's healthy-payment state." : "",
      amount: payment.totalAmount,
      recordId: payment._id,
      link: `/admin/payments?search=${payment._id}`,
    };
  });

  const refundItems = pendingRefundRequests.map((refund) => {
    const { needsAttention, attentionReasons } = computeRefundAttention(refund);
    return needsAttention
      ? {
          type: "refund",
          severity: refund.status === "failed" ? "critical" : "warning",
          title: "Refund needs attention",
          what: attentionReasons.join("; "),
          why: "This refund request is not progressing through its normal lifecycle.",
          amount: refund.amount,
          recordId: refund._id,
          link: `/admin/refunds?search=${refund._id}`,
        }
      : null;
  }).filter(Boolean);

  const reconciliationItems = reconciliation.issues
    .filter((issue) => issue.count > 0)
    .map((issue) => ({
      type: "reconciliation",
      severity: issue.severity,
      title: issue.title,
      what: issue.description,
      why: "Financial integrity issue detected by reconciliation.",
      count: issue.count,
      link: "/admin/finance/ops",
    }));

  return {
    items: [...paymentItems, ...refundItems, ...reconciliationItems],
    counts: {
      payments: paymentItems.length,
      refunds: refundItems.length,
      reconciliation: reconciliationItems.length,
    },
  };
}

// ─── 8. Finance Activity Timeline ─────────────────────────────────────────
// Real timestamps only. AdminActivityLog carries genuine admin financial
// actions (refund approve/reject/retry, payout settlement); recent invoice
// issuance is pulled directly from Invoice.issuedAt since invoices are not
// separately audit-logged as an admin action (they're generated by the
// system at capture time, not by an admin decision).
export async function buildFinanceActivityTimeline({ limit = 40 } = {}) {
  const [activityLogs, recentInvoices] = await Promise.all([
    AdminActivityLog.find({ resourceType: { $in: ["Payment", "RefundRequest", "DoctorPayout", "Coupon", "Subscription"] } })
      .populate("actorId", "name email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Invoice.find({}).select("invoiceNumber totalAmount issuedAt billingType").sort({ issuedAt: -1 }).limit(20).lean(),
  ]);

  const events = [
    ...activityLogs.map((log) => ({
      key: `log-${log._id}`,
      label: `${log.action}${log.resourceType ? ` (${log.resourceType})` : ""}`,
      actor: log.actorId?.name || "System",
      severity: log.severity,
      at: log.createdAt,
    })),
    ...recentInvoices.map((invoice) => ({
      key: `invoice-${invoice._id}`,
      label: `Invoice ${invoice.invoiceNumber} issued (₹${invoice.totalAmount})`,
      actor: "System",
      severity: "info",
      at: invoice.issuedAt,
    })),
  ];

  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events.slice(0, limit);
}

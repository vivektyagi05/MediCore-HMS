// PHASE DOC-09 — Doctor Earnings / Financial Control Center.
//
// AUDIT FINDING (this phase): buildDoctorRevenueIntelligence() previously
// loaded EVERY DoctorPayout a doctor has ever had (`DoctorPayout.find({
// doctorId })`, no limit) plus every Payment and up to 200 Invoices, then
// summed everything in JavaScript. For a doctor with years of history this
// is a real, unbounded-growth query — exactly the "payout scale bug" this
// phase was scoped to fix, and it fed BOTH this page and the frontend's own
// unbounded client-side payout list/search/filter. Rewritten below to use
// MongoDB aggregation (bounded, indexed, doctorId+status / doctorId+createdAt
// already have compound indexes on DoctorPayout) instead of loading full
// documents into memory. The payout LIST itself (search/filter/pagination)
// is now served by the new getDoctorPayouts endpoint below, not by this
// function — grep-verified that no consumer (Business Overview, the admin
// doctor-detail financial tab, or the AI Revenue Insights prompt) ever read
// the old `.payouts` / `.settlementHistory` / `.invoices` array fields, so
// dropping them here is a pure scale win with zero contract breakage. Every
// other field this function has always returned (totalEarnings,
// settledEarnings, pendingEarnings, monthlyEarnings, upcomingPayout,
// incomeForecast, monthlyTrend, platformFees, totalTax, totalRefunded,
// totalPayouts, withdrawableBalance, today/weekly/quarterly/yearlyEarnings)
// is UNCHANGED in name and meaning, since Business Overview
// (businessOverviewController.js), the admin doctor financial tab
// (doctorAdminController.getDoctorEarningsAdmin), and the AI Revenue
// Insights template (templateProvider.js renderRevenueInsights) all read
// this exact shape and must keep working.
import mongoose from "mongoose";
import Doctor from "../../models/Doctor.js";
import DoctorPayout from "../../models/DoctorPayout.js";
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { computePaymentAttention } from "../admin/paymentAdminController.js";
import { computeRefundAttention } from "../admin/refundAdminController.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";
import { resolvePageFromIndex, computeIncomeForecast } from "../../services/finance/doctorFinanceHelpers.js";
import { computeDoctorWithdrawableBalance } from "../../services/finance/withdrawalService.js";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Payment truth: a "collected" amount can only ever mean money the gateway
// actually captured. captured/refunded/partially_refunded all started as a
// real capture (a later refund doesn't retroactively mean the money was
// never collected) — mirrors financeAggregates.js's own CAPTURED_LIKE, kept
// as a separate constant here since that file is admin-global and this one
// must stay doctor-scoped.
const CAPTURED_LIKE = [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.PARTIALLY_REFUNDED];

async function resolveDoctorId(req) {
  const doctor = await Doctor.findOne({ userId: req.user._id }).select("_id").lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  return doctor._id;
}

// SHARED Revenue Intelligence builder — reused by getDoctorEarnings, the
// Business Overview aggregate, the admin doctor-detail financial tab, and
// the AI Revenue Insights prompt, so every one of those reads identical
// real numbers off the same bounded aggregation instead of divergent
// per-caller math.
export async function buildDoctorRevenueIntelligence(doctorId) {
  const docId = new mongoose.Types.ObjectId(doctorId);
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const sumStage = (extraMatch, sumField = "$doctorAmount") => [
    ...(extraMatch ? [{ $match: extraMatch }] : []),
    { $group: { _id: null, sum: { $sum: sumField } } },
  ];

  const [payoutFacet, paymentTotalsAgg, monthlyRows, totalPayouts, settlementTimeline] = await Promise.all([
    DoctorPayout.aggregate([
      { $match: { doctorId: docId } },
      {
        $facet: {
          total: [{ $group: { _id: null, sum: { $sum: "$doctorAmount" }, fees: { $sum: "$platformFee" } } }],
          settled: sumStage({ status: "paid" }),
          pending: sumStage({ status: "pending" }),
          today: sumStage({ createdAt: { $gte: startOfToday } }),
          week: sumStage({ createdAt: { $gte: startOfWeek } }),
          month: sumStage({ createdAt: { $gte: startOfMonth } }),
          quarter: sumStage({ createdAt: { $gte: startOfQuarter } }),
          year: sumStage({ createdAt: { $gte: startOfYear } }),
        },
      },
    ]),
    Payment.aggregate([
      { $match: { doctorId: docId } },
      {
        $group: {
          _id: null,
          collected: { $sum: { $cond: [{ $in: ["$status", CAPTURED_LIKE] }, "$totalAmount", 0] } },
          tax: { $sum: { $ifNull: ["$taxAmount", 0] } },
          refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } },
        },
      },
    ]),
    DoctorPayout.aggregate([
      { $match: { doctorId: docId, status: "paid", createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, amount: { $sum: "$doctorAmount" } } },
    ]),
    DoctorPayout.countDocuments({ doctorId: docId }),
    // Bounded to the latest 30 — a real timeline feed, not the full
    // unbounded history the payout list used to load.
    DoctorPayout.find({ doctorId: docId })
      .select("status doctorAmount paidAt createdAt appointmentId")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
  ]);

  const facet = payoutFacet[0] || {};
  const pick = (key) => facet[key]?.[0]?.sum || 0;
  const totalEarnings = facet.total?.[0]?.sum || 0;
  const platformFees = facet.total?.[0]?.fees || 0;
  const settledEarnings = pick("settled");
  const pendingEarnings = pick("pending");

  const paymentTotals = paymentTotalsAgg[0] || { collected: 0, tax: 0, refunded: 0 };

  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthlyMap = Object.fromEntries(monthlyRows.map((r) => [r._id, r.amount]));
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyTrend.push({
      label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      amount: round2(monthlyMap[monthKey(d)] || 0),
    });
  }

  // Income forecast: honest projection, never a fabricated number — see
  // computeIncomeForecast's own doc comment. Returns null (not 0, not a
  // single month's actual passed off as a forecast) when there isn't
  // enough settled history yet.
  const forecast = computeIncomeForecast(monthlyTrend);

  // AUDIT FIX (P23, Section 18/19): withdrawableBalance previously equaled
  // pendingEarnings (unsettled payouts) — money the doctor cannot possibly
  // withdraw yet. Replaced with the one canonical calculation the new
  // withdrawal request/admin endpoints also use, so this figure and the
  // server-side cap on an actual withdrawal request can never disagree.
  const withdrawableBalanceDetail = await computeDoctorWithdrawableBalance(docId);

  return {
    totalEarnings: round2(totalEarnings),
    settledEarnings: round2(settledEarnings),
    pendingEarnings: round2(pendingEarnings),
    withdrawableBalance: withdrawableBalanceDetail.withdrawableBalance,
    refundLiability: withdrawableBalanceDetail.refundLiability,
    pendingWithdrawal: withdrawableBalanceDetail.pendingWithdrawal,
    alreadyWithdrawn: withdrawableBalanceDetail.alreadyWithdrawn,
    todayEarnings: round2(pick("today")),
    weeklyEarnings: round2(pick("week")),
    monthlyEarnings: round2(pick("month")),
    quarterlyEarnings: round2(pick("quarter")),
    yearlyEarnings: round2(pick("year")),
    platformFees: round2(platformFees),
    totalTax: round2(paymentTotals.tax),
    totalRefunded: round2(paymentTotals.refunded),
    collectedAmount: round2(paymentTotals.collected),
    upcomingPayout: round2(pendingEarnings),
    incomeForecast: forecast.value,
    incomeForecastBasisMonths: forecast.basisMonths,
    monthlyTrend,
    settlementTimeline: settlementTimeline.map((p) => ({
      id: p._id,
      status: p.status,
      amount: p.doctorAmount,
      date: p.paidAt || p.createdAt,
      appointmentId: p.appointmentId,
    })),
    totalPayouts,
  };
}

export const getDoctorEarnings = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).lean();

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  const intelligence = await buildDoctorRevenueIntelligence(doctor._id);

  res.status(200).json({
    success: true,
    data: intelligence,
    message: "Doctor earnings fetched successfully",
  });
});

// ─── Payout history: real server-side pagination/search/filter ───────────
// AUDIT FINDING (this phase, the reported bug): DoctorEarnings.jsx fetched
// the ENTIRE `payouts` array from buildDoctorRevenueIntelligence (itself
// unbounded) and did search/status filtering in a React useMemo — meaning
// a doctor's browser downloaded and filtered their full payout history on
// every page load. This endpoint replaces that: a real doctorId-scoped,
// paginated, server-filtered query, with a deterministic sort and the
// exact pagination metadata shape every other list endpoint in this
// codebase already returns (see paginationValidation.js).
//
// Deep-link contract preserved: Smart Inbox's existing
// "/doctor/earnings?payoutId=..." notification action (doctorInboxAggregates.js)
// must still land on the payout it points to, even though the list is now
// paginated. When `payoutId` is supplied, filters/search are ignored (same
// behavior the old frontend had — it cleared search/status once a
// highlighted payout was found) and the page containing that payout is
// resolved via a single bounded countDocuments() call, never a full scan.
export const getDoctorPayouts = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const { payoutId, status, search } = req.query;

  if (payoutId && mongoose.Types.ObjectId.isValid(payoutId)) {
    const target = await DoctorPayout.findOne({ _id: payoutId, doctorId }).select("createdAt").lean();
    if (target) {
      const { pageSize } = clampPagination(req.query.page, req.query.pageSize);
      const indexBefore = await DoctorPayout.countDocuments({
        doctorId,
        $or: [
          { createdAt: { $gt: target.createdAt } },
          { createdAt: target.createdAt, _id: { $gt: target._id } },
        ],
      });
      const resolvedPage = resolvePageFromIndex(indexBefore, pageSize);
      return respondWithPayoutPage(res, doctorId, {}, resolvedPage, pageSize, payoutId);
    }
    // Payout doesn't belong to this doctor (or no longer exists) — fall
    // through to a normal, unfiltered first page rather than erroring the
    // whole page out from under the doctor.
  }

  const filter = {};
  if (status && ["pending", "paid", "cancelled"].includes(status)) filter.status = status;
  if (search && search.trim()) {
    const pattern = escapeRegex(search.trim());
    filter.$or = [
      { $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: pattern, options: "i" } } },
      { $expr: { $regexMatch: { input: { $toString: "$appointmentId" }, regex: pattern, options: "i" } } },
    ];
  }
  const { page, pageSize } = clampPagination(req.query.page, req.query.pageSize);
  return respondWithPayoutPage(res, doctorId, filter, page, pageSize);
});

async function respondWithPayoutPage(res, doctorId, extraFilter, page, pageSize, highlightPayoutId) {
  const filter = { doctorId, ...extraFilter };
  const skip = (page - 1) * pageSize;

  const [payouts, total] = await Promise.all([
    DoctorPayout.find(filter)
      .populate("appointmentId", "date timeSlot status")
      .populate("paymentId", "totalAmount currency paidAt taxAmount refundStatus refundedAmount")
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    DoctorPayout.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      payouts,
      pagination: buildPaginationMeta(page, pageSize, total),
      ...(highlightPayoutId ? { highlightPayoutId } : {}),
    },
    message: "Payouts fetched successfully",
  });
}

// ─── Financial Attention: WHAT / WHY / ACTION, doctor-scoped ─────────────
// Reuses the exact same rules the admin Payments/Refunds workspaces use
// (computePaymentAttention / computeRefundAttention, imported not
// reimplemented) plus a doctor-scoped, bounded payout/invoice-linkage
// check. This is not a second attention engine — it is the same rules,
// scoped to one doctor's own records only, so a doctor can never see
// another doctor's or another patient's financial exceptions.
//
// Actions only ever deep-link to a page the doctor actually has access to
// (their own Appointments page's real ?highlight= consumer, or the
// Payouts section of this same Earnings page) — never to an admin-only
// route the doctor has no permission to open. Where the underlying issue
// requires an admin action the doctor cannot themselves take, the item is
// still surfaced (so the doctor understands why a number looks the way it
// does) but its `action` is informational, not a dead link.
export async function buildDoctorFinancialAttention(doctorId) {
  const doctorPaymentIds = await Payment.find({ doctorId }).distinct("_id");

  const [attentionPayments, pendingRefundPaymentIds, capturedPaymentIds, payoutCoveredIds] = await Promise.all([
    Payment.find({
      doctorId,
      $or: [
        { status: PAYMENT_STATUS.FAILED, retryResolvedAt: null },
        { status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING] }, createdAt: { $lte: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
      ],
    })
      .select("status retryResolvedAt retryCount createdAt totalAmount appointmentId")
      .limit(50)
      .lean(),
    RefundRequest.find({ paymentId: { $in: doctorPaymentIds }, status: "pending" }).distinct("paymentId"),
    Payment.find({ doctorId, status: PAYMENT_STATUS.CAPTURED }).select("_id appointmentId").limit(200).lean(),
    DoctorPayout.find({ doctorId }).distinct("paymentId"),
  ]);

  const pendingRefundSet = new Set(pendingRefundPaymentIds.map((id) => id.toString()));
  const payoutCoveredSet = new Set(payoutCoveredIds.map((id) => id.toString()));

  const refundRequests = pendingRefundPaymentIds.length
    ? await RefundRequest.find({ paymentId: { $in: pendingRefundPaymentIds } })
        .select("status failureReason createdAt timeline amount paymentId")
        .limit(50)
        .lean()
    : [];

  const paymentItems = attentionPayments.map((payment) => {
    const { needsAttention, attentionReasons } = computePaymentAttention(
      payment,
      pendingRefundSet.has(payment._id.toString()),
    );
    if (!needsAttention) return null;
    return {
      type: "payment",
      severity: attentionReasons.some((r) => r.includes("dead-letter")) ? "critical" : "warning",
      what: attentionReasons.join("; "),
      why: "A patient's payment for one of your appointments has not reached a healthy state.",
      action: payment.appointmentId
        ? { label: "View appointment", to: `/doctor/appointments?highlight=${payment.appointmentId}` }
        : null,
      amount: payment.totalAmount,
      recordId: payment._id,
    };
  }).filter(Boolean);

  const refundItems = refundRequests.map((refund) => {
    const { needsAttention, attentionReasons } = computeRefundAttention(refund);
    if (!needsAttention) return null;
    return {
      type: "refund",
      severity: refund.status === "failed" ? "critical" : "warning",
      what: attentionReasons.join("; "),
      why: "A refund tied to one of your payments is not progressing through its normal lifecycle.",
      action: { label: "This is handled by billing support — no action needed from you", to: null },
      amount: refund.amount,
      recordId: refund._id,
    };
  }).filter(Boolean);

  // Doctor-scoped "captured payment missing its payout" check — the same
  // real question reconciliationService.findIncompletePayments() answers
  // globally for admin, but bounded to this doctor's own captured payments
  // (already at most a few hundred, not the platform's entire history) and
  // done as one $in/distinct comparison instead of an N+1 loop.
  const missingPayout = capturedPaymentIds.filter((p) => !payoutCoveredSet.has(p._id.toString()));
  const mismatchItems = missingPayout.map((p) => ({
    type: "reconciliation",
    severity: "warning",
    what: "A captured payment for one of your appointments hasn't generated a payout record yet.",
    why: "Payout attribution normally completes automatically shortly after capture — this can lag briefly, or point to a genuine processing gap.",
    action: p.appointmentId
      ? { label: "View appointment", to: `/doctor/appointments?highlight=${p.appointmentId}` }
      : null,
    recordId: p._id,
  }));

  return { items: [...paymentItems, ...refundItems, ...mismatchItems], mismatchCount: mismatchItems.length };
}

export const getDoctorFinancialAttention = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const attention = await buildDoctorFinancialAttention(doctorId);
  res.status(200).json({ success: true, data: attention, message: "Financial attention fetched successfully" });
});

// ─── Reconciliation status: a doctor-scoped health readout ───────────────
// Deliberately not a second reconciliation engine — it reuses the exact
// same mismatch detection buildDoctorFinancialAttention() already computes
// and simply presents it as a Healthy / Needs Review readout, the way
// Finance Operations's admin reconciliation view does for the whole
// platform. Detection only; no financial record is ever modified here.
export const getDoctorReconciliation = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const attention = await buildDoctorFinancialAttention(doctorId);
  const mismatchItems = attention.items.filter((i) => i.type === "reconciliation");
  res.status(200).json({
    success: true,
    data: {
      healthy: mismatchItems.length === 0,
      issueCount: mismatchItems.length,
      issues: mismatchItems,
    },
    message: "Reconciliation status fetched successfully",
  });
});

// ─── Custom-range financial position, with equivalent-period comparison ──
// AUDIT FINDING (this phase): the existing today/week/month/quarter/year
// quick-selects were already real, server-computed sums (buildDoctorRevenue
// Intelligence above) — genuinely fine, not rebuilt. What was missing was
// any custom date-range option, and any period-over-period comparison at
// all. This is additive: a new, narrowly-scoped aggregation (bounded by the
// caller's own from/to range) that answers "what changed vs the same-length
// period before it" — e.g. Aug 1-29 vs Jul 1-29, equal-length, never a
// partial-vs-full-month mismatch.
export const getDoctorFinancialPosition = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const { from, to } = req.query;

  const toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date();
  const fromDate = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(toDate.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (fromDate > toDate) throw new AppError("`from` must be before `to`", 400);

  const rangeMs = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - rangeMs);

  const computeForRange = async (rangeFrom, rangeTo) => {
    const docId = new mongoose.Types.ObjectId(doctorId);
    const [payoutAgg, paymentAgg] = await Promise.all([
      DoctorPayout.aggregate([
        { $match: { doctorId: docId, createdAt: { $gte: rangeFrom, $lte: rangeTo } } },
        {
          $group: {
            _id: null,
            earned: { $sum: "$doctorAmount" },
            settled: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$doctorAmount", 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$doctorAmount", 0] } },
          },
        },
      ]),
      Payment.aggregate([
        { $match: { doctorId: docId, createdAt: { $gte: rangeFrom, $lte: rangeTo } } },
        {
          $group: {
            _id: null,
            collected: { $sum: { $cond: [{ $in: ["$status", CAPTURED_LIKE] }, "$totalAmount", 0] } },
            refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } },
          },
        },
      ]),
    ]);
    const p = payoutAgg[0] || { earned: 0, settled: 0, pending: 0 };
    const pay = paymentAgg[0] || { collected: 0, refunded: 0 };
    return {
      earned: round2(p.earned),
      settled: round2(p.settled),
      pending: round2(p.pending),
      collected: round2(pay.collected),
      refunded: round2(pay.refunded),
    };
  };

  const [current, previous] = await Promise.all([
    computeForRange(fromDate, toDate),
    computeForRange(prevFrom, prevTo),
  ]);

  const pctChange = (curr, prev) => (prev ? round2(((curr - prev) / prev) * 100) : curr ? 100 : 0);

  res.status(200).json({
    success: true,
    data: {
      range: { from: fromDate, to: toDate },
      comparisonRange: { from: prevFrom, to: prevTo },
      current,
      previous,
      change: {
        earned: pctChange(current.earned, previous.earned),
        collected: pctChange(current.collected, previous.collected),
        settled: pctChange(current.settled, previous.settled),
      },
    },
    message: "Financial position fetched successfully",
  });
});

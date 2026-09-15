// PHASE UI-7 — Finance Executive Command Center (admin side).
//
// Additive read-only surface over the existing Payment/RefundRequest/
// Invoice domain, composed through backend/services/finance/
// financeAggregates.js (the single source of truth for every number this
// controller returns). Deliberately does NOT duplicate anything that
// already exists:
//  - payment/refund mutation stays on their existing routes
//    (paymentController.js / refundController.js) — untouched.
//  - the Payments and Refunds registries/detail workspaces stay on
//    /api/admin/payments and /api/admin/refunds — this controller only
//    links out to them.
//  - invoice read/download stays on the existing /api/invoices routes
//    (invoiceController.js) — this controller only surfaces aggregate
//    invoice totals, never a duplicate invoice list.
//
// Gated entirely behind manage_payments, same permission key every other
// financial admin surface in this codebase already uses.
import {
  buildFinanceOverview,
  buildFinancialHealth,
  buildRevenueTrend,
  buildRevenueBreakdown,
  buildCollections,
  buildReconciliation,
  buildFinanceAttentionQueue,
  buildFinanceActivityTimeline,
} from "../../services/finance/financeAggregates.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";

export const getFinanceOverview = asyncHandler(async (_req, res) => {
  const overview = await buildFinanceOverview();
  res.status(200).json({ success: true, data: overview, message: "Finance overview fetched successfully" });
});

export const getFinanceHealth = asyncHandler(async (_req, res) => {
  const [overview, attention] = await Promise.all([buildFinanceOverview(), buildFinanceAttentionQueue()]);
  const health = await buildFinancialHealth(overview, attention.items.length);
  res.status(200).json({ success: true, data: health, message: "Financial health fetched successfully" });
});

export const getRevenueTrend = asyncHandler(async (req, res) => {
  const { period, from, to } = req.query;
  const trend = await buildRevenueTrend({ period, from, to });
  res.status(200).json({ success: true, data: trend, message: "Revenue trend fetched successfully" });
});

export const getRevenueBreakdown = asyncHandler(async (_req, res) => {
  const breakdown = await buildRevenueBreakdown();
  res.status(200).json({ success: true, data: breakdown, message: "Revenue breakdown fetched successfully" });
});

export const getCollections = asyncHandler(async (_req, res) => {
  const collections = await buildCollections();
  res.status(200).json({ success: true, data: collections, message: "Collections fetched successfully" });
});

export const getReconciliation = asyncHandler(async (_req, res) => {
  const reconciliation = await buildReconciliation();
  res.status(200).json({ success: true, data: reconciliation, message: "Reconciliation report fetched successfully" });
});

export const getFinanceAttentionQueue = asyncHandler(async (_req, res) => {
  const attention = await buildFinanceAttentionQueue();
  res.status(200).json({ success: true, data: attention, message: "Finance attention queue fetched successfully" });
});

export const getFinanceActivityTimeline = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const timeline = await buildFinanceActivityTimeline({ limit });
  res.status(200).json({ success: true, data: { timeline }, message: "Finance activity timeline fetched successfully" });
});

// AI Executive Summary — advisory only, grounded strictly in the real,
// already-computed aggregates above. Section 17: AI never invents revenue,
// payment reasons, fraud, patient details, financial events, or
// percentages; it only explains numbers this controller already computed
// server-side and passes in as context.
export const getFinanceExecutiveSummary = asyncHandler(async (_req, res) => {
  const [overview, attention] = await Promise.all([buildFinanceOverview(), buildFinanceAttentionQueue()]);
  const health = await buildFinancialHealth(overview, attention.items.length);

  const result = await generativeAssistant.financeExecutiveSummary({
    overview,
    health,
    attentionCounts: attention.counts,
    totalAttentionItems: attention.items.length,
  });

  res.status(200).json({ success: true, data: result, message: "Finance executive summary generated successfully" });
});

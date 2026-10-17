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
import { AppError } from "../../middleware/errorMiddleware.js";
import mongoose from "mongoose";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { buildWalletLedgerDiscrepancyReport } from "../../services/finance/walletReconciliationService.js";
import { getOutboxHealth, requeueFailedEmail } from "../../services/emailOutboxService.js";

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

// F-012: read-only reconciliation entry points. They record discrepancies; they never change a balance.
export const reconcileWalletBalances = asyncHandler(async (req, res) => {
  const { reconcileAllWallets, reconcileWallet } = await import("../../services/finance/walletReconciliationService.js");
  const mongooseLib = (await import("mongoose")).default;
  if (req.params.userId) {
    if (!mongooseLib.Types.ObjectId.isValid(req.params.userId)) throw new AppError("Invalid user id", 400);
    const result = await reconcileWallet(req.params.userId);
    return res.status(200).json({ success: true, data: { result }, message: result.ok ? "Wallet matches ledger" : "Wallet differs from ledger" });
  }
  const afterId = req.query.afterId && mongooseLib.Types.ObjectId.isValid(req.query.afterId) ? req.query.afterId : null;
  const report = await reconcileAllWallets({ afterId, maxBatches: 10 });
  res.status(200).json({ success: true, data: { report }, message: report.done ? "All wallets reconciled" : "Partial pass; continue with nextCursor" });
});

// Phase 03: read-only wallet/ledger discrepancy report. Sensitive-report access is audited.
export const getWalletLedgerDiscrepancies = asyncHandler(async (req, res) => {
  const { category, page, limit, from, to } = req.query;
  let report;
  try {
    report = await buildWalletLedgerDiscrepancyReport({ category, page, limit, from, to });
  } catch (error) {
    if (error.statusCode === 400) throw new AppError(error.message, 400);
    throw error;
  }
  await writeAdminLog({ req, action: "finance.discrepancy_report_viewed", resourceType: "Reconciliation", resourceId: category || "all", metadata: { category: category || "all", page: report.page, from: from || null, to: to || null } });
  res.status(200).json({ success: true, data: report, message: "Discrepancy report fetched successfully" });
});

// Phase 03: durable financial-event (email outbox) health + exhausted-event recovery.
export const getFinancialOutbox = asyncHandler(async (req, res) => {
  const data = await getOutboxHealth({ page: req.query.page, limit: req.query.limit, entityType: typeof req.query.entityType === "string" ? req.query.entityType : undefined });
  res.status(200).json({ success: true, data, message: "Outbox health fetched successfully" });
});

export const requeueOutboxEvent = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid event id", 400);
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5 || reason.length > 300) throw new AppError("A reason of 5-300 characters is required", 400);
  const result = await requeueFailedEmail({ id: req.params.id });
  if (!result.requeued) throw new AppError("Only exhausted (failed) events can be re-queued; this event is not in that state", 409);
  await writeAdminLog({ req, action: "finance.outbox_requeued", resourceType: "EmailDelivery", resourceId: String(req.params.id), severity: "warning", metadata: { reason, eventKey: result.row.eventKey, entityType: result.row.entityType } });
  res.status(200).json({ success: true, data: { event: result.row }, message: "Event re-queued for delivery" });
});

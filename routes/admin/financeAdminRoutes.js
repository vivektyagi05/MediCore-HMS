import { Router } from "express";
import {
  getFinanceOverview,
  getFinanceHealth,
  getRevenueTrend,
  getRevenueBreakdown,
  getCollections,
  getReconciliation,
  getFinanceAttentionQueue,
  getFinanceActivityTimeline,
  getFinanceExecutiveSummary,
} from "../../controllers/admin/financeAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// The whole Finance Command Center is financial data — gated behind
// manage_payments in full, same permission key already used by the
// Payments and Refunds workspaces. No new permission key introduced.
const gate = requirePermission("manage_payments");

router.get("/overview", gate, getFinanceOverview);
router.get("/health", gate, getFinanceHealth);
router.get("/revenue-trend", gate, getRevenueTrend);
router.get("/revenue-breakdown", gate, getRevenueBreakdown);
router.get("/collections", gate, getCollections);
router.get("/reconciliation", gate, getReconciliation);
router.get("/attention-queue", gate, getFinanceAttentionQueue);
router.get("/activity-timeline", gate, getFinanceActivityTimeline);
router.get("/ai/executive-summary", gate, getFinanceExecutiveSummary);

export default router;

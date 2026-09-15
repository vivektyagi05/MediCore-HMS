import { Router } from "express";
import {
  getOverview,
  getOverviewAiSummary,
  listExecutions,
  getExecutionDetail,
  explainExecution,
  getFlowHealth,
  getCronHealth,
  getPerformance,
  getPerformanceAiAdvisor,
  getFailures,
  getFailuresAiExplain,
  getDependencyFanout,
  getRetryQueue,
  getRetryQueueAiAdvisor,
  resolveDeadLetterPayment,
} from "../../controllers/admin/monitoringController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key already used by every other
// Operations/Workflow/Assignment/Automation-Studio surface — no new
// roles/permissions introduced for the Monitoring Platform.
const gate = requirePermission("manage_settings");

router.get("/overview", gate, getOverview);
router.get("/overview/ai-summary", gate, getOverviewAiSummary);

router.get("/executions", gate, listExecutions);
router.get("/executions/:id", gate, getExecutionDetail);
router.get("/executions/:id/ai-explain", gate, explainExecution);

router.get("/flow-health", gate, getFlowHealth);
router.get("/cron-health", gate, getCronHealth);

router.get("/performance", gate, getPerformance);
router.get("/performance/ai-advisor", gate, getPerformanceAiAdvisor);

router.get("/failures", gate, getFailures);
router.get("/failures/ai-explain", gate, getFailuresAiExplain);

router.get("/dependency-fanout", gate, getDependencyFanout);

router.get("/retry-queue", gate, getRetryQueue);
router.get("/retry-queue/ai-advisor", gate, getRetryQueueAiAdvisor);
router.post("/retry-queue/:paymentId/resolve", gate, resolveDeadLetterPayment);

export default router;

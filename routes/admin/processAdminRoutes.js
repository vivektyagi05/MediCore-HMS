import { Router } from "express";
import {
  getCommandCenter,
  getRegistry,
  getProcessDetail,
  getProcessAiExplain,
  getOrchestrationPlanForProcess,
  getOrchestrationRules,
  getOrchestrationAiAdvisor,
  getDependencyGraph,
  getExecutionGraphForProcess,
  getApprovalGraph,
  getAutomationGraph,
  getFailureGraph,
  getAllGraphs,
  getImpactAnalysis,
  getImpactAiExplain,
  getEventRegistry,
  getTrace,
  getFailedEvents,
} from "../../controllers/admin/processAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key already used by every other
// Operations/Workflow/Assignment/Automation-Studio/Monitoring/Intelligence
// surface — no new roles/permissions introduced here either.
const gate = requirePermission("manage_settings");

// PHASE UI-13: composed cross-domain workspace payload. Registered above
// /registry so it is never shadowed and never shadows the :processId route.
router.get("/command-center", gate, getCommandCenter);

router.get("/registry", gate, getRegistry);
router.get("/registry/:processId", gate, getProcessDetail);
router.get("/registry/:processId/ai-explain", gate, getProcessAiExplain);

router.get("/orchestration/rules", gate, getOrchestrationRules);
router.get("/orchestration/ai-advisor", gate, getOrchestrationAiAdvisor);
router.get("/orchestration/:processId/plan", gate, getOrchestrationPlanForProcess);

router.get("/graphs/dependency", gate, getDependencyGraph);
router.get("/graphs/approval", gate, getApprovalGraph);
router.get("/graphs/automation", gate, getAutomationGraph);
router.get("/graphs/failure", gate, getFailureGraph);
router.get("/graphs/all", gate, getAllGraphs);
router.get("/graphs/execution/:processId", gate, getExecutionGraphForProcess);

router.get("/impact/:processId", gate, getImpactAnalysis);
router.get("/impact/:processId/ai-explain", gate, getImpactAiExplain);

router.get("/events/registry", gate, getEventRegistry);
router.get("/events/failed", gate, getFailedEvents);
router.get("/events/trace/:sourceId", gate, getTrace);

export default router;

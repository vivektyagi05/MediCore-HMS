import { Router } from "express";
import {
  getIntelligenceOverview,
  getPredictions,
  getAnomalies,
  getCapacityForecast,
  getOptimizationSuggestions,
  getIntelligenceRegistry,
  getHealingQueue,
  postQueueHealingAction,
  postApproveHealingAction,
  postRejectHealingAction,
  getAllowedHealingActions,
  explainPrediction,
  explainAnomaly,
  getCapacityAiAdvisor,
  getOptimizationAiAdvisor,
  getSelfHealingAiAdvisor,
  getPlatformIntelligenceAiSummary,
} from "../../controllers/admin/intelligenceAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key already used by every other
// Operations/Workflow/Assignment/Automation-Studio/Monitoring surface — no
// new roles/permissions introduced for the Intelligence Platform.
const gate = requirePermission("manage_settings");

router.get("/overview", gate, getIntelligenceOverview);
router.get("/overview/ai-summary", gate, getPlatformIntelligenceAiSummary);

router.get("/registry", gate, getIntelligenceRegistry);

router.get("/predictions", gate, getPredictions);
router.get("/predictions/:predictionId/ai-explain", gate, explainPrediction);

router.get("/anomalies", gate, getAnomalies);
router.get("/anomalies/:anomalyId/ai-explain", gate, explainAnomaly);

router.get("/capacity-forecast", gate, getCapacityForecast);
router.get("/capacity-forecast/ai-advisor", gate, getCapacityAiAdvisor);

router.get("/optimization", gate, getOptimizationSuggestions);
router.get("/optimization/ai-advisor", gate, getOptimizationAiAdvisor);

router.get("/healing-actions/allowed", gate, getAllowedHealingActions);
router.get("/healing-actions/queue", gate, getHealingQueue);
router.get("/healing-actions/ai-advisor", gate, getSelfHealingAiAdvisor);
router.post("/healing-actions/queue", gate, postQueueHealingAction);
router.post("/healing-actions/:actionLogId/approve", gate, postApproveHealingAction);
router.post("/healing-actions/:actionLogId/reject", gate, postRejectHealingAction);

export default router;

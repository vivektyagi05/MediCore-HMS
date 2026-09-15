import { Router } from "express";
import {
  getExecutiveOverview,
  getCrossProcessOverview,
  listAnalyzableProcesses,
  getProcessPerformance,
  getProcessHealth,
  getProcessTrend,
  getProcessBottlenecks,
  getProcessFailures,
  getProcessSla,
  setProcessSlaTarget,
  getVersionIntelligence,
  getVersionComparison,
  listRecommendations,
  runDetection,
  reviewRecommendation,
  proposeVersion,
  simulateProposal,
  decideRecommendation,
  markImplemented,
  explainAnalytics,
  explainBottlenecks,
  explainOptimization,
  explainVersionComparison,
} from "../../controllers/admin/processAnalyticsController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key every other Process/Workflow/
// Automation/Monitoring admin surface already uses — no new roles.
const gate = requirePermission("manage_settings");

router.get("/overview", gate, getExecutiveOverview);
router.get("/cross-process", gate, getCrossProcessOverview);
router.get("/processes", gate, listAnalyzableProcesses);

router.get("/processes/:key/performance", gate, getProcessPerformance);
router.get("/processes/:key/health", gate, getProcessHealth);
router.get("/processes/:key/trend", gate, getProcessTrend);
router.get("/processes/:key/bottlenecks", gate, getProcessBottlenecks);
router.get("/processes/:key/failures", gate, getProcessFailures);
router.get("/processes/:key/sla", gate, getProcessSla);
router.put("/processes/:key/sla-target", gate, setProcessSlaTarget);
router.get("/processes/:key/versions", gate, getVersionIntelligence);
router.get("/processes/:key/version-comparison", gate, getVersionComparison);

router.get("/recommendations", gate, listRecommendations);
router.post("/recommendations/detect", gate, runDetection);
router.post("/recommendations/:id/review", gate, reviewRecommendation);
router.post("/recommendations/:id/propose-version", gate, proposeVersion);
router.post("/recommendations/:id/simulate", gate, simulateProposal);
router.post("/recommendations/:id/decide", gate, decideRecommendation);
router.post("/recommendations/:id/mark-implemented", gate, markImplemented);

router.get("/processes/:key/ai-explain", gate, explainAnalytics);
router.get("/processes/:key/ai-bottleneck-explain", gate, explainBottlenecks);
router.get("/processes/:key/ai-optimization-advisor", gate, explainOptimization);
router.get("/processes/:key/ai-version-comparison-explain", gate, explainVersionComparison);

export default router;

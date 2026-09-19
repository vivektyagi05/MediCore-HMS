import { Router } from "express";
import {
  getWorkloadIntelligence,
  getOperationRecommendations,
  getOperationReassignment,
  getConflictsList,
  getAnalytics,
  getAssignmentBusinessRules,
  runAssignmentSweep,
  getAssignmentRecommendationExplain,
  getWorkloadAdvisor,
  getReassignmentAdvisor,
  getSlaAdvisor,
  getAssignmentExplain,
} from "../../controllers/admin/assignmentAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key already used by every other
// Operations/Workflow surface — no new roles/permissions introduced.
router.get("/workload", requirePermission("manage_settings"), getWorkloadIntelligence);
router.get("/conflicts", requirePermission("manage_settings"), getConflictsList);
router.get("/analytics", requirePermission("manage_settings"), getAnalytics);
router.get("/business-rules", requirePermission("manage_settings"), getAssignmentBusinessRules);
router.post("/sweep", requirePermission("manage_settings"), runAssignmentSweep);

// AI Assignment Advisor (Step 12) — platform-wide capabilities.
router.get("/ai/workload-advisor", requirePermission("manage_settings"), getWorkloadAdvisor);
router.get("/ai/sla-advisor", requirePermission("manage_settings"), getSlaAdvisor);
router.get("/ai/explain", requirePermission("manage_settings"), getAssignmentExplain);

// Per-operation recommendation surfaces.
router.get("/:operationKey/recommendations", requirePermission("manage_settings"), getOperationRecommendations);
router.get("/:operationKey/reassignment", requirePermission("manage_settings"), getOperationReassignment);
router.get("/:operationKey/ai-recommendation", requirePermission("manage_settings"), getAssignmentRecommendationExplain);
router.get("/:operationKey/ai-reassignment", requirePermission("manage_settings"), getReassignmentAdvisor);

export default router;

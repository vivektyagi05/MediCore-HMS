import { Router } from "express";
import {
  getActionCenter,
  getExecutiveRecommendations,
  getDecisionCards,
  getExecutiveTimeline,
  getBusinessRules,
  broadcastAnnouncement,
  setRegistrationsPaused,
  explainMetric,
} from "../../controllers/admin/executiveActionController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Read surfaces: same "manage_settings" permission key already used by the
// Platform Health Center (no new roles/permissions invented).
router.get("/action-center", requirePermission("manage_settings"), getActionCenter);
router.get("/recommendations", requirePermission("manage_settings"), getExecutiveRecommendations);
router.get("/decisions", requirePermission("manage_settings"), getDecisionCards);
router.get("/timeline", requirePermission("manage_settings"), getExecutiveTimeline);
router.get("/business-rules", requirePermission("manage_settings"), getBusinessRules);
router.get("/explain/:metricKey", requirePermission("manage_settings"), explainMetric);

// Action surfaces.
router.post("/broadcast", requirePermission("manage_settings"), broadcastAnnouncement);
router.post("/registrations/pause", requirePermission("manage_settings"), setRegistrationsPaused);

export default router;

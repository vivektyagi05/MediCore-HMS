import { Router } from "express";
import {
  getIntegrations,
  getIntegrationHealth,
  getConnectedDisconnected,
  getLiveTraffic,
  getDeadEvents,
  explainIntegrationEdge,
} from "../../controllers/admin/integrationHubController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
const gate = requirePermission("manage_settings");

router.get("/edges", gate, getIntegrations);
router.get("/health", gate, getIntegrationHealth);
router.get("/connected-disconnected", gate, getConnectedDisconnected);
router.get("/live-traffic", gate, getLiveTraffic);
router.get("/dead-events", gate, getDeadEvents);
router.get("/edges/:edgeId/ai-explain", gate, explainIntegrationEdge);

export default router;

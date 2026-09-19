import { Router } from "express";
import {
  getExecutiveDashboard,
  getMissionControl,
  getSmartAlerts,
} from "../../controllers/admin/missionControlAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

router.get("/dashboard", getExecutiveDashboard);
router.get("/live", getMissionControl);
router.get("/alerts", getSmartAlerts);

export default router;

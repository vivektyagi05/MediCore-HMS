import { Router } from "express";
import {
  getPlatformHealthCenter,
  getInfrastructureStatus,
  getOperationalHealth,
  getOperationsQueue,
} from "../../controllers/admin/platformHealthAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Full center requires "manage_settings" (the existing permission key this
// codebase already uses for other platform-configuration surfaces) rather
// than a new, invented "operations" role — super_admin always passes.
router.get("/", requirePermission("manage_settings"), getPlatformHealthCenter);
router.get("/infrastructure", requirePermission("manage_settings"), getInfrastructureStatus);
router.get("/operational", requirePermission("manage_settings"), getOperationalHealth);
router.get("/operations-queue", getOperationsQueue);

export default router;

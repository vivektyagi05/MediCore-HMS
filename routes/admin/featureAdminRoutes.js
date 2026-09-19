import { Router } from "express";
import { listFeatureToggles, updateFeatureToggle } from "../../controllers/admin/featureAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", listFeatureToggles);
router.put("/:key", requirePermission("manage_settings"), updateFeatureToggle);
export default router;

import { Router } from "express";
import { getSettings, updateSettings } from "../../controllers/admin/settingsAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", getSettings);
router.put("/", requirePermission("manage_settings"), updateSettings);
export default router;

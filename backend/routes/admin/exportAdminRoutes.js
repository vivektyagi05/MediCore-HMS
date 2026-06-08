import { Router } from "express";
import { exportData } from "../../controllers/admin/exportAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", requirePermission("export_data"), exportData);
export default router;

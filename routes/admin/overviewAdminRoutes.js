import { Router } from "express";
import { getPlatformOverview, getPlatformAnalytics } from "../../controllers/admin/overviewAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", getPlatformOverview);
router.get("/analytics", getPlatformAnalytics);
export default router;

import { Router } from "express";
import { listActivityLogs } from "../../controllers/admin/activityAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", listActivityLogs);
export default router;

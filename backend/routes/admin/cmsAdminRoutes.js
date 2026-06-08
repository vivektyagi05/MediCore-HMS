import { Router } from "express";
import { deleteCMSPage, listCMSPages, updateCMSPage, upsertCMSPage } from "../../controllers/admin/cmsAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", listCMSPages);
router.post("/", requirePermission("manage_cms"), upsertCMSPage);
router.put("/:id", requirePermission("manage_cms"), updateCMSPage);
router.delete("/:id", requirePermission("manage_cms"), deleteCMSPage);
export default router;

import { Router } from "express";
import { createService, deleteService, listServices, updateService } from "../../controllers/admin/serviceAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", listServices);
router.post("/", requirePermission("manage_services"), createService);
router.put("/:id", requirePermission("manage_services"), updateService);
router.delete("/:id", requirePermission("manage_services"), deleteService);
export default router;

import { Router } from "express";
import { listAdmins, listPermissions, updateAdminRole, updateRolePermissions } from "../../controllers/admin/permissionAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);
router.get("/", requirePermission("manage_admins"), listPermissions);
router.put("/:role", requirePermission("manage_admins"), updateRolePermissions);
router.get("/hierarchy/admins", requirePermission("manage_admins"), listAdmins);
router.put("/hierarchy/admins/:id", requirePermission("manage_admins"), updateAdminRole);
export default router;

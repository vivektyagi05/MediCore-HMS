import { Router } from "express";
import {
  listDoctorsAdmin,
  getDoctorStatsAdmin,
  getDoctorDetailAdmin,
  getDoctorEarningsAdmin,
  downloadDoctorDocumentAdmin,
  getEligibleDoctorUsersAdmin,
} from "../../controllers/admin/doctorAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Fixed subpaths before the "/:id" pattern, same ordering convention as
// serviceAdminRoutes.js.
router.get("/stats", getDoctorStatsAdmin);
router.get("/eligible-users", getEligibleDoctorUsersAdmin);
router.get("/", listDoctorsAdmin);
router.get("/:id", getDoctorDetailAdmin);

// Financial data — extra permission gate beyond plain admin access, same
// key the Executive Dashboard's revenue widgets already require.
router.get("/:id/earnings", requirePermission("manage_payments"), getDoctorEarningsAdmin);

router.get("/:doctorId/documents/:documentId/download", downloadDoctorDocumentAdmin);

export default router;

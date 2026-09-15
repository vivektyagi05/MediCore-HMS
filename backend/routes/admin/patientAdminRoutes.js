import { Router } from "express";
import {
  listPatientsAdmin,
  getPatientStatsAdmin,
  getPatientWorkspaceAdmin,
  downloadPatientReportAdmin,
  downloadPatientPrescriptionAdmin,
} from "../../controllers/admin/patientAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Fixed subpaths before "/:id", same ordering convention as
// appointmentAdminRoutes.js / doctorAdminRoutes.js.
router.get("/stats", getPatientStatsAdmin);
router.get("/", listPatientsAdmin);
router.get("/:id", getPatientWorkspaceAdmin);
router.get("/reports/:reportId/download", downloadPatientReportAdmin);
router.get("/prescriptions/:prescriptionId/download", downloadPatientPrescriptionAdmin);

export default router;

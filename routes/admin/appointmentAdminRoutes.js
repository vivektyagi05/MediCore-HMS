import { Router } from "express";
import {
  listAppointmentsAdmin,
  getAppointmentSummaryAdmin,
  getAppointmentDetailAdmin,
  cancelAppointmentAdmin,
} from "../../controllers/admin/appointmentAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Fixed subpaths before "/:id", same ordering convention as
// doctorAdminRoutes.js / serviceAdminRoutes.js.
router.get("/summary", getAppointmentSummaryAdmin);
router.get("/", listAppointmentsAdmin);
router.get("/:id", getAppointmentDetailAdmin);
router.patch("/:id/cancel", cancelAppointmentAdmin);

export default router;

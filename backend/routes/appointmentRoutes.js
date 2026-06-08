import { Router } from "express";
import {
  createAppointment,
  getAppointments,
  updateAppointmentStatus,
  cancelAppointment
} from "../controllers/appointmentController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

router.post("/", protect, authorizeRoles(ROLES.PATIENT), createAppointment);
router.get(
  "/",
  protect,
  authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.DOCTOR, ROLES.PATIENT),
  getAppointments,
);
router.put(
  "/:id/status",
  protect,
  authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.DOCTOR),
  updateAppointmentStatus,
);
router.patch(
  "/:id/cancel",
  protect,
  authorizeRoles(
    ROLES.PATIENT
  ),
  cancelAppointment
);
export default router;

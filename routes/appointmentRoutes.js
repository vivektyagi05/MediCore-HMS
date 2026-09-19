import { Router } from "express";
import {
  createAppointment,
  getAppointments,
  getAppointmentSummary,
  getAppointmentById,
  getAvailableSlots,
  getNextAvailableSlot,
  updateAppointmentStatus,
  cancelAppointment,
  rescheduleAppointment,
} from "../controllers/appointmentController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

// Fixed subpaths registered before any "/:id"-style route to avoid path
// collisions (same convention as admin/appointmentAdminRoutes.js).
router.get(
  "/available-slots",
  protect,
  authorizeRoles(ROLES.PATIENT, ROLES.SUPER_ADMIN, ROLES.DOCTOR),
  getAvailableSlots,
);

// Phase DOC-07 — real server-side "next available slot" search (see
// controller for why: replaces N sequential /available-slots requests with
// one bounded, DB-efficient search using the same buildDayCapacity engine).
router.get(
  "/next-available",
  protect,
  authorizeRoles(ROLES.PATIENT, ROLES.SUPER_ADMIN, ROLES.DOCTOR),
  getNextAvailableSlot,
);

// Phase DOC-04 — doctor-only real dashboard counts (see controller for why
// this exists: paginating the list makes browser-side counting wrong).
router.get(
  "/summary",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getAppointmentSummary,
);

router.post("/", protect, authorizeRoles(ROLES.PATIENT), createAppointment);
router.get(
  "/:id",
  protect,
  authorizeRoles(ROLES.SUPER_ADMIN, ROLES.DOCTOR, ROLES.PATIENT),
  getAppointmentById,
);
router.get(
  "/",
  protect,
  authorizeRoles(ROLES.SUPER_ADMIN, ROLES.DOCTOR, ROLES.PATIENT),
  getAppointments,
);
router.put(
  "/:id/status",
  protect,
  authorizeRoles(ROLES.SUPER_ADMIN, ROLES.DOCTOR),
  updateAppointmentStatus,
);
router.patch(
  "/:id/cancel",
  protect,
  authorizeRoles(ROLES.PATIENT, ROLES.DOCTOR),
  cancelAppointment,
);
// Phase DOC-04 — real reschedule (see controller: conflict/leave-checked,
// history-tracked). Admin included for parity with its existing ability to
// act on any appointment; it has no dedicated admin route file entry
// because there is nothing admin-specific about the rule, unlike
// cancellation (which needs a mandatory reason on the admin side).
router.patch(
  "/:id/reschedule",
  protect,
  authorizeRoles(ROLES.PATIENT, ROLES.DOCTOR, ROLES.SUPER_ADMIN),
  rescheduleAppointment,
);
export default router;

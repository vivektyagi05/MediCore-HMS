import { Router } from "express";
import {
  createDoctor,
  deleteDoctor,
  getDoctors,
  getDoctorPatients,
  updateDoctor,
  getPendingDoctors,
  approveDoctor,
  rejectDoctor,
} from "../controllers/doctorController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import {
 getDoctorReviews,
 replyToReview,
}
from "../controllers/doctor/doctorReviewController.js";
const router = Router();

import {
  getDoctorEarnings
}
from "../controllers/doctor/doctorEarningsController.js";

/*
|--------------------------------------------------------------------------
| Public Doctor Routes
|--------------------------------------------------------------------------
*/

router.get("/", getDoctors);

/*
|--------------------------------------------------------------------------
| Doctor Specific Routes
|--------------------------------------------------------------------------
*/

router.get(
  "/patients",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorPatients,
);

/*
|--------------------------------------------------------------------------
| Admin Doctor Management
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ),
  createDoctor,
);

router.put(
  "/:id",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ),
  updateDoctor,
);

router.delete(
  "/:id",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ),
  deleteDoctor,
);

router.get(
  "/pending",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN
  ),
  getPendingDoctors
);

router.put(
  "/:id/approve",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN
  ),
  approveDoctor
);

router.put(
  "/:id/reject",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN
  ),
  rejectDoctor
);

router.get(
 "/reviews",
 protect,
 authorizeRoles(
   ROLES.DOCTOR
 ),
 getDoctorReviews
);

router.patch(
  "/reviews/:id/reply",
  protect,
  authorizeRoles(
    ROLES.DOCTOR
  ),
  replyToReview
);

router.get(
"/earnings",
protect,
authorizeRoles(
ROLES.DOCTOR
),
getDoctorEarnings
);
export default router;
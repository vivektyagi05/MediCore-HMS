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
  verifyDoctorDocument,
} from "../controllers/doctorController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import {
 getDoctorReviews,
 replyToReview,
 togglePinReview,
}
from "../controllers/doctor/doctorReviewController.js";
const router = Router();

import {
  getDoctorEarnings,
  getDoctorPayouts,
  getDoctorFinancialAttention,
  getDoctorReconciliation,
  getDoctorFinancialPosition,
}
from "../controllers/doctor/doctorEarningsController.js";

// P23 — Withdrawal domain (Section 22/23/27).
import {
  getWithdrawalBalance,
  requestWithdrawal,
  getMyWithdrawals,
  getWithdrawalDetail,
} from "../controllers/doctor/doctorWithdrawalController.js";

import {
  getDoctorBusinessOverview,
}
from "../controllers/doctor/businessOverviewController.js";

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

router.put(
  "/:doctorId/documents/:documentId/verify",
  protect,
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN
  ),
  verifyDoctorDocument
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

// PHASE DOC-09 — Financial Control Center additions. Each endpoint
// resolves doctorId itself from the authenticated user (never trusts a
// frontend-supplied doctorId), matching the same pattern getDoctorEarnings
// already uses.
router.get(
  "/payouts",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorPayouts
);

router.get(
  "/earnings/attention",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorFinancialAttention
);

router.get(
  "/earnings/reconciliation",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorReconciliation
);

router.get(
  "/earnings/position",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorFinancialPosition
);

// P23 — Withdrawal domain endpoints. Balance is server-calculated
// (Section 23 Step 3) via the same canonical computeDoctorWithdrawableBalance
// the admin workspace and requestWithdrawal itself both use.
router.get(
  "/withdrawals/balance",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getWithdrawalBalance
);

router.post(
  "/withdrawals",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requestWithdrawal
);

router.get(
  "/withdrawals",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getMyWithdrawals
);

router.get(
  "/withdrawals/:id",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getWithdrawalDetail
);

router.patch(
  "/reviews/:id/pin",
  protect,
  authorizeRoles(
    ROLES.DOCTOR
  ),
  togglePinReview
);

router.get(
  "/business/overview",
  protect,
  authorizeRoles(
    ROLES.DOCTOR
  ),
  getDoctorBusinessOverview
);
export default router;
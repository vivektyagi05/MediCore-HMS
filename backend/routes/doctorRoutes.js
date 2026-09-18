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
import { requireApprovedDoctor } from "../middleware/doctorAccessMiddleware.js";
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
  requireApprovedDoctor,
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
    ROLES.SUPER_ADMIN,
  ),
  createDoctor,
);

router.put(
  "/:id",
  protect,
  authorizeRoles(
    ROLES.SUPER_ADMIN,
  ),
  updateDoctor,
);

router.delete(
  "/:id",
  protect,
  authorizeRoles(
    ROLES.SUPER_ADMIN,
  ),
  deleteDoctor,
);

router.get(
  "/pending",
  protect,
  authorizeRoles(
    ROLES.SUPER_ADMIN
  ),
  getPendingDoctors
);

router.put(
  "/:id/approve",
  protect,
  authorizeRoles(
    ROLES.SUPER_ADMIN
  ),
  approveDoctor
);

router.put(
  "/:id/reject",
  protect,
  authorizeRoles(
    ROLES.SUPER_ADMIN
  ),
  rejectDoctor
);

router.put(
  "/:doctorId/documents/:documentId/verify",
  protect,
  authorizeRoles(
    ROLES.SUPER_ADMIN
  ),
  verifyDoctorDocument
);

router.get(
 "/reviews",
 protect,
 authorizeRoles(ROLES.DOCTOR),
 requireApprovedDoctor,
  getDoctorReviews
);

router.patch(
  "/reviews/:id/reply",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  replyToReview
);

router.get(
"/earnings",
protect,
authorizeRoles(ROLES.DOCTOR),
requireApprovedDoctor,
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
  requireApprovedDoctor,
  getDoctorPayouts
);

router.get(
  "/earnings/attention",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getDoctorFinancialAttention
);

router.get(
  "/earnings/reconciliation",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getDoctorReconciliation
);

router.get(
  "/earnings/position",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getDoctorFinancialPosition
);

// P23 — Withdrawal domain endpoints. Balance is server-calculated
// (Section 23 Step 3) via the same canonical computeDoctorWithdrawableBalance
// the admin workspace and requestWithdrawal itself both use.
router.get(
  "/withdrawals/balance",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getWithdrawalBalance
);

router.post(
  "/withdrawals",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  requestWithdrawal
);

router.get(
  "/withdrawals",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getMyWithdrawals
);

router.get(
  "/withdrawals/:id",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getWithdrawalDetail
);

router.patch(
  "/reviews/:id/pin",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  togglePinReview
);

router.get(
  "/business/overview",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  requireApprovedDoctor,
  getDoctorBusinessOverview
);
export default router;
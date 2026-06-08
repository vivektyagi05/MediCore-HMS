import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import {
  cancelSubscription,
  createCoupon,
  createSubscription,
  createWalletRechargeOrder,
  getLedger,
  getPlans,
  getReconciliationReport,
  getSubscriptions,
  listCoupons,
  retryDuePayments,
  updateCoupon,
  validateCoupon,
  verifyWalletRecharge,
} from "../controllers/financeController.js";

const router = Router();

router.post("/coupons/validate", protect, authorizeRoles(ROLES.PATIENT), validateCoupon);
router.get("/coupons", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), listCoupons);
router.post("/coupons", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), createCoupon);
router.patch("/coupons/:id", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), updateCoupon);

router.get("/subscriptions/plans", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.DOCTOR), getPlans);
router.get("/subscriptions", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.DOCTOR), getSubscriptions);
router.post("/subscriptions", protect, authorizeRoles(ROLES.DOCTOR), createSubscription);
router.patch("/subscriptions/:id/cancel", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.DOCTOR), cancelSubscription);

router.get("/ledger", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT, ROLES.DOCTOR), getLedger);
router.post("/wallet/recharge/orders", protect, authorizeRoles(ROLES.PATIENT), createWalletRechargeOrder);
router.post("/wallet/recharge/verify", protect, authorizeRoles(ROLES.PATIENT), verifyWalletRecharge);

router.post("/payments/retry-due", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), retryDuePayments);
router.get("/reconciliation", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), getReconciliationReport);

export default router;

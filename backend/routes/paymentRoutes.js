import { Router } from "express";
import {
  completeTestPayment,
  createPaymentOrder,
  getFinancialSummary,
  getPaymentAnalytics,
  getPaymentStatus,
  getPayments,
  retryPayment,
  verifyPayment,
} from "../controllers/paymentController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

router.post("/orders", protect, authorizeRoles(ROLES.PATIENT), createPaymentOrder);
router.post("/verify", protect, authorizeRoles(ROLES.PATIENT), verifyPayment);
router.post("/test/complete", protect, authorizeRoles(ROLES.PATIENT), completeTestPayment);
// P23 Section 5/6 — recovery (authoritative status for an appointment's
// most recent payment) and retry (new attempt on the SAME payment).
// Ownership is enforced inside each controller, matching every other
// patient-scoped route in this file.
router.get("/status/:appointmentId", protect, authorizeRoles(ROLES.PATIENT), getPaymentStatus);
router.post("/:id/retry", protect, authorizeRoles(ROLES.PATIENT), retryPayment);
router.get("/", protect, authorizeRoles(ROLES.SUPER_ADMIN, ROLES.PATIENT), getPayments);
router.get("/summary", protect, authorizeRoles(ROLES.SUPER_ADMIN), getFinancialSummary);
router.get("/analytics", protect, authorizeRoles(ROLES.SUPER_ADMIN, ROLES.PATIENT), getPaymentAnalytics);

export default router;

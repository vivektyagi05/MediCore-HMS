import { Router } from "express";
import {
  createPaymentOrder,
  getFinancialSummary,
  getPayments,
  verifyPayment,
} from "../controllers/paymentController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

router.post("/orders", protect, authorizeRoles(ROLES.PATIENT), createPaymentOrder);
router.post("/verify", protect, authorizeRoles(ROLES.PATIENT), verifyPayment);
router.get("/", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), getPayments);
router.get("/summary", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), getFinancialSummary);

export default router;

import { Router } from "express";
import {
  approveRefundRequest,
  createRefundRequest,
  initiateRefund,
  listRefundRequests,
  rejectRefundRequest,
} from "../controllers/refundController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), listRefundRequests);
router.post("/requests/:paymentId", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), createRefundRequest);
router.patch("/requests/:id/approve", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), approveRefundRequest);
router.patch("/requests/:id/reject", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), rejectRefundRequest);
router.post("/:paymentId", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), initiateRefund);

export default router;

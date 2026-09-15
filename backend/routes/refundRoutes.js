import { Router } from "express";
import {
  approveRefundRequest,
  createRefundRequest,
  getRefundEligibility,
  getRefundRequestDetail,
  initiateRefund,
  listRefundRequests,
  rejectRefundRequest,
  reportPaymentProblem,
  retryRefundRequest,
} from "../controllers/refundController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { requirePermission } from "../middleware/adminMiddleware.js";

const router = Router();

// Read/create stay role-based — patients need these too (list their own
// requests, request a refund on their own payment); ownership itself is
// enforced inside the controllers, not by this gate.
router.get("/", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), listRefundRequests);
// P23 (Section 10/12/14) — eligibility (drives the frontend's Case A-D
// branching) and single-request detail (drives the refund tracker). Both
// pure reads; ownership enforced inside the controllers.
router.get("/eligibility/:paymentId", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), getRefundEligibility);
router.get("/requests/:id/detail", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), getRefundRequestDetail);
router.post("/requests/:paymentId", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), createRefundRequest);

// P23 (Section 5/7) — the only refund-adjacent action available to a
// patient once the consultation is already complete. Same ownership rule
// as createRefundRequest (enforced inside the controller), deliberately a
// distinct route so the frontend can route a completed appointment here
// without ever calling the cancellation-refund endpoint.
router.post("/report-problem/:paymentId", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), reportPaymentProblem);

// AUDIT FINDING (Phase UI-6): these four are the actual money-moving admin
// actions and were previously gated by role alone (any admin/super_admin),
// unlike the Payments workspace which already gates all financial admin
// surfaces behind the manage_payments permission. Brought into line —
// requirePermission() also implies admin-role-only (see adminMiddleware.js).
router.patch("/requests/:id/approve", protect, requirePermission("manage_payments"), approveRefundRequest);
router.patch("/requests/:id/reject", protect, requirePermission("manage_payments"), rejectRefundRequest);
router.patch("/requests/:id/retry", protect, requirePermission("manage_payments"), retryRefundRequest);
router.post("/:paymentId", protect, requirePermission("manage_payments"), initiateRefund);

export default router;

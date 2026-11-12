import { Router } from "express";
import {
  listRefundsAdmin,
  getRefundSummaryAdmin,
  getRefundDetailAdmin,
} from "../../controllers/admin/refundAdminController.js";
import { listRefundReviewsAdmin, resolveRefundReviewAdmin } from "../../controllers/refundReviewController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Refund data is financial data — same manage_payments permission key
// already used by the Payments workspace and by the mutating actions on
// /api/refunds/* (approve/reject/retry/initiate). No new permission key.
const gate = requirePermission("manage_payments");

// Fixed subpaths before "/:id", same ordering convention as
// paymentAdminRoutes.js / appointmentAdminRoutes.js.
router.get("/summary", gate, getRefundSummaryAdmin);
// Doctor refund-review requests (fixed subpaths before "/:id")
router.get("/reviews", gate, listRefundReviewsAdmin);
router.post("/reviews/:id/resolve", gate, resolveRefundReviewAdmin);
router.get("/", gate, listRefundsAdmin);
router.get("/:id", gate, getRefundDetailAdmin);

export default router;

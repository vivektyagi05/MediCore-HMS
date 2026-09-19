import { Router } from "express";

import {
  listReviewsAdmin,
  getReviewSummaryAdmin,
  getReviewAttentionQueueAdmin,
  getReviewDetailAdmin,
  deleteReview,
} from "../controllers/admin/adminReviewController.js";

import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Fixed subpaths before "/:id", same ordering convention as
// appointmentAdminRoutes.js / patientAdminRoutes.js — otherwise Express
// would match "/summary" and "/attention-queue" as a review :id.
router.get("/summary", getReviewSummaryAdmin);
router.get("/attention-queue", getReviewAttentionQueueAdmin);
router.get("/", listReviewsAdmin);
router.get("/:id", getReviewDetailAdmin);
router.delete("/:id", deleteReview);

export default router;

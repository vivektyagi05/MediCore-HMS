import { Router } from "express";

import {
 getAllReviews,
 deleteReview
}
from "../controllers/admin/adminReviewController.js";

import {
 protect
}
from "../middleware/authMiddleware.js";

import {
 authorizeRoles
}
from "../middleware/roleMiddleware.js";

import {
 ROLES
}
from "../constants/roles.js";

const router = Router();

router.get(
 "/",
 protect,
 authorizeRoles(
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN
 ),
 getAllReviews
);

router.delete(
 "/:id",
 protect,
 authorizeRoles(
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN
 ),
 deleteReview
);

export default router;
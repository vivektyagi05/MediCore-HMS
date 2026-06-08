import { Router } from "express";
console.log("ONBOARDING ROUTES LOADED");
import {
  getMyOnboarding,
  submitOnboarding,
  updateOnboarding,
} from "../../controllers/doctorOnboardingController.js";

import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";
import { ROLES } from "../../constants/roles.js";

const router = Router();

router.get(
  "/onboarding",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getMyOnboarding
);

router.post(
  "/onboarding",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  submitOnboarding
);

router.put(
  "/onboarding",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  updateOnboarding
);

export default router;
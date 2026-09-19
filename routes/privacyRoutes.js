import { Router } from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { accountRateLimit } from "../middleware/accountRateLimit.js";
import {
  getPublicPrivacyConfig,
  getPrivacyPreferences,
  updatePrivacyPreferences,
  createPrivacyRequest,
  getPrivacyRequests,
  exportPrivacyData,
  createPublicGrievance,
} from "../controllers/privacyController.js";

const router = Router();

const privacyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many privacy requests. Please try again later." },
});

const grievanceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many grievance submissions. Please try again later." },
});

router.get("/public-config", getPublicPrivacyConfig);

router.get(
  "/preferences",
  protect,
  privacyLimiter,
  getPrivacyPreferences,
);
router.put(
  "/preferences",
  protect,
  privacyLimiter,
  updatePrivacyPreferences,
);
router.post(
  "/requests",
  protect,
  privacyLimiter,
  accountRateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 5,
    keyFn: (req) => String(req.user?._id || ""),
    message: "Too many privacy requests for this account today.",
  }),
  createPrivacyRequest,
);
router.get(
  "/requests",
  protect,
  privacyLimiter,
  getPrivacyRequests,
);
router.get(
  "/export",
  protect,
  privacyLimiter,
  accountRateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 3,
    keyFn: (req) => String(req.user?._id || ""),
    message: "Too many data export requests for this account today.",
  }),
  exportPrivacyData,
);
router.post(
  "/grievance",
  grievanceLimiter,
  createPublicGrievance,
);

export default router;

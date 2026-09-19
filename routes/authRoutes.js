import { Router } from "express";
import { getMe, login, register, verifyEmail, resendVerification } from "../controllers/authController.js";
import {
  forgotPassword,
  verifyPasswordResetOtp,
  resetPassword,
} from "../controllers/passwordRecoveryController.js";
import { accountRateLimit, normalizeEmailKey } from "../middleware/accountRateLimit.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post(
  "/resend-verification",
  accountRateLimit({
    windowMs: 60 * 1000,
    max: 3,
    keyFn: normalizeEmailKey,
    message: "Too many verification requests. Please wait before trying again.",
  }),
  resendVerification,
);
// PHASE 2-A — real session-restoration endpoint. `protect` re-verifies the
// token (expiry, isActive, securityVersion) on every call, so a stale or
// revoked cached session is rejected here rather than trusted client-side.
router.get("/me", protect, getMe);

// Phase P15 — password recovery. The recovery endpoint has a dedicated IP
// limiter in app.js plus these account-keyed limits, while OTP verification
// has its own recoveryId-keyed attempt limiter. This keeps recovery traffic
// isolated from the login/register auth bucket.
//
// forgot-password doubles as the "resend code" action (a fresh request
// supersedes the previous OTP). Recovery traffic is intentionally allowed
// up to 10 requests/minute per email so a user is not blocked by a single
// resend while still retaining a longer per-email abuse cap. A separate
// 60 requests/minute IP limiter is mounted in app.js, so multiple users
// behind the same network do not share the old 20/15-minute auth bucket.
router.post(
  "/forgot-password",
  accountRateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyFn: normalizeEmailKey,
    message: "Too many recovery requests for this email. Please wait a moment and try again.",
  }),
  accountRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    keyFn: normalizeEmailKey,
    message: "Too many recovery requests for this email. Please try again later.",
  }),
  forgotPassword,
);

router.post(
  "/verify-password-reset-otp",
  accountRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    keyFn: (req) => (typeof req.body?.recoveryId === "string" ? req.body.recoveryId : ""),
    message: "Too many attempts. Please request a new code.",
  }),
  verifyPasswordResetOtp,
);

router.post("/reset-password", resetPassword);

export default router;

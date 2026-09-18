import { Router } from "express";
import { getMe, login, register } from "../controllers/authController.js";
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
// PHASE 2-A — real session-restoration endpoint. `protect` re-verifies the
// token (expiry, isActive, securityVersion) on every call, so a stale or
// revoked cached session is rejected here rather than trusted client-side.
router.get("/me", protect, getMe);

// Phase P15 — password recovery. All three routes already sit behind the
// app-wide IP-based authLimiter (app.js). These add a second, account-keyed
// layer so one victim's inbox/OTP can't be hammered from many IPs.
//
// forgot-password doubles as the "resend code" action (a fresh request
// simply supersedes the previous OTP — see CHANGELOG "Multiple OTP
// requests"), so its cooldown IS the resend cooldown: 1 request / 60s per
// email, with a looser per-email window on top against burst abuse.
router.post(
  "/forgot-password",
  accountRateLimit({
    windowMs: 60 * 1000,
    max: 1,
    keyFn: normalizeEmailKey,
    message: "Please wait a minute before requesting another code.",
  }),
  accountRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyFn: normalizeEmailKey,
    message: "Too many code requests for this email. Please try again later.",
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

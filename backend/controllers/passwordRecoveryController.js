import User from "../models/User.js";
import PasswordReset from "../models/PasswordReset.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { logger } from "../utils/logger.js";
import {
  generateSecureOtp,
  hashOtp,
  compareOtp,
  generateSecureResetToken,
  hashResetToken,
} from "../utils/otp.js";
import {
  sendPasswordRecoveryOtpEmail,
  isBrevoConfigured,
  BrevoConfigurationError,
  BrevoDeliveryError,
} from "../services/emailService.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const GENERIC_REQUEST_MESSAGE =
  "If an account exists for this email, a verification code has been sent.";
const RECOVERY_UNAVAILABLE_MESSAGE =
  "Password recovery is temporarily unavailable. Please try again later.";
const GENERIC_OTP_INVALID_MESSAGE = "That code is invalid or has expired.";
const GENERIC_OTP_LOCKED_MESSAGE = "Too many incorrect attempts. Please request a new code.";
const GENERIC_RESET_INVALID_MESSAGE = "This verification session is invalid or has expired.";

const recoveryUnavailable = (res, error = undefined) => {
  res.set("Cache-Control", "no-store");
  const statusCategory = error?.statusCategory;
  const code = statusCategory === "credential"
    ? "EMAIL_PROVIDER_CREDENTIAL_ERROR"
    : statusCategory === "rate_limit"
      ? "EMAIL_PROVIDER_RATE_LIMITED"
      : statusCategory === "network"
        ? "EMAIL_PROVIDER_UNREACHABLE"
        : statusCategory === "provider_5xx"
          ? "EMAIL_PROVIDER_UNAVAILABLE"
          : "PASSWORD_RECOVERY_UNAVAILABLE";

  res.status(503).json({
    success: false,
    code,
    message: RECOVERY_UNAVAILABLE_MESSAGE,
  });
};

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!email || !emailPattern.test(email)) {
    throw new AppError("A valid email address is required", 400);
  }

  if (!isBrevoConfigured()) {
    recoveryUnavailable(res);
    return;
  }

  const user = await User.findOne({ email, isActive: true });

  if (!user) {
    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      message: GENERIC_REQUEST_MESSAGE,
    });
    return;
  }

  await PasswordReset.updateMany(
    { user: user._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const rawOtp = generateSecureOtp();
  const otpHash = await hashOtp(rawOtp);

  const record = await PasswordReset.create({
    user: user._id,
    otpHash,
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    otpMaxAttempts: OTP_MAX_ATTEMPTS,
    requestIp: req.ip || "",
  });

  try {
    const delivery = await sendPasswordRecoveryOtpEmail({
      toEmail: user.email,
      toName: user.name,
      otp: rawOtp,
      expiryMinutes: OTP_TTL_MS / 60000,
    });

    if (!delivery?.messageId) {
      throw new BrevoDeliveryError("The email provider returned an invalid response.", "malformed_response");
    }
  } catch (error) {
    await PasswordReset.updateOne(
      { _id: record._id },
      { $set: { consumedAt: new Date() } },
    );

    if (error instanceof BrevoConfigurationError || error instanceof BrevoDeliveryError) {
      logger.error("Password recovery email could not be sent; OTP invalidated", {
        event: "password_recovery_email_failed_otp_invalidated",
        reason: error.name,
        statusCategory: error.statusCategory,
      });
    } else {
      logger.error("Unexpected password recovery email failure; OTP invalidated", {
        event: "password_recovery_email_unexpected_error",
      });
    }

    recoveryUnavailable(res, error);
    return;
  }

  res.set("Cache-Control", "no-store");
  res.status(200).json({
    success: true,
    message: GENERIC_REQUEST_MESSAGE,
    data: {
      recoveryId: record._id.toString(),
      expiresInSeconds: OTP_TTL_MS / 1000,
    },
  });
});

export const verifyPasswordResetOtp = asyncHandler(async (req, res) => {
  const { recoveryId, otp } = req.body;

  if (typeof recoveryId !== "string" || !/^[a-f0-9]{24}$/i.test(recoveryId) || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    throw new AppError(GENERIC_OTP_INVALID_MESSAGE, 400);
  }

  const record = await PasswordReset.findOne({
    _id: recoveryId,
    consumedAt: null,
    otpVerifiedAt: null,
  }).select("+otpHash");

  if (!record) {
    throw new AppError(GENERIC_OTP_INVALID_MESSAGE, 400);
  }

  if (record.otpExpiresAt.getTime() <= Date.now()) {
    await PasswordReset.updateOne({ _id: record._id }, { $set: { consumedAt: new Date() } });
    throw new AppError(GENERIC_OTP_INVALID_MESSAGE, 400);
  }

  const isMatch = await compareOtp(otp, record.otpHash);

  if (!isMatch) {
    // Atomic increment + re-check in one operation — never a separate
    // find-then-update (see CHANGELOG "One-time OTP" / race safety).
    const updated = await PasswordReset.findOneAndUpdate(
      { _id: record._id, consumedAt: null },
      { $inc: { otpAttemptCount: 1 } },
      { new: true },
    );

    if (updated && updated.otpAttemptCount >= updated.otpMaxAttempts) {
      await PasswordReset.updateOne({ _id: updated._id }, { $set: { consumedAt: new Date() } });
      throw new AppError(GENERIC_OTP_LOCKED_MESSAGE, 429);
    }

    throw new AppError(GENERIC_OTP_INVALID_MESSAGE, 400);
  }

  const rawResetToken = generateSecureResetToken();
  const resetTokenHash = hashResetToken(rawResetToken);

  // Atomic: only succeeds if this record hasn't already been verified by a
  // concurrent request — prevents the same OTP producing two live reset
  // tokens under a race.
  const verified = await PasswordReset.findOneAndUpdate(
    { _id: record._id, consumedAt: null, otpVerifiedAt: null },
    {
      $set: {
        otpVerifiedAt: new Date(),
        resetTokenHash,
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    },
    { new: true },
  );

  if (!verified) {
    throw new AppError(GENERIC_OTP_INVALID_MESSAGE, 400);
  }

  // Deliberately NOT a JWT, NOT the user object, NOT the raw OTP —
  // just the one-time reset authorization (see CHANGELOG "Reset
  // authorization is not the OTP").
  res.status(200).json({
    success: true,
    message: "Code verified. You can now set a new password.",
    data: {
      resetToken: rawResetToken,
      expiresInSeconds: RESET_TOKEN_TTL_MS / 1000,
    },
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;

  if (typeof resetToken !== "string" || !resetToken) {
    throw new AppError(GENERIC_RESET_INVALID_MESSAGE, 400);
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new AppError("Password must be at least 8 characters long", 400);
  }

  const resetTokenHash = hashResetToken(resetToken);

  // Atomic consume: the same operation that validates the token also
  // marks it used, closing the race window between "check" and "use".
  const record = await PasswordReset.findOneAndUpdate(
    {
      resetTokenHash,
      consumedAt: null,
      otpVerifiedAt: { $ne: null },
      resetTokenExpiresAt: { $gt: new Date() },
    },
    { $set: { consumedAt: new Date() } },
    { new: true },
  );

  if (!record) {
    throw new AppError(GENERIC_RESET_INVALID_MESSAGE, 400);
  }

  const user = await User.findById(record.user);

  if (!user || !user.isActive) {
    // Account is gone/disabled since the request was made — same generic
    // message, never revealing account status (see CHANGELOG "Account
    // status").
    throw new AppError(GENERIC_RESET_INVALID_MESSAGE, 400);
  }

  user.password = newPassword; // re-hashed by User's existing pre-save hook
  user.securityVersion = (user.securityVersion || 0) + 1; // invalidates every existing JWT
  await user.save();

  // Belt-and-suspenders: invalidate any other still-active recovery
  // records for this user now that the password has actually changed.
  await PasswordReset.updateMany(
    { user: user._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  res.status(200).json({
    success: true,
    message: "Your password has been changed. Please sign in with your new password.",
  });
});

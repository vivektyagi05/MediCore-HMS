import User from "../models/User.js";
import { env } from "../config/env.js";
import { emailService } from "./emailService.js";
import {
  EMAIL_VERIFICATION_EXPIRY_MS,
  generateEmailVerificationToken,
  getEmailVerificationExpiry,
  hashEmailVerificationToken,
} from "../utils/emailVerification.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { logger } from "../utils/logger.js";

const buildVerificationUrl = (token) =>
  `${env.frontendUrl.replace(/\/$/, "")}/verify-email#token=${encodeURIComponent(token)}`;

export const issueEmailVerification = async (user, { replaceExisting = true } = {}) => {
  if (user.emailVerified) return { alreadyVerified: true };

  const token = generateEmailVerificationToken();
  const expiresAt = getEmailVerificationExpiry();

  if (replaceExisting) {
    user.emailVerificationTokenHash = hashEmailVerificationToken(token);
    user.emailVerificationExpiresAt = expiresAt;
    user.emailVerificationSentAt = new Date();
    await user.save();
  }

  try {
    const result = await emailService.sendEmailVerification({
      toEmail: user.email,
      toName: user.name,
      verificationUrl: buildVerificationUrl(token),
      expiryMinutes: Math.ceil(EMAIL_VERIFICATION_EXPIRY_MS / 60000),
    });
    return { sent: true, messageId: result.messageId };
  } catch (error) {
    if (replaceExisting) {
      user.emailVerificationTokenHash = null;
      user.emailVerificationExpiresAt = null;
      await user.save();
    }
    throw error;
  }
};

export const verifyEmailToken = async (rawToken) => {
  if (typeof rawToken !== "string" || rawToken.length < 20) {
    throw new AppError("Invalid or expired verification link", 400);
  }

  const tokenHash = hashEmailVerificationToken(rawToken);
  const user = await User.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpiresAt: { $gt: new Date() },
    isActive: true,
  }).select("+emailVerificationTokenHash +emailVerificationExpiresAt");

  if (!user) {
    const matchingVerifiedUser = await User.findOne({
      emailVerified: true,
      isActive: true,
      emailVerificationLastUsedHash: tokenHash,
    }).select("_id emailVerified");

    if (matchingVerifiedUser) {
      return { alreadyVerified: true, user: matchingVerifiedUser };
    }

    throw new AppError("Invalid or expired verification link", 400);
  }

  user.emailVerified = true;
  user.emailVerificationLastUsedHash = tokenHash;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  user.emailVerificationSentAt = null;
  await user.save();

  return { verified: true, user };
};

export const verificationCooldownMs = 60 * 1000;

export const canResendVerification = (user) => {
  if (!user?.emailVerificationSentAt) return true;
  return Date.now() - new Date(user.emailVerificationSentAt).getTime() >= verificationCooldownMs;
};

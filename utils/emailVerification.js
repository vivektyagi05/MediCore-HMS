import crypto from "crypto";

export const EMAIL_VERIFICATION_EXPIRY_MS = 30 * 60 * 1000;

export const generateEmailVerificationToken = () => crypto.randomBytes(32).toString("base64url");

export const hashEmailVerificationToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

export const getEmailVerificationExpiry = () =>
  new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

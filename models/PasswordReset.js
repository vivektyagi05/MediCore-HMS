import mongoose from "mongoose";

// Phase P15 — dedicated recovery model, chosen over embedding fields on
// User (see CHANGELOG-PHASE-P15-PASSWORD-RECOVERY-OTP-BREVO.md, "Storage
// architecture") because a recovery attempt needs its own lifecycle
// (expiry, attempt counting, one-time consumption, superseding a prior
// request) that has nothing to do with the account itself and would
// otherwise pollute User with transient state.
//
// SECURITY: this document NEVER stores a raw OTP, a raw reset token, a
// password, or any credential material — only salted hashes, and only
// for as long as the recovery attempt is live.
const passwordResetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // bcrypt hash of the 6-digit OTP. Never the raw code.
    otpHash: {
      type: String,
      required: true,
      select: false,
    },
    otpExpiresAt: {
      type: Date,
      required: true,
    },
    otpAttemptCount: {
      type: Number,
      default: 0,
    },
    otpMaxAttempts: {
      type: Number,
      default: 5,
    },
    // Set once the OTP has been verified. From this point the raw OTP is
    // dead — only the short-lived reset token below can complete the reset.
    otpVerifiedAt: {
      type: Date,
      default: null,
    },
    // sha256 hash of a high-entropy random reset token, issued only after
    // OTP verification. Separate secret from the OTP itself (see
    // CHANGELOG, "Reset authorization is not the OTP").
    resetTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null,
    },
    // Set the instant the record is used for anything terminal (password
    // changed, superseded by a newer request, or attempts exhausted) so it
    // can never be used again even if not yet cleaned up by TTL.
    consumedAt: {
      type: Date,
      default: null,
    },
    // Minimal request metadata for audit/rate-limit purposes only — never
    // anything from the email body or the credential itself.
    requestIp: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

// TTL cleanup only — every real check (expiry, attempts, consumption) is
// re-verified at the application layer in the controller regardless of
// whether Mongo has swept the row yet.
passwordResetSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
passwordResetSchema.index({ user: 1, consumedAt: 1 });

const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);

export default PasswordReset;

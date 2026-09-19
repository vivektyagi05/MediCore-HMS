import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { generateToken } from "../utils/generateToken.js";
import { validateLogin, validateRegister } from "../validations/authValidation.js";
import { ROLES } from "../constants/roles.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";
import FeatureToggle from "../models/FeatureToggle.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { LEGAL_DOCUMENTS } from "../../shared/legalDocuments.js";
import { emailService } from "../services/emailService.js";
import { issueEmailVerification, verifyEmailToken, canResendVerification, verificationCooldownMs } from "../services/emailVerificationService.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { logger } from "../utils/logger.js";

const buildAuthResponse = (user) => ({
  user: user.toJSON(),
  token: generateToken(user),
});

// PHASE 2-B — Section 1 bugfix: registration passed the client-supplied
// `doctorProfile` object straight into ensureDoctorProfileForUser(), whose
// overrides also accept `rating`. Since this only ever runs on the doctor's
// very first profile creation ($setOnInsert), a self-registering doctor
// could send `doctorProfile: { rating: 5 }` in the raw API request and get
// a fabricated starting rating with zero real reviews behind it -- the
// frontend registration form never sends this field, so the hole was only
// reachable via a direct API call, but it was live and exploitable exactly
// the way Section 24's "client changes role/userId/doctorId" checks are
// meant to catch. `rating` must only ever be derived from real review
// aggregation (see reviewRating.test.mjs), never client input at signup.
const SELF_REGISTRATION_DOCTOR_PROFILE_FIELDS = ["specialization", "experience", "fees", "availability"];

export const pickSelfRegistrationDoctorProfile = (input) => {
  if (!input || typeof input !== "object") return undefined;
  const picked = {};
  for (const field of SELF_REGISTRATION_DOCTOR_PROFILE_FIELDS) {
    if (input[field] !== undefined) picked[field] = input[field];
  }
  return picked;
};

export const register = asyncHandler(async (req, res) => {
  // Phase A5.3 — Executive Action Center "Pause Registrations" quick action.
  // Reuses the existing generic FeatureToggle store; absent/disabled means
  // registrations proceed as before (no change in default behavior).
  const pauseToggle = await FeatureToggle.findOne({ key: "registrations_paused" }).lean();
  if (pauseToggle?.isEnabled) {
    throw new AppError("New registrations are temporarily paused. Please try again later.", 503);
  }

  const validation = validateRegister(req.body);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const email = req.body.email.toLowerCase().trim();
  const existingUser = await User.findOne({ email }).lean();

  if (existingUser) {
    throw new AppError("Email is already registered", 409);
  }

const user = await User.create({
  name: req.body.name.trim(),
  email,
  password: req.body.password,
  role: req.body.role,
  termsAcceptedAt: new Date(),
  termsVersion: LEGAL_DOCUMENTS.terms.version,
  privacyPolicyVersion: LEGAL_DOCUMENTS.privacy.version,

  doctorOnboardingStatus:
    req.body.role === ROLES.DOCTOR
      ? "not_started"
      : undefined,
  emailVerified: false,
});

  if (user.role === ROLES.DOCTOR) {
    await ensureDoctorProfileForUser(user, pickSelfRegistrationDoctorProfile(req.body.doctorProfile));
  }

  let verificationEmailSent = false;
  try {
    await issueEmailVerification(user);
    verificationEmailSent = true;
  } catch (error) {
    logger.error("Registration verification email failed", {
      event: "registration_verification_email_failed",
      userId: user._id.toString(),
      errorName: error?.name,
      message: error?.message,
    });
  }

  // Persisted + realtime admin notification. Email delivery is independent
  // from registration state and must never roll the account creation back.
  try {
    await notificationEmitter.emitToAdmins({
      type: "user_registered",
      title: "New user registration",
      message: `${user.name} registered a new ${user.role === ROLES.DOCTOR ? "doctor" : "user"} account.`,
      entityType: "User",
      entityId: user._id,
      severity: "info",
      eventKey: `user-registration:${user._id}`,
    });
  } catch (error) {
    logger.warn("New user registration notification failed", {
      message: error?.message,
      userId: user._id.toString(),
    });
  }

  // The existing automation trigger remains unchanged; it is not the
  // notification source of truth for this phase.
  await emitAutomationTrigger(TRIGGER_TYPES.REGISTRATION, {
    userId: user._id,
    role: user.role,
    name: user.name,
  });

  if (user.role !== ROLES.DOCTOR) {
    try {
      await emailService.sendWelcomeEmail({ toEmail: user.email, toName: user.name });
    } catch (error) {
      logger.warn("Registration welcome email failed", {
        message: error?.message,
        userId: user._id.toString(),
      });
    }
  }

  res.status(201).json({
    success: true,
    data: {
      user: user.toJSON(),
      verificationRequired: true,
      verificationEmailSent,
    },
    message: verificationEmailSent
      ? "Account created successfully. Please verify your email before continuing."
      : "Account created successfully, but the verification email could not be sent. Please request a new verification email.",
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await verifyEmailToken(req.body?.token);
  const user = await User.findById(result.user._id).select("-password");

  res.status(200).json({
    success: true,
    data: { user },
    message: result.alreadyVerified
      ? "Email is already verified."
      : "Email verified successfully. You can now log in.",
  });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!email) {
    return res.status(200).json({
      success: true,
      message: "If an account exists, a verification email will be sent.",
    });
  }

  const user = await User.findOne({ email, isActive: true }).select("+emailVerificationTokenHash +emailVerificationExpiresAt +emailVerificationSentAt");
  if (!user || user.emailVerified) {
    return res.status(200).json({
      success: true,
      message: "If an unverified account exists, a verification email will be sent.",
    });
  }

  if (!canResendVerification(user)) {
    const retryAfter = Math.max(
      1,
      Math.ceil((verificationCooldownMs - (Date.now() - new Date(user.emailVerificationSentAt).getTime())) / 1000),
    );
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      message: `Please wait ${retryAfter} seconds before requesting another verification email.`,
    });
  }

  try {
    await issueEmailVerification(user);
  } catch (error) {
    logger.warn("Verification resend failed", {
      event: "email_verification_resend_failed",
      errorName: error?.name,
      message: error?.message,
    });
    // Keep enumeration resistance: the client gets a generic success shape.
  }

  return res.status(200).json({
    success: true,
    message: "If an unverified account exists, a verification email will be sent.",
  });
});

// PHASE 2-A — Part 2 (session restoration). The frontend previously had no
// way to re-verify a cached session against the backend: AuthContext just
// trusted whatever `hms_user` JSON was written to localStorage at the last
// login/register call, forever. That user object goes stale the moment
// anything about the account changes server-side after the token was
// issued — the concrete, reproducible case being a doctor's
// `doctorOnboardingStatus` flipping from "pending" to "approved" once an
// admin approves them: PrivateRoute reads the stale cached status and keeps
// redirecting the now-approved doctor back to /doctor/onboarding on every
// refresh/browser restart until they log out and back in. This endpoint
// gives the frontend a real login -> JWT -> /me -> authenticated-state path:
// `protect` has already verified the token (including the
// securityVersion/isActive checks) and attached the fresh user document, so
// this simply returns it.
export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: { user: req.user.toJSON() },
  });
});

export const login = asyncHandler(async (req, res) => {
  const validation = validateLogin(req.body);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const email = req.body.email.toLowerCase().trim();
  const user = await User.findOne({ email, isActive: true }).select("+password");

  if (!user || !(await user.comparePassword(req.body.password))) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.role !== ROLES.SUPER_ADMIN && !user.emailVerified) {
    throw new AppError("Please verify your email before logging in.", 403);
  }

  if (user.role === ROLES.DOCTOR) {
    await ensureDoctorProfileForUser(user);
  }

  res.status(200).json({
    success: true,
    data: buildAuthResponse(user),
    message: "Login successful",
  });
});

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

const buildAuthResponse = (user) => ({
  user: user.toJSON(),
  token: generateToken(user),
});

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
});

  if (user.role === ROLES.DOCTOR) {
    await ensureDoctorProfileForUser(user, req.body.doctorProfile);
  }

  // Phase A6.2.3 — Automation Studio real trigger.
  await emitAutomationTrigger(TRIGGER_TYPES.REGISTRATION, {
    userId: user._id,
    role: user.role,
    name: user.name,
  });

  res.status(201).json({
    success: true,
    data: buildAuthResponse(user),
    message: "Registration successful",
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

  if (user.role === ROLES.DOCTOR) {
    await ensureDoctorProfileForUser(user);
  }

  res.status(200).json({
    success: true,
    data: buildAuthResponse(user),
    message: "Login successful",
  });
});

import Doctor from "../models/Doctor.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";
import { getVerificationCycleId } from "../utils/verificationCycle.js";
import { logger } from "../utils/logger.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { emailService } from "../services/emailService.js";
import { ROLES } from "../constants/roles.js";
import User from "../models/User.js";
import { applyDoctorMasterData, resolveDoctorMasterData } from "../services/masterDataService.js";
import { canTransitionDoctorVerification, onboardingStatusForUser } from "../services/doctorLifecycleService.js";

// SECURITY BUGFIX: both submitOnboarding and updateOnboarding used
// `Object.assign(doctor, req.body)` with NO field whitelist — a classic mass
// assignment vulnerability. Since Doctor's schema includes verificationStatus,
// isVerified, rating, and verifiedBy as real fields, a doctor could submit
// `{ verificationStatus: "approved", rating: 5, ... }` in their own onboarding
// request and self-approve their account, completely bypassing the admin
// verification workflow — the most severe kind of bug this codebase has, a
// live, exploitable privilege escalation. Only these credential/profile
// fields — the ones an onboarding form legitimately collects — are allowed
// through. Everything else (availability, documents, blockedDates) has its
// own dedicated, more carefully validated endpoint elsewhere and is
// deliberately excluded here too.
const ONBOARDING_EDITABLE_FIELDS = [
  "specialization",
  "specializationMasterId",
  "specializationType",
  "specializationOther",
  "experience",
  "fees",
  "licenseNumber",
  "medicalCouncil",
  "qualification",
  "collegeName",
  "graduationYear",
  "hospitalName",
  "city",
  "cityMasterId",
  "cityType",
  "cityOther",
  "state",
  "stateMasterId",
  "stateType",
  "stateOther",
  "district",
  "districtMasterId",
  "districtType",
  "districtOther",
  "bio",
  "languages",
  "consultationMode",
  "profilePhoto",
];

// Practice Management Platform (Phase D4): these fields are exactly what
// the admin verification workflow actually authenticates. If a doctor
// already approved changes one of these, the old verification no longer
// reflects reality (e.g. a different license number was never reviewed by
// an admin), so it must go back to "pending" rather than silently staying
// "approved" under changed credentials. Fields like bio, fees, or
// consultation mode don't affect what verification checked, so they don't
// trigger re-review.
const CRITICAL_VERIFICATION_FIELDS = ["licenseNumber", "medicalCouncil", "qualification", "collegeName", "graduationYear"];

const pickOnboardingFields = (body) => {
  const picked = {};
  for (const field of ONBOARDING_EDITABLE_FIELDS) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
};

// AUDIT FIX (GLOBAL-FLOW-INTEGRITY-AUDIT-2026-09-25, item ONB-001):
// submitOnboarding previously transitioned verificationStatus straight to
// "pending" for ANY payload, including an entirely empty one. Every
// credential/location field on the Doctor schema is `default: ""` /
// `default: null` rather than `required: true` (specialization is the only
// schema-required field, and it silently falls back to "General Medicine"),
// and this route had no validation middleware at all -- so a doctor could
// submit with zero real information and land in the same "pending" queue an
// admin trusts to mean "ready to review." This function is the single
// backend gate for what "complete enough to submit" means; it is
// intentionally NOT reused by updateOnboarding, since an approved doctor
// must remain able to save incremental edits without hitting an
// onboarding-completeness wall.
const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

const effectiveMasterValue = (doctor, field) => {
  const config = { specialization: "specializationOther", state: "stateOther", district: "districtOther", city: "cityOther" }[field];
  const typeField = `${field}Type`;
  if (doctor[typeField] === "OTHER") return doctor[config];
  return doctor[`${field}MasterId`] || doctor[field];
};

export const getOnboardingMissingRequirements = (doctor) => {
  const missing = [];

  if (isBlank(effectiveMasterValue(doctor, "specialization"))) missing.push("specialization");
  if (isBlank(doctor.licenseNumber)) missing.push("licenseNumber");
  if (isBlank(doctor.medicalCouncil)) missing.push("medicalCouncil");
  if (isBlank(doctor.qualification)) missing.push("qualification");
  if (isBlank(doctor.collegeName)) missing.push("collegeName");
  if (doctor.graduationYear === null || doctor.graduationYear === undefined) missing.push("graduationYear");
  if (isBlank(effectiveMasterValue(doctor, "state"))) missing.push("state");
  if (isBlank(effectiveMasterValue(doctor, "district"))) missing.push("district");
  if (isBlank(effectiveMasterValue(doctor, "city"))) missing.push("city");
  if (!Array.isArray(doctor.documents) || doctor.documents.length === 0) missing.push("documents");

  return missing;
};

export const getMyOnboarding = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({
    userId: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: doctor,
  });
});

export const submitOnboarding = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({
    userId: req.user._id,
  });

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  // Canonical transitions (services/doctorLifecycleService.js):
  // not_submitted|rejected -> pending. A doctor may (re)submit from
  // not_submitted (first-ever submission) or rejected (resubmission); a
  // pending or approved doctor may not, with the specific reason surfaced
  // below so the two 409s stay distinguishable to the frontend.
  if (doctor.verificationStatus === "pending") {
    throw new AppError("Your application is already under review.", 409);
  }

  if (doctor.verificationStatus === "approved") {
    throw new AppError("Your doctor application is already approved.", 409);
  }

  if (!canTransitionDoctorVerification(doctor.verificationStatus, "pending")) {
    throw new AppError("Your application cannot be submitted from its current state.", 409);
  }

  const submittedAt = new Date();
  const updates = pickOnboardingFields(req.body);
  const masterData = await resolveDoctorMasterData(updates, { allowLegacyOther: true });
  Object.assign(doctor, updates);
  applyDoctorMasterData(doctor, masterData);

  // MANDATORY dependency check (see getOnboardingMissingRequirements above).
  // This must run on the merged doctor state -- after master-data resolution,
  // before any lifecycle/status mutation -- so a doctor filling in a
  // previously-missing field on resubmission is judged on their real,
  // current data, not just this request's diff. A failure here stops the
  // flow entirely: no verificationStatus change, no save, no admin
  // notification, no email -- matching the "STOP THE FLOW" business rule
  // rather than creating a partially-submitted "pending" record.
  const missing = getOnboardingMissingRequirements(doctor);
  if (missing.length > 0) {
    throw new AppError(
      `Cannot submit: the following are required before your application can be reviewed: ${missing.join(", ")}.`,
      400,
    );
  }

  doctor.verificationStatus = "pending";
  doctor.isVerified = false;
  doctor.verificationNotes = "";
  doctor.verificationHistory.push({
    status: "pending",
    notes: "Doctor onboarding application submitted.",
    changedBy: req.user._id,
    changedAt: submittedAt,
  });

  await doctor.save();

  await User.findByIdAndUpdate(req.user._id, {
    doctorOnboardingStatus: onboardingStatusForUser(doctor),
    doctorVerification: {
      submittedAt,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: "",
    },
  });

  const adminPayload = {
    type: "doctor_application",
    title: "New doctor verification application",
    message: `${req.user.name} submitted a doctor verification application.`,
    entityType: "Doctor",
    entityId: doctor._id,
    severity: "info",
    eventKey: `doctor-application:${doctor._id}:${getVerificationCycleId(doctor)}`,
    metadata: { doctorUserId: doctor.userId, action: { to: "/admin/doctors" } },
  };

  try {
    await notificationEmitter.emitToRole(ROLES.SUPER_ADMIN, adminPayload);
  } catch (error) {
    logger.warn("Doctor application notification failed", {
      doctorId: doctor._id.toString(),
      message: error?.message,
    });
  }

  try {
    const admins = await User.find({
      role: ROLES.SUPER_ADMIN,
      isActive: true,
    }).select("email name").lean();

    const reviewUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/admin/doctors`;
    await Promise.allSettled(
      admins
        .filter((admin) => admin.email)
        .map((admin) =>
          emailService.sendNewDoctorApplicationAdminNotification({
            toEmail: admin.email,
            toName: admin.name,
            reviewUrl,
          }).catch((error) => {
            logger.warn("Doctor application admin email failed", {
              adminId: admin._id.toString(),
              errorName: error?.name,
              message: error?.message,
            });
          }),
        ),
    );
  } catch (error) {
    logger.warn("Doctor application admin recipient lookup failed", {
      message: error?.message,
    });
  }

  res.status(200).json({
    success: true,
    data: {
      doctor,
      verificationStatus: doctor.verificationStatus,
      submittedAt,
    },
    message: "Application submitted successfully. Your profile is now under review.",
  });
});

// BUGFIX (Phase D4): this previously threw a 400 on any edit once a doctor
// was approved, permanently locking their credential fields forever — a
// doctor could never correct a typo in their qualification or update their
// license number without admin intervention outside the app. That directly
// conflicted with the Professional Profile requirement that a doctor's
// practice details stay editable. The real, narrower requirement is
// re-verification when a *credential* field changes, not a blanket lock —
// implemented below instead of removing the safeguard outright.
export const updateOnboarding = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({
    userId: req.user._id,
  });

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  const updates = pickOnboardingFields(req.body);
  const wasApproved = doctor.verificationStatus === "approved";
  const masterPayload = {
    ...{
      specialization: doctor.specialization,
      specializationMasterId: doctor.specializationMasterId,
      specializationType: doctor.specializationType,
      specializationOther: doctor.specializationOther,
      state: doctor.state,
      stateMasterId: doctor.stateMasterId,
      stateType: doctor.stateType,
      stateOther: doctor.stateOther,
      district: doctor.district,
      districtMasterId: doctor.districtMasterId,
      districtType: doctor.districtType,
      districtOther: doctor.districtOther,
      city: doctor.city,
      cityMasterId: doctor.cityMasterId,
      cityType: doctor.cityType,
      cityOther: doctor.cityOther,
    },
    ...updates,
  };
  const masterData = await resolveDoctorMasterData(masterPayload, { allowLegacyOther: true });
  const changedCriticalField = CRITICAL_VERIFICATION_FIELDS.some(
    (field) => updates[field] !== undefined && String(updates[field]) !== String(doctor[field] ?? ""),
  );

  Object.assign(doctor, updates);
  applyDoctorMasterData(doctor, masterData);

  if (wasApproved && changedCriticalField) {
    doctor.verificationStatus = "pending";
    doctor.isVerified = false;
    doctor.verificationHistory.push({
      status: "pending",
      notes: "Re-submitted for review after a credential field was changed.",
      changedBy: req.user._id,
      changedAt: new Date(),
    });
  }

  await doctor.save();

  if (wasApproved && changedCriticalField) {
    await User.findByIdAndUpdate(req.user._id, { doctorOnboardingStatus: "pending" });
    try {
      await practiceEmitter.verificationStatusChanged({
        doctorUserId: doctor.userId,
        doctorId: doctor._id,
        cycleId: getVerificationCycleId(doctor),
        status: "pending",
        notes: "A credential change requires re-verification by an admin.",
      });
    } catch (error) {
      logger.warn("practiceEmitter.verificationStatusChanged failed", { message: error?.message });
    }
  }

  res.status(200).json({
    success: true,
    data: doctor,
    message: wasApproved && changedCriticalField
      ? "Profile updated. A credential change requires re-verification, so your status is now pending."
      : "Profile updated successfully",
  });
});

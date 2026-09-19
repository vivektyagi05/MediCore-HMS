import Doctor from "../models/Doctor.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";
import { logger } from "../utils/logger.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { emailService } from "../services/emailService.js";
import { ROLES } from "../constants/roles.js";
import User from "../models/User.js";

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
  "experience",
  "fees",
  "licenseNumber",
  "medicalCouncil",
  "qualification",
  "collegeName",
  "graduationYear",
  "hospitalName",
  "city",
  "state",
  "district",
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

  if (doctor.verificationStatus === "pending") {
    throw new AppError("Your application is already under review.", 409);
  }

  if (doctor.verificationStatus === "approved") {
    throw new AppError("Your doctor application is already approved.", 409);
  }

  const submittedAt = new Date();
  Object.assign(doctor, pickOnboardingFields(req.body));
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
    doctorOnboardingStatus: "pending",
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
    eventKey: `doctor-application:${doctor._id}:${submittedAt.getTime()}`,
    metadata: { doctorUserId: doctor.userId },
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
  const changedCriticalField = CRITICAL_VERIFICATION_FIELDS.some(
    (field) => updates[field] !== undefined && String(updates[field]) !== String(doctor[field] ?? ""),
  );

  Object.assign(doctor, updates);

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

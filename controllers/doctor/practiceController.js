// Doctor Practice Management Platform (Phase D4).
//
// Connects Profile Strength, Professional Profile, Verification, Billing,
// and Subscription into one coherent surface, following the exact pattern
// established in Phase D3 (businessOverviewController.js): each concern
// gets its own builder function, reused both by its own dedicated endpoint
// and by the composed overview endpoint below -- nothing is computed twice.
import Doctor from "../../models/Doctor.js";
import fs from "fs";
import path from "path";
import Invoice from "../../models/Invoice.js";
import Subscription from "../../models/Subscription.js";
import Appointment from "../../models/Appointment.js";
import AIDraft from "../../models/AIDraft.js";
import User from "../../models/User.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { logger } from "../../utils/logger.js";
import { practiceEmitter } from "../../realtime/practiceEmitter.js";
import { subscriptionService, getPlanLimits, FREE_PLAN_CODE } from "../../payments/subscriptionService.js";
import { createSubscriptionInvoiceRecord } from "../../services/invoiceService.js";
import { buildDoctorReputationIntelligence } from "../publicController.js";
import { buildDoctorAnalyticsIntelligence } from "./workflowController.js";
import { DOCTOR_CONSULTATION_MODES } from "../../constants/consultationMode.js";
import { assertValidUploadOrDelete } from "../../utils/fileValidation.js";
import { serializeDoctorPublicProfile } from "../../services/doctorPublicSerializer.js";
import { buildDoctorProfileIntelligence } from "../../services/doctorProfileIntelligenceService.js";
import { applyDoctorMasterData, resolveDoctorMasterData } from "../../services/masterDataService.js";

const getDoctor = async (userId) => {
  const doctor = await Doctor.findOne({ userId }).lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  return doctor;
};

// Compliance document types the Verification Center tracks individually
// (Step 4). Matches the Doctor.documents.type enum added in this phase.
const REQUIRED_VERIFICATION_DOC_TYPES = [
  { type: "medical_license", label: "Medical License" },
  { type: "medical_registration", label: "Medical Registration" },
  { type: "degree", label: "Degree Certificate" },
  { type: "government_id", label: "Government ID" },
];

// ────────────────────────────────────────────────────────────────
// Step 2: Profile Intelligence -- Professional Identity Center
// ────────────────────────────────────────────────────────────────
export async function buildProfileIntelligence(doctor) {
  const reputation = await buildDoctorReputationIntelligence(doctor._id);
  return buildDoctorProfileIntelligence(doctor, {
    trustScore: reputation.intelligence.patientTrustScore,
  });
}

export const getProfileIntelligence = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).populate("userId", "name").lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const data = await buildProfileIntelligence(doctor);
  res.status(200).json({ success: true, data, message: "Profile intelligence fetched successfully" });
});

// ────────────────────────────────────────────────────────────────
// Step 3: Professional Profile (education, experience, clinics, etc.)
// ────────────────────────────────────────────────────────────────
// Separate, additive-only whitelist from ONBOARDING_EDITABLE_FIELDS --
// these are practice-detail fields, not verification-relevant credentials,
// so editing them never triggers re-verification (see
// doctorOnboardingController.CRITICAL_VERIFICATION_FIELDS for that list).
const PROFESSIONAL_PROFILE_FIELDS = [
  "specialization", "specializationMasterId", "specializationType", "specializationOther",
  "qualification", "collegeName", "graduationYear",
  "licenseNumber", "medicalCouncil", "hospitalName",
  "city", "cityMasterId", "cityType", "cityOther",
  "state", "stateMasterId", "stateType", "stateOther",
  "district", "districtMasterId", "districtType", "districtOther",
  "bio", "languages",
  "subSpecialties", "education", "experienceEntries", "awards",
  "researchPublications", "memberships", "clinics", "clinicPhotos",
  "emergencyAvailability", "insuranceAccepted",
];
const YEAR_NOW = new Date().getFullYear();

const normalizeClinicMasterData = async (clinics = []) => {
  if (!Array.isArray(clinics)) return clinics;
  return Promise.all(clinics.map(async (clinic) => {
    const resolved = await resolveDoctorMasterData(clinic, { allowLegacyOther: true });
    const next = { ...clinic };
    if (resolved.state) {
      next.state = resolved.state.displayValue;
      next.stateMasterId = resolved.state.masterId;
      next.stateType = resolved.state.type;
      next.stateOther = resolved.state.otherValue || "";
    }
    if (resolved.district) {
      next.district = resolved.district.displayValue;
      next.districtMasterId = resolved.district.masterId;
      next.districtType = resolved.district.type;
      next.districtOther = resolved.district.otherValue || "";
    }
    if (resolved.city) {
      next.city = resolved.city.displayValue;
      next.cityMasterId = resolved.city.masterId;
      next.cityType = resolved.city.type;
      next.cityOther = resolved.city.otherValue || "";
    }
    return next;
  }));
};

const validateProfessionalProfilePayload = (body) => {
  const errors = {};
  const stringFields = {
    specialization: 100, qualification: 200, collegeName: 160, licenseNumber: 100,
    medicalCouncil: 160, hospitalName: 160, city: 100, state: 100, district: 120, bio: 3000,
  };
  for (const [field, max] of Object.entries(stringFields)) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].trim().length > max)) {
      errors[field] = `${field} must be a string of at most ${max} characters`;
    }
  }
  for (const field of ["languages", "subSpecialties", "insuranceAccepted", "education", "experienceEntries", "awards", "researchPublications", "memberships", "clinics"]) {
    if (body[field] !== undefined && !Array.isArray(body[field])) errors[field] = `${field} must be an array`;
  }
  const year = (v, field) => {
    if (v !== "" && v != null && (!Number.isInteger(Number(v)) || Number(v) < 1950 || Number(v) > YEAR_NOW)) errors[field] = `${field} must be a valid year`;
  };
  if (body.graduationYear !== undefined) year(body.graduationYear, "graduationYear");
  const checkRows = (rows, fields) => {
    for (const row of rows || []) {
      for (const field of fields.required) {
        if (typeof row?.[field] !== "string" || !row[field].trim()) errors[fields.name + "." + field] = `${fields.name}.${field} is required`;
      }
      for (const field of fields.years) if (row?.[field] !== undefined) year(row[field], fields.name + "." + field);
    }
  };
  checkRows(body.education, { name: "education", required: ["degree", "institution"], years: ["year"] });
  checkRows(body.experienceEntries, { name: "experienceEntries", required: ["title", "organization"], years: ["startYear", "endYear"] });
  for (const row of body.experienceEntries || []) {
    if (row.endYear != null && row.endYear !== "" && row.startYear != null && Number(row.endYear) < Number(row.startYear)) errors.experienceEntries = "endYear cannot precede startYear";
  }
  checkRows(body.awards, { name: "awards", required: ["title"], years: ["year"] });
  checkRows(body.researchPublications, { name: "researchPublications", required: ["title"], years: ["year"] });
  checkRows(body.memberships, { name: "memberships", required: ["name"], years: ["since"] });
  for (const row of body.clinics || []) {
    if (!row?.name?.trim()) errors.clinics = "Each clinic requires a name";
    if (row?.location?.coordinates !== undefined) {
      const c = row.location.coordinates;
      if (!Array.isArray(c) || c.length !== 2 || Number(c[0]) < -180 || Number(c[0]) > 180 || Number(c[1]) < -90 || Number(c[1]) > 90) errors.clinics = "Clinic coordinates must be [longitude, latitude]";
    }
  }
  return errors;
};

export const getProfessionalProfile = asyncHandler(async (req, res) => {
  const doctor = await getDoctor(req.user._id);
  res.status(200).json({
    success: true,
    data: {
      ...serializeDoctorPublicProfile(doctor, req),
      // profilePhoto intentionally stays canonical/absolute from serializer; raw storage path is never returned to the client.
      specialization: doctor.specialization || "",
      qualification: doctor.qualification || "",
      collegeName: doctor.collegeName || "",
      graduationYear: doctor.graduationYear || null,
      licenseNumber: doctor.licenseNumber || "",
      medicalCouncil: doctor.medicalCouncil || "",
      hospitalName: doctor.hospitalName || "",
      city: doctor.city || "",
      state: doctor.state || "",
      district: doctor.district || "",
      bio: doctor.bio || "",
    },
    message: "Professional profile fetched successfully",
  });
});

export const updateProfessionalProfile = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const unexpected = Object.keys(req.body || {}).filter((key) => !PROFESSIONAL_PROFILE_FIELDS.includes(key));
  if (unexpected.length) throw new AppError(`Unsupported profile field(s): ${unexpected.join(", ")}`, 400);
  const errors = validateProfessionalProfilePayload(req.body);
  if (Object.keys(errors).length) throw new AppError("Profile validation failed", 422, errors);

  const wasApproved = doctor.verificationStatus === "approved";
  const masterPayload = { ...doctor.toObject(), ...req.body };
  const masterData = await resolveDoctorMasterData(masterPayload, { allowLegacyOther: true });
  const normalizedClinics = req.body.clinics !== undefined
    ? await normalizeClinicMasterData(req.body.clinics)
    : undefined;
  const credentialFields = ["licenseNumber", "medicalCouncil", "qualification", "collegeName", "graduationYear"];
  const changedCredential = credentialFields.some((field) =>
    req.body[field] !== undefined && String(req.body[field] ?? "") !== String(doctor[field] ?? ""),
  );
  for (const field of PROFESSIONAL_PROFILE_FIELDS) {
    if (req.body[field] !== undefined) doctor[field] = field === "clinics" ? normalizedClinics : req.body[field];
  }
  applyDoctorMasterData(doctor, masterData);
  if (wasApproved && changedCredential) {
    doctor.verificationStatus = "pending";
    doctor.isVerified = false;
    doctor.verificationHistory.push({
      status: "pending",
      notes: "Credential changed from Professional Profile; re-verification required.",
      changedBy: req.user._id,
      changedAt: new Date(),
    });
    await User.findByIdAndUpdate(req.user._id, { doctorOnboardingStatus: "pending" });
  }
  await doctor.save();
  practiceEmitter.profileCompletionUpdated(doctor.userId, doctor._id, (await buildProfileIntelligence(doctor.toObject())).profileCompletionPercent);
  res.status(200).json({
    success: true,
    data: serializeDoctorPublicProfile(doctor.toObject(), req),
    message: wasApproved && changedCredential ? "Profile updated; credential changes require re-verification." : "Professional profile updated successfully",
  });
});

export const uploadProfilePhoto = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  if (!req.file) throw new AppError("Profile photo is required", 400);
  assertValidUploadOrDelete(req.file);
  const relativePath = `/uploads/doctor-profile/${path.basename(req.file.filename)}`;
  const previous = doctor.profilePhoto;
  doctor.profilePhoto = relativePath;
  await doctor.save();
  if (previous && previous.startsWith("/uploads/doctor-profile/")) {
    fs.unlink(path.resolve(process.cwd(), previous.slice(1)), () => {});
  }
  res.status(200).json({
    success: true,
    data: { profilePhoto: serializeDoctorPublicProfile(doctor.toObject(), req).profilePhoto },
    message: "Profile photo updated successfully",
  });
});

export const deleteProfilePhoto = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const previous = doctor.profilePhoto;
  doctor.profilePhoto = "";
  await doctor.save();
  if (previous?.startsWith("/uploads/doctor-profile/")) fs.unlink(path.resolve(process.cwd(), previous.slice(1)), () => {});
  res.status(200).json({ success: true, data: { profilePhoto: null }, message: "Profile photo removed successfully" });
});

// ────────────────────────────────────────────────────────────────
// Step 4: Verification Center
// ────────────────────────────────────────────────────────────────
export function buildVerificationCenter(doctor) {
  const documents = doctor.documents || [];
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const requiredStatus = REQUIRED_VERIFICATION_DOC_TYPES.map((req) => {
    const doc = documents.find((d) => d.type === req.type);
    return { ...req, uploaded: Boolean(doc), status: doc?.status || "not_uploaded", documentId: doc?._id || null };
  });

  return {
    verificationStatus: doctor.verificationStatus,
    isVerified: doctor.isVerified,
    verificationNotes: doctor.verificationNotes || "",
    verifiedAt: doctor.verifiedAt || null,
    requiredDocuments: requiredStatus,
    allDocuments: documents,
    expiringSoon: documents.filter((d) => d.expiryDate && d.expiryDate <= soon && d.expiryDate >= now),
    expired: documents.filter((d) => d.expiryDate && d.expiryDate < now),
    // Timeline (Step 4): real history of status changes, oldest first.
    timeline: [...(doctor.verificationHistory || [])].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt)),
  };
}

export const getVerificationCenter = asyncHandler(async (req, res) => {
  const doctor = await getDoctor(req.user._id);
  const data = buildVerificationCenter(doctor);
  res.status(200).json({ success: true, data, message: "Verification center fetched successfully" });
});

// ────────────────────────────────────────────────────────────────
// Step 5: Subscription Intelligence + Practice Settings
// ────────────────────────────────────────────────────────────────
export async function buildSubscriptionIntelligence(doctor, userId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const activeSubscription = await Subscription.findOne({ userId, status: { $in: ["active", "past_due"] } })
    .sort({ createdAt: -1 })
    .lean();
  const planCode = activeSubscription?.planCode || FREE_PLAN_CODE;
  const limits = getPlanLimits(planCode);

  // Real usage against the plan's real limits -- every number below comes
  // from an actual count, never estimated.
  const documents = doctor.documents || [];
  const storageUsedBytes = documents.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const storageUsedMB = Number((storageUsedBytes / (1024 * 1024)).toFixed(2));

  const [aiRequestsThisMonth, totalPatients, appointmentsThisMonth, invoices] = await Promise.all([
    AIDraft.countDocuments({ createdBy: userId, scope: "doctor", createdAt: { $gte: startOfMonth } }),
    Appointment.distinct("patientId", { doctorId: doctor._id }).then((ids) => ids.length),
    Appointment.countDocuments({ doctorId: doctor._id, createdAt: { $gte: startOfMonth } }),
    Invoice.find({ doctorId: doctor._id, billingType: "subscription" }).sort({ issuedAt: -1 }).limit(24).lean(),
  ]);

  const usage = {
    aiRequests: { used: aiRequestsThisMonth, limit: limits.maxAIRequestsPerMonth },
    patients: { used: totalPatients, limit: limits.maxPatients },
    appointmentsThisMonth: { used: appointmentsThisMonth, limit: limits.maxAppointmentsPerMonth },
    storageMB: { used: storageUsedMB, limit: limits.maxStorageMB },
  };

  return {
    currentPlan: activeSubscription
      ? { planCode: activeSubscription.planCode, planName: activeSubscription.planName, status: activeSubscription.status, interval: activeSubscription.interval, amount: activeSubscription.amount, currentPeriodEnd: activeSubscription.currentPeriodEnd, nextBillingAt: activeSubscription.nextBillingAt, autoRenew: activeSubscription.autoRenew }
      : { planCode: FREE_PLAN_CODE, planName: "Free", status: "active", interval: null, amount: 0 },
    plans: subscriptionService.getPlans(),
    usage,
    invoices,
    subscriptionId: activeSubscription?._id || null,
  };
}

export const getSubscriptionIntelligence = asyncHandler(async (req, res) => {
  const doctor = await getDoctor(req.user._id);
  const data = await buildSubscriptionIntelligence(doctor, req.user._id);
  res.status(200).json({ success: true, data, message: "Subscription intelligence fetched successfully" });
});

// Upgrade/Downgrade (Step 5): swaps the doctor's active plan and generates a
// real GST invoice for the new plan, same as a fresh subscription would.
export const changeSubscriptionPlan = asyncHandler(async (req, res) => {
  const { planCode } = req.body;
  if (!planCode) throw new AppError("Plan code is required", 400);

  const subscription = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
  if (!subscription) throw new AppError("Subscription not found", 404);

  const { subscription: updated, previousPlanCode } = await subscriptionService.changePlan({
    subscriptionId: subscription._id,
    planCode,
  });

  const doctorUser = await User.findById(req.user._id).select("name email").lean();
  let invoice = null;
  try {
    invoice = await createSubscriptionInvoiceRecord({ subscription: updated, doctorUser });
  } catch (error) {
    logger.warn("createSubscriptionInvoiceRecord failed on plan change", { message: error?.message });
  }

  try {
    await practiceEmitter.subscriptionUpdated({
      doctorUserId: req.user._id,
      subscriptionId: updated._id,
      status: `changed from ${previousPlanCode} to ${planCode}`,
      planName: updated.planName,
    });
    if (invoice) {
      await practiceEmitter.invoiceGenerated({
        doctorUserId: req.user._id,
        invoiceId: invoice._id,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
      });
    }
  } catch (error) {
    logger.warn("practiceEmitter failed on plan change", { message: error?.message });
  }

  res.status(200).json({
    success: true,
    data: { subscription: updated, invoice },
    message: `Plan changed from ${previousPlanCode} to ${planCode} successfully`,
  });
});

// Practice Settings: multi-clinic + telemedicine + emergency availability
// live on the Doctor document already (Professional Profile fields above);
// this endpoint additionally covers consultationMode (telemedicine toggle)
// which existed pre-D4 but had no dedicated settings surface.
const PRACTICE_SETTINGS_FIELDS = ["consultationMode", "emergencyAvailability", "insuranceAccepted", "clinics"];

export const updatePracticeSettings = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });
  if (!doctor) throw new AppError("Doctor profile not found", 404);

  // Consultation Mode Contract (Appointment Regression Repair): this field
  // had no validation at all — any value the client sent (including a
  // single non-array string) was written straight onto the Doctor
  // document. Patient booking, public discovery, and appointment creation
  // all trust Doctor.consultationMode as their source of truth for what a
  // doctor actually offers, so an unvalidated write here could silently
  // make every downstream consumer wrong. See
  // backend/constants/consultationMode.js for the full contract.
  if (req.body.consultationMode !== undefined) {
    const modes = req.body.consultationMode;
    if (!Array.isArray(modes) || modes.length === 0 || modes.some((m) => !DOCTOR_CONSULTATION_MODES.includes(m))) {
      throw new AppError(
        `consultationMode must be a non-empty array containing only: ${DOCTOR_CONSULTATION_MODES.join(", ")}`,
        400,
      );
    }
  }

  for (const field of PRACTICE_SETTINGS_FIELDS) {
    if (req.body[field] !== undefined) doctor[field] = req.body[field];
  }
  await doctor.save();

  res.status(200).json({ success: true, data: doctor, message: "Practice settings updated successfully" });
});

// ────────────────────────────────────────────────────────────────
// Step 6: Practice Analytics
// ────────────────────────────────────────────────────────────────
export async function buildPracticeAnalytics(doctor) {
  const [reputation, analytics] = await Promise.all([
    buildDoctorReputationIntelligence(doctor._id),
    buildDoctorAnalyticsIntelligence(doctor),
  ]);

  const profileVisits = doctor.profileViews || 0;
  const totalAppointments = analytics.appointmentFunnel.requested;
  // Appointment Conversion: real appointments booked as a share of real
  // profile visits. Null (not 0%) when there's no view data yet, so the UI
  // can show "not enough data" instead of a misleading 0%.
  const appointmentConversionRate = profileVisits > 0 ? Number(((totalAppointments / profileVisits) * 100).toFixed(1)) : null;

  // Growth Score: a transparent weighted composite of real, already-computed
  // metrics -- documented here, not a black box. Same methodology already
  // used for businessReputationScore/patientTrustScore in Phase D3.
  const normalizedGrowthForecast = Math.min(Math.max(analytics.growthForecast, -100), 100);
  const growthScore = Number(
    (
      ((normalizedGrowthForecast + 100) / 200) * 30 +
      (reputation.intelligence.repeatPatientRate / 100) * 40 +
      (reputation.intelligence.patientTrustScore / 100) * 30
    ).toFixed(1),
  );

  return {
    profileVisits,
    appointmentConversionRate,
    patientAcquisition: {
      newPatientsThisMonth: analytics.patientFunnel.newPatients,
      returningPatientsThisMonth: analytics.patientFunnel.returningPatients,
    },
    searchVisibility: {
      isDiscoverable: Boolean(doctor.isVerified && doctor.verificationStatus === "approved" && doctor.isActive),
      profileVisits,
    },
    repeatPatients: {
      count: reputation.overview.repeatPatients,
      rate: reputation.intelligence.repeatPatientRate,
    },
    growthScore,
    growthForecastPercent: analytics.growthForecast,
  };
}

export const getPracticeAnalytics = asyncHandler(async (req, res) => {
  const doctor = await getDoctor(req.user._id);
  const data = await buildPracticeAnalytics(doctor);
  res.status(200).json({ success: true, data, message: "Practice analytics fetched successfully" });
});

// ────────────────────────────────────────────────────────────────
// Composed hub (Steps 1-6): one connected Practice Management Platform,
// mirroring the businessOverviewController.js pattern from Phase D3.
// ────────────────────────────────────────────────────────────────
export const getPracticeOverview = asyncHandler(async (req, res) => {
  const doctor = await getDoctor(req.user._id);

  const [profileIntelligence, subscriptionIntelligence, practiceAnalytics] = await Promise.all([
    buildProfileIntelligence(doctor),
    buildSubscriptionIntelligence(doctor, req.user._id),
    buildPracticeAnalytics(doctor),
  ]);
  const verificationCenter = buildVerificationCenter(doctor);

  res.status(200).json({
    success: true,
    data: {
      profile: {
        specialization: doctor.specialization,
        hospitalName: doctor.hospitalName,
        city: doctor.city,
        state: doctor.state,
        profilePhoto: doctor.profilePhoto,
      },
      profileIntelligence,
      verificationCenter,
      subscriptionIntelligence,
      practiceAnalytics,
    },
    message: "Practice overview fetched successfully",
  });
});

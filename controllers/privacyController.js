import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../models/User.js";
import PrivacyPreference from "../models/PrivacyPreference.js";
import ConsentRecord from "../models/ConsentRecord.js";
import PrivacyRequest, {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
} from "../models/PrivacyRequest.js";
import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";
import Review from "../models/Review.js";
import Insurance from "../models/Insurance.js";
import MedicalReport from "../models/MedicalReport.js";
import Prescription from "../models/Prescription.js";
import MedicalNote from "../models/MedicalNote.js";
import ConsultationHistory from "../models/ConsultationHistory.js";
import FamilyMember from "../models/FamilyMember.js";
import SavedDoctor from "../models/SavedDoctor.js";
import Wallet from "../models/Wallet.js";
import TransactionLedger from "../models/TransactionLedger.js";
import SymptomSession from "../models/SymptomSession.js";
import Certificate from "../models/Certificate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { logger } from "../utils/logger.js";
import { CURRENT_PRIVACY_POLICY_VERSION, CURRENT_CONSENT_VERSION, LEGAL_DOCUMENTS } from "../../shared/legalDocuments.js";
import { env } from "../config/env.js";

const OPTIONAL_CATEGORIES = Object.freeze({
  analytics: false,
  personalization: false,
  communications: false,
});

const safeId = (value) => (value ? String(value) : null);
const mapAppointment = (doc) => {
  const value = doc.toObject ? doc.toObject() : doc;
  return {
    id: safeId(value._id),
    doctorId: safeId(value.doctorId),
    date: value.date,
    timeSlot: value.timeSlot,
    status: value.status,
    consultationMode: value.consultationMode,
    reason: value.reason,
    symptoms: value.symptoms,
    symptomDuration: value.symptomDuration,
    painLevel: value.painLevel,
    hasPreviousConsultation: value.hasPreviousConsultation,
    existingConditions: value.existingConditions,
    currentMedications: value.currentMedications,
    allergies: value.allergies,
    preferredLanguage: value.preferredLanguage,
    specialAssistance: value.specialAssistance,
    emergencyContact: value.emergencyContact,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const mapPayment = (doc) => {
  const value = doc.toObject ? doc.toObject() : doc;
  return {
    id: safeId(value._id),
    appointmentId: safeId(value.appointmentId),
    doctorId: safeId(value.doctorId),
    invoiceId: safeId(value.invoiceId),
    amount: value.amount,
    discountAmount: value.discountAmount,
    taxAmount: value.taxAmount,
    totalAmount: value.totalAmount,
    gatewayAmount: value.gatewayAmount,
    walletAmount: value.walletAmount,
    currency: value.currency,
    status: value.status,
    gateway: value.gateway,
    razorpayOrderId: value.razorpayOrderId,
    paymentId: value.paymentId,
    refundStatus: value.refundStatus,
    refundedAmount: value.refundedAmount,
    paidAt: value.paidAt,
    failedAt: value.failedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const mapReview = (doc) => {
  const value = doc.toObject ? doc.toObject() : doc;
  return {
    id: safeId(value._id),
    doctorId: safeId(value.doctorId),
    appointmentId: safeId(value.appointmentId),
    rating: value.rating,
    comment: value.comment,
    isEdited: value.isEdited,
    isPinned: value.isPinned,
    doctorReply: value.doctorReply,
    adminDeleted: value.adminDeleted,
    adminDeletedAt: value.adminDeletedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const pickFields = (value, fields) => {
  const source = value?.toObject ? value.toObject() : value;
  if (!source || typeof source !== "object") return null;
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]]),
  );
};

const mapUserExport = (user) => {
  const value = user?.toObject ? user.toObject() : user;
  return value ? {
    id: safeId(value._id),
    name: value.name,
    email: value.email,
    role: value.role,
    isActive: value.isActive,
    patientProfile: value.patientProfile || undefined,
    doctorOnboardingStatus: value.doctorOnboardingStatus,
    termsAcceptedAt: value.termsAcceptedAt,
    termsVersion: value.termsVersion,
    privacyPolicyVersion: value.privacyPolicyVersion,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  } : null;
};

const mapInsuranceExport = (doc) => pickFields(doc, [
  "_id", "familyMemberId", "provider", "policyNumber", "policyHolder",
  "validTill", "coverageAmount", "claimStatus", "claimAmount", "claimNotes",
  "claimHistory", "createdAt", "updatedAt",
]);

const mapMedicalReportExport = (doc) => pickFields(doc, [
  "_id", "familyMemberId", "doctorId", "appointmentId", "isPinned",
  "severity", "reviewedAt", "title", "category", "reportDate", "notes",
  "tags", "fileName", "mimeType", "size", "createdAt", "updatedAt",
]);

const mapPrescriptionExport = (doc) => pickFields(doc, [
  "_id", "doctorId", "appointmentId", "diagnosis", "medicines", "notes",
  "followUpDate", "followUpScheduledAppointmentId", "followUpCancelledAt",
  "status", "createdAt", "updatedAt",
]);

const mapMedicalNoteExport = (doc) => {
  const value = pickFields(doc, [
    "_id", "doctorId", "appointmentId", "symptoms", "notes",
    "recommendations", "attachments", "createdAt", "updatedAt",
  ]);
  if (!value) return null;
  value.attachments = Array.isArray(value.attachments)
    ? value.attachments.map((item) => pickFields(item, ["_id", "title", "uploadedAt"]))
    : [];
  return value;
};

const mapConsultationHistoryExport = (doc) => {
  const value = pickFields(doc, [
    "_id", "doctorId", "appointmentId", "prescriptionIds", "noteIds",
    "refundIds", "paymentId", "uploadedReports", "summary", "createdAt", "updatedAt",
  ]);
  if (!value) return null;
  value.uploadedReports = Array.isArray(value.uploadedReports)
    ? value.uploadedReports.map((item) => pickFields(item, ["_id", "title", "uploadedAt"]))
    : [];
  return value;
};

const mapFamilyMemberExport = (doc) => pickFields(doc, [
  "_id", "name", "relation", "age", "gender", "bloodGroup",
  "medicalConditions", "emergencyContact", "isActive", "createdAt", "updatedAt",
]);

const mapSavedDoctorExport = (doc) => pickFields(doc, [
  "_id", "doctorId", "isPrimaryPhysician", "createdAt", "updatedAt",
]);

const mapWalletExport = (doc) => {
  const value = doc?.toObject ? doc.toObject() : doc;
  if (!value) return null;
  return {
    id: safeId(value._id),
    balance: value.balance,
    currency: value.currency,
    transactions: Array.isArray(value.transactions)
      ? value.transactions.map((item) => pickFields(item, [
          "_id", "type", "amount", "currency", "status", "referenceType",
          "description", "createdAt",
        ]))
      : [],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const mapLedgerExport = (doc) => pickFields(doc, [
  "_id", "type", "direction", "amount", "currency", "status", "referenceId",
  "createdAt", "updatedAt",
]);

const mapSymptomSessionExport = (doc) => pickFields(doc, [
  "_id", "symptoms", "duration", "severity", "urgency",
  "suggestedDepartments", "recommendedSpecialists", "safetyFlags",
  "disclaimerAccepted", "recommendationText", "createdAt", "updatedAt",
]);

const mapCertificateExport = (doc) => pickFields(doc, [
  "_id", "doctorId", "appointmentId", "type", "title", "content", "status",
  "revokedReason", "createdAt", "updatedAt",
]);

const mapPrivacyPreferenceExport = (doc) => pickFields(doc, [
  "_id", "analytics", "personalization", "communications",
  "policyVersion", "consentVersion", "updatedAt", "createdAt",
]);

const mapPrivacyRequestExport = (doc) => pickFields(doc, [
  "_id", "requestType", "status", "description", "requestedAt",
  "verifiedAt", "resolvedAt", "policyVersion", "consentVersion",
  "source", "resolutionNote", "createdAt", "updatedAt",
]);

const createAudit = (req) => ({
  createdIp: typeof req.ip === "string" ? req.ip.slice(0, 100) : undefined,
});

const getPreferences = async (userId) => {
  const preference = await PrivacyPreference.findOne({ user: userId }).lean();
  return {
    essential: true,
    analytics: preference?.analytics ?? OPTIONAL_CATEGORIES.analytics,
    personalization: preference?.personalization ?? OPTIONAL_CATEGORIES.personalization,
    communications: preference?.communications ?? OPTIONAL_CATEGORIES.communications,
    optionalCategoriesImplemented: Object.entries(OPTIONAL_CATEGORIES)
      .filter(([, implemented]) => implemented)
      .map(([key]) => key),
    policyVersion: preference?.policyVersion || CURRENT_PRIVACY_POLICY_VERSION,
    consentVersion: preference?.consentVersion || CURRENT_CONSENT_VERSION,
    updatedAt: preference?.updatedAt || null,
  };
};

export const getPublicPrivacyConfig = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      documents: LEGAL_DOCUMENTS,
      privacyContactConfigured: Boolean(env.privacyContactEmail),
      grievanceContactConfigured: Boolean(env.grievanceContactEmail),
      legalContactConfigured: Boolean(env.legalContactEmail),
      privacyContactEmail: env.privacyContactEmail || null,
      grievanceContactEmail: env.grievanceContactEmail || null,
      legalContactEmail: env.legalContactEmail || null,
    },
    message: "Privacy configuration loaded",
  });
});

export const getPrivacyPreferences = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await getPreferences(req.user._id),
    message: "Privacy preferences loaded",
  });
});

export const updatePrivacyPreferences = asyncHandler(async (req, res) => {
  const allowed = ["analytics", "personalization", "communications"];
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const provided = Object.keys(body);
  const invalid = provided.filter((key) => !allowed.includes(key));
  if (invalid.length) throw new AppError("Unsupported privacy preference", 400, { field: invalid[0] });

  const unsupported = provided.filter((key) => !OPTIONAL_CATEGORIES[key]);
  if (unsupported.length) {
    throw new AppError("That optional preference is not currently available in MediCore", 400, { field: unsupported[0] });
  }

  for (const key of provided) {
    if (typeof body[key] !== "boolean") {
      throw new AppError("Privacy preference values must be boolean", 400, { field: key });
    }
  }

  if (provided.length === 0) {
    throw new AppError("No supported optional privacy preference was supplied", 400);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const existing = await PrivacyPreference.findOne({ user: req.user._id }).session(session);
      const previous = existing
        ? {
            analytics: existing.analytics,
            personalization: existing.personalization,
            communications: existing.communications,
          }
        : { ...OPTIONAL_CATEGORIES };

      const next = {
        ...previous,
        ...body,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        consentVersion: CURRENT_CONSENT_VERSION,
      };

      await PrivacyPreference.findOneAndUpdate(
        { user: req.user._id },
        {
          $set: {
            analytics: next.analytics,
            personalization: next.personalization,
            communications: next.communications,
            policyVersion: next.policyVersion,
            consentVersion: next.consentVersion,
            updatedAt: new Date(),
          },
          $setOnInsert: { user: req.user._id },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
      );

      for (const category of Object.keys(OPTIONAL_CATEGORIES)) {
        if (previous[category] !== next[category]) {
          const now = new Date();
          await ConsentRecord.create([{
            user: req.user._id,
            consentCategory: category,
            granted: next[category],
            previousGranted: previous[category],
            policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
            consentVersion: CURRENT_CONSENT_VERSION,
            timestamp: now,
            source: "privacy_preferences",
            ...(next[category] === false && previous[category] === true
              ? { withdrawalTimestamp: now }
              : {}),
          }], { session });
        }
      }
    });
  } catch (error) {
    if (error?.code === 20 || /Transaction numbers are only allowed|replica set|transaction/i.test(error?.message || "")) {
      throw new AppError("Privacy preference updates are temporarily unavailable because the database does not support transactional updates.", 503);
    }
    throw error;
  } finally {
    await session.endSession();
  }

  res.status(200).json({
    success: true,
    data: await getPreferences(req.user._id),
    message: "Privacy preferences saved",
  });
});

const requestTypeSet = new Set(Object.values(PRIVACY_REQUEST_TYPES));

export const createPrivacyRequest = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const allowedFields = new Set(["requestType", "description", "currentPassword"]);
  const unexpectedField = Object.keys(body).find((key) => !allowedFields.has(key));
  if (unexpectedField) throw new AppError("Unexpected privacy request field", 400, { field: unexpectedField });

  const { requestType, description = "" } = body;
  if (!requestType || !requestTypeSet.has(requestType)) {
    throw new AppError("A valid privacy request type is required", 400, { requestType: "Unsupported request type" });
  }
  if (typeof description !== "string" || description.trim().length > 4000) {
    throw new AppError("Request description is invalid", 400, { description: "Maximum 4000 characters" });
  }

  if (requestType === PRIVACY_REQUEST_TYPES.DELETION) {
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!currentPassword) throw new AppError("Current password is required for a deletion request", 400, { currentPassword: "Required" });
    const user = await User.findById(req.user._id).select("+password");
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      throw new AppError("Current password is incorrect", 401);
    }
  }

  if (requestType !== PRIVACY_REQUEST_TYPES.DELETION && body.currentPassword !== undefined) {
    throw new AppError("Current password is only accepted for deletion requests", 400, { currentPassword: "Unexpected field" });
  }

  const duplicateWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const duplicate = await PrivacyRequest.findOne({
    user: req.user._id,
    requestType,
    status: { $in: [PRIVACY_REQUEST_STATUSES.PENDING, PRIVACY_REQUEST_STATUSES.IN_REVIEW] },
    createdAt: { $gte: duplicateWindow },
  }).lean();
  if (duplicate) {
    throw new AppError("A similar privacy request is already in progress", 409);
  }

  const request = await PrivacyRequest.create({
    user: req.user._id,
    requestType,
    description: description.trim(),
    requestedAt: new Date(),
    verifiedAt: new Date(),
    policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
    consentVersion: CURRENT_CONSENT_VERSION,
    source: "authenticated",
    audit: createAudit(req),
  });

  logger.info("Privacy request created", {
    requestId: safeId(request._id),
    requestType,
    userId: safeId(req.user._id),
  });

  res.status(201).json({
    success: true,
    data: {
      id: safeId(request._id),
      requestType: request.requestType,
      status: request.status,
      requestedAt: request.requestedAt,
      policyVersion: request.policyVersion,
    },
    message: "Privacy request submitted",
  });
});

export const getPrivacyRequests = asyncHandler(async (req, res) => {
  const requests = await PrivacyRequest.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .select("-audit.createdIp -audit.resolvedBy")
    .lean();
  res.status(200).json({
    success: true,
    data: requests.map((request) => ({
      id: safeId(request._id),
      requestType: request.requestType,
      status: request.status,
      description: request.description,
      requestedAt: request.requestedAt,
      verifiedAt: request.verifiedAt,
      resolvedAt: request.resolvedAt,
      policyVersion: request.policyVersion,
      consentVersion: request.consentVersion,
    })),
    message: "Privacy requests loaded",
  });
});

export const exportPrivacyData = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const [
    user,
    appointments,
    payments,
    reviews,
    insurance,
    medicalReports,
    prescriptions,
    medicalNotes,
    consultationHistory,
    familyMembers,
    savedDoctors,
    wallet,
    ledger,
    symptomSessions,
    certificates,
    preferences,
    requests,
  ] = await Promise.all([
    User.findById(userId).select("-password -securityVersion").lean(),
    Appointment.find({ patientId: userId }).lean(),
    Payment.find({ userId }).lean(),
    Review.find({ userId }).lean(),
    Insurance.find({ userId }).lean(),
    MedicalReport.find({ userId }).lean(),
    Prescription.find({ patientId: userId }).lean(),
    MedicalNote.find({ patientId: userId }).lean(),
    ConsultationHistory.find({ patientId: userId }).lean(),
    FamilyMember.find({ userId }).lean(),
    SavedDoctor.find({ userId }).lean(),
    Wallet.findOne({ userId }).lean(),
    TransactionLedger.find({ userId }).lean(),
    SymptomSession.find({ userId }).lean(),
    Certificate.find({ patientId: userId }).lean(),
    PrivacyPreference.findOne({ user: userId }).lean(),
    PrivacyRequest.find({ user: userId }).select("-audit.createdIp -audit.resolvedBy").lean(),
  ]);

  if (!user) throw new AppError("Authenticated user no longer exists", 401);

  const exportPayload = {
    exportVersion: "1.0",
    generatedAt: new Date().toISOString(),
    scope: "Authenticated account data held directly against this account. Conversations involving other users and internal operational logs are excluded to avoid exposing another person's information.",
    account: mapUserExport(user),
    privacy: {
      preferences: preferences ? mapPrivacyPreferenceExport(preferences) : await getPreferences(userId),
      requests: requests.map(mapPrivacyRequestExport),
      currentPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      currentConsentVersion: CURRENT_CONSENT_VERSION,
    },
    appointments: appointments.map(mapAppointment),
    payments: payments.map(mapPayment),
    reviews: reviews.map(mapReview),
    insurance: insurance.map(mapInsuranceExport),
    medicalReports: medicalReports.map(mapMedicalReportExport),
    prescriptions: prescriptions.map(mapPrescriptionExport),
    medicalNotes: medicalNotes.map(mapMedicalNoteExport),
    consultationHistory: consultationHistory.map(mapConsultationHistoryExport),
    familyMembers: familyMembers.map(mapFamilyMemberExport),
    savedDoctors: savedDoctors.map(mapSavedDoctorExport),
    wallet: mapWalletExport(wallet),
    transactionLedger: ledger.map(mapLedgerExport),
    symptomSessions: symptomSessions.map(mapSymptomSessionExport),
    certificates: certificates.map(mapCertificateExport),
  };

  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="medicore-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
  });
  res.status(200).json({ success: true, data: exportPayload, message: "Your account data export is ready" });
});

export const createPublicGrievance = asyncHandler(async (req, res) => {
  const { email, description = "" } = req.body || {};
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AppError("A valid email address is required", 400, { email: "Enter a valid email address" });
  }
  if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 4000) {
    throw new AppError("Please provide a grievance or privacy request between 10 and 4000 characters", 400, { description: "10–4000 characters required" });
  }

  const request = await PrivacyRequest.create({
    requesterEmail: email.trim().toLowerCase(),
    requestType: PRIVACY_REQUEST_TYPES.GRIEVANCE,
    description: description.trim(),
    policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
    consentVersion: CURRENT_CONSENT_VERSION,
    source: "public_grievance",
    audit: createAudit(req),
  });

  logger.info("Public privacy grievance created", {
    requestId: safeId(request._id),
    requestType: request.requestType,
  });

  res.status(201).json({
    success: true,
    data: { id: safeId(request._id), status: request.status, requestedAt: request.requestedAt },
    message: "Privacy grievance received",
  });
});

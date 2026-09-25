import fs from "fs";
import PDFDocument from "pdfkit";
import { assertValidUploadOrDelete } from "../../utils/fileValidation.js";
import { logger } from "../../utils/logger.js";
import Appointment from "../../models/Appointment.js";
import Certificate from "../../models/Certificate.js";
import Doctor from "../../models/Doctor.js";
import FamilyMember from "../../models/FamilyMember.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import Payment from "../../models/Payment.js";
import Prescription from "../../models/Prescription.js";
import Review from "../../models/Review.js";
import SavedDoctor from "../../models/SavedDoctor.js";
import User from "../../models/User.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { downloadFile } from "../../utils/fileDownload.js";
import { pickFamilyMemberFields } from "../../utils/familyMemberFields.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";
import {
  ACTIVE_STATUSES,
  APPOINTMENT_STATUS,
  PAYMENT_STATUS,
} from "../../constants/appointmentStatus.js";
import { notificationEmitter } from "../../realtime/notificationEmitter.js";
import { clinicalEmitter } from "../../realtime/clinicalEmitter.js";
import { emitAutomationTrigger } from "../../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../../automation-studio/triggerRegistry.js";

const ownership = (req) => ({ userId: req.user._id });

const assertOwnedReport = async (req, id) => {
  const report = await MedicalReport.findOne({ _id: id, ...ownership(req) }).lean();
  if (!report) throw new AppError("Report not found", 404);
  return report;
};

// Shared by every family-scoped endpoint (reports/insurance/timeline linkage)
// so a patient can never read or attach data to a dependent they don't own.
const assertOwnedFamilyMember = async (req, familyMemberId) => {
  if (!familyMemberId) return null;
  const familyMember = await FamilyMember.findOne({ _id: familyMemberId, ...ownership(req), isActive: true }).lean();
  if (!familyMember) throw new AppError("Family member not found", 404);
  return familyMember;
};



export const listReports = asyncHandler(async (req, res) => {
  const filter = { ...ownership(req) };
  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.doctorId) filter.doctorId = req.query.doctorId;
  if (req.query.familyMemberId) filter.familyMemberId = req.query.familyMemberId;
  if (req.query.tag) filter.tags = req.query.tag;
  if (req.query.pinned === "true") filter.isPinned = true;
  if (req.query.from || req.query.to) {
    filter.reportDate = {};
    if (req.query.from) filter.reportDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.reportDate.$lte = new Date(req.query.to);
  }

  // FIX (PHASE P9 gap closure): this previously silently capped a patient's
  // own reports at 100 with no way to reach anything past that — for a page
  // whose own UI copy promises a "lifelong digital health file", that's a
  // real, growing data-loss risk, not just a display inconvenience. Real
  // server-side pagination now, matching the same clampPagination/
  // buildPaginationMeta convention doctorReviewController and every admin
  // list endpoint already use — total count and the requested page both
  // come from the database, never from an in-memory slice of a fetched-in-
  // full array, so this scales correctly regardless of how many reports a
  // patient accumulates over a lifetime.
  const total = await MedicalReport.countDocuments(filter);
  const { page, pageSize, skip } = clampPagination(req.query.page, req.query.limit, { total });

  const reports = await MedicalReport.find(filter)
    .populate("doctorId", "specialization userId")
    .populate("familyMemberId", "name relation")
    .populate("appointmentId", "date timeSlot status paymentId invoiceId")
    .sort({ isPinned: -1, reportDate: -1 })
    .skip(skip)
    .limit(pageSize)
    .lean();

  res.status(200).json({
    success: true,
    data: { reports, pagination: buildPaginationMeta(page, pageSize, total) },
    message: "Reports fetched successfully",
  });
});

// FIX (PHASE P9 gap closure): the category filter dropdown used to derive
// its option list from whatever reports happened to already be loaded in
// the browser — harmless while listReports fetched up to 100 at once, but
// now that listReports is properly paginated, that would silently shrink
// the dropdown to only the categories present on the current page. This is
// a real, tiny, DB-level distinct() over the patient's own reports — same
// ownership scope as every other report endpoint, never a second category
// taxonomy invented on top of the free-text `category` field that already
// exists.
export const getReportCategories = asyncHandler(async (req, res) => {
  const categories = await MedicalReport.distinct("category", ownership(req));
  res.status(200).json({ success: true, data: { categories: categories.filter(Boolean).sort() }, message: "Report categories fetched successfully" });
});

// A report is SHARED with a doctor only through an explicit tag the patient
// chose (doctor and/or appointment). The tag is validated so a patient can
// neither target a doctor who does not exist / is not approved, nor point at
// somebody else's appointment, and cannot spam arbitrary doctors with
// "critical report" notifications. See services/clinicalAccessService.js for
// how the tag is later honoured.
const resolveReportSharingTags = async (req) => {
  const { doctorId, appointmentId } = req.body;
  const isObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value));

  if (appointmentId) {
    if (!isObjectId(appointmentId)) throw new AppError("Invalid appointment", 400);
    const appointment = await Appointment.findOne({ _id: appointmentId, patientId: req.user._id }).select("doctorId status").lean();
    if (!appointment || appointment.status === "cancelled") throw new AppError("Appointment not found", 404);
    if (doctorId && String(doctorId) !== String(appointment.doctorId)) {
      throw new AppError("The selected doctor does not match this appointment", 400);
    }
    return { doctorId: appointment.doctorId, appointmentId: appointment._id };
  }

  if (doctorId) {
    if (!isObjectId(doctorId)) throw new AppError("Invalid doctor", 400);
    const doctor = await Doctor.findOne({ _id: doctorId, verificationStatus: "approved", isVerified: true, isActive: { $ne: false } }).select("_id").lean();
    if (!doctor) throw new AppError("Doctor not found", 404);
    return { doctorId: doctor._id, appointmentId: undefined };
  }

  return { doctorId: undefined, appointmentId: undefined };
};

export const uploadReport = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("Report file is required", 400);
  assertValidUploadOrDelete(req.file);
  // Everything that can reject the request is validated BEFORE the report is
  // created, and the already-stored upload is removed on any rejection so a
  // failed request never leaves an orphan file behind.
  let sharing;
  try {
    if (!req.body.title || !req.body.category || !req.body.reportDate) throw new AppError("Title, category, and report date are required", 400);
    if (req.body.familyMemberId) await assertOwnedFamilyMember(req, req.body.familyMemberId);
    sharing = await resolveReportSharingTags(req);
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    throw error;
  }
  const severity = ["normal", "urgent", "critical"].includes(req.body.severity) ? req.body.severity : "normal";
  const report = await MedicalReport.create({
    userId: req.user._id,
    familyMemberId: req.body.familyMemberId || undefined,
    doctorId: sharing.doctorId,
    appointmentId: sharing.appointmentId,
    title: req.body.title,
    category: req.body.category,
    reportDate: new Date(req.body.reportDate),
    notes: req.body.notes || "",
    tags: req.body.tags ? req.body.tags.split(",").map((item) => item.trim()).filter(Boolean) : [],
    severity,
    fileName: req.file.originalname,
    filePath: req.file.path,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });

  // FIX (PHASE P9 audit): clinicalEmitter.reportUploaded() has existed since
  // Phase D2 but was never called from anywhere — now wired for parity with
  // its sibling emitters (reportReviewed/scheduleUpdated), which fire the
  // same raw io.to(doctorRoom).emit(...) shape. IMPORTANT — audited during
  // this same pass: the frontend's RealtimeContext only listens for a fixed
  // SOCKET_EVENTS set (dashboard:sync, notification:new, appointment:*,
  // payment:*, presence/chat) — it has no listener for "report:uploaded",
  // nor for its siblings "report:reviewed"/"schedule:updated"/
  // "prescription:created"/"certificate:created"/"document:verified". So
  // this call is correctly wired but does NOT yet deliver a live-tab UX
  // effect; it is dormant at the transport layer, exactly like its existing
  // siblings already were before this fix. Making it emit is still correct
  // (it costs nothing, and starts working automatically once someone wires
  // a generic listener), but the doctor's REAL, working attention path for
  // this severity remains the critical/urgent notificationEmitter block
  // below (persisted + polled via the notification bell) and, for every
  // severity including normal, the Command Center's pendingReports data
  // polled on Dashboard load. Cross-cutting "wire a generic dashboard-sync
  // listener for all clinicalEmitter raw events" is a real gap but spans
  // appointments/prescriptions/certificates/schedule too — out of P9's
  // (Documents) scope; documented here as DEFERRED, not silently dropped.
  if (report.doctorId) {
    try {
      clinicalEmitter.reportUploaded(report.doctorId, req.user._id, report);
    } catch (error) {
      logger.warn("reportUploaded realtime emit failed", { message: error?.message });
    }
  }

  // Phase D5 automation (Step 4): a critical/urgent report uploaded against a
  // named doctor gets a priority realtime notification immediately, instead
  // of waiting for the doctor to happen to check the patient's file. Reuses
  // the existing notificationEmitter/NotificationDelivery pipeline only.
  if (report.doctorId && (severity === "critical" || severity === "urgent")) {
    try {
      const doctorDoc = await Doctor.findById(report.doctorId).populate("userId", "_id").lean();
      if (doctorDoc?.userId?._id) {
        await notificationEmitter.emitToUser(doctorDoc.userId._id, {
          type: "report",
          title: severity === "critical" ? "Critical report uploaded" : "Urgent report uploaded",
          message: `A patient uploaded a report marked ${severity} for review: "${report.title}".`,
          entityType: "report",
          entityId: report._id,
          severity: severity === "critical" ? "critical" : "warning",
          eventKey: `report:${severity}:${report._id}`,
        });
      }
    } catch (error) {
      logger.warn("Critical report notification failed", { message: error?.message });
    }
  }

  // Phase A6.2.3 — Automation Studio real trigger. Fires for every
  // critical/urgent report regardless of whether a doctor is attached
  // (the block above is doctor-specific; this is the general trigger so
  // admin-level automations — e.g. the "Critical Report Escalation"
  // template — still fire even when no doctor is named yet).
  if (severity === "critical" || severity === "urgent") {
    await emitAutomationTrigger(TRIGGER_TYPES.CRITICAL_REPORT_UPLOADED, {
      reportId: report._id,
      patientId: req.user._id,
      doctorId: report.doctorId,
      severity,
      title: report.title,
    });
  }

  res.status(201).json({ success: true, data: { report }, message: "Report uploaded successfully" });
});

export const downloadReport = asyncHandler(async (req, res) => {
  const report = await assertOwnedReport(req, req.params.id);
  downloadFile(res, report.filePath, report.fileName);
});

export const updateReport = asyncHandler(async (req, res) => {
  await assertOwnedReport(req, req.params.id);
  if (req.body.familyMemberId) await assertOwnedFamilyMember(req, req.body.familyMemberId);
  const patch = {};
  ["title", "category", "notes"].forEach((key) => {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  });
  if (req.body.reportDate !== undefined) patch.reportDate = new Date(req.body.reportDate);
  if (req.body.isPinned !== undefined) patch.isPinned = Boolean(req.body.isPinned);
  if (req.body.familyMemberId !== undefined) patch.familyMemberId = req.body.familyMemberId || null;
  if (req.body.tags !== undefined) {
    patch.tags = Array.isArray(req.body.tags)
      ? req.body.tags.filter(Boolean)
      : String(req.body.tags).split(",").map((item) => item.trim()).filter(Boolean);
  }
  const report = await MedicalReport.findOneAndUpdate({ _id: req.params.id, ...ownership(req) }, patch, { returnDocument: "after", runValidators: true }).lean();
  res.status(200).json({ success: true, data: { report }, message: "Report updated successfully" });
});

export const deleteReport = asyncHandler(async (req, res) => {
  const report = await assertOwnedReport(req, req.params.id);
  await MedicalReport.deleteOne({ _id: req.params.id, ...ownership(req) });
  if (report.filePath) fs.unlink(report.filePath, () => {});
  res.status(200).json({ success: true, data: { reportId: req.params.id }, message: "Report deleted successfully" });
});

export const listPatientPrescriptions = asyncHandler(async (req, res) => {
  const filter = { patientId: req.user._id };
  if (req.query.search) filter.$text = { $search: req.query.search };
  const prescriptions = await Prescription.find(filter)
    .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
    .populate("appointmentId", "date timeSlot")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.status(200).json({ success: true, data: { prescriptions }, message: "Prescriptions fetched successfully" });
});

export const downloadPatientPrescription = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findOne({ _id: req.params.id, patientId: req.user._id }).lean();
  if (!prescription) throw new AppError("Prescription not found", 404);
  downloadFile(res, prescription.pdfPath, `prescription-${prescription._id}.pdf`);
});

// ── Patient-side certificate access (Phase DOC-06) ──────────────────────
// Certificates (fitness / sick leave / referral letters) were, until now,
// only reachable from the doctor side — a doctor could issue one but the
// patient it was issued for had no endpoint to see or download it, even
// though the exact same ownership-scoped model/PDF the doctor downloads
// already exists. This mirrors listPatientPrescriptions/
// downloadPatientPrescription exactly: read-only, scoped strictly to
// certificates issued to this patient, revoked ones included (marked by
// their real status) so a patient isn't confused by a certificate quietly
// disappearing.
export const listPatientCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ patientId: req.user._id })
    .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.status(200).json({ success: true, data: { certificates }, message: "Certificates fetched successfully" });
});

export const downloadPatientCertificate = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findOne({ _id: req.params.id, patientId: req.user._id }).lean();
  if (!certificate) throw new AppError("Certificate not found", 404);
  downloadFile(res, certificate.pdfPath, `certificate-${certificate._id}.pdf`);
});

export const listFamilyMembers = asyncHandler(async (req, res) => {
  const familyMembers = await FamilyMember.find({ ...ownership(req), isActive: true }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { familyMembers }, message: "Family members fetched successfully" });
});

// Soft-delete only — appointments/reports/insurance already reference
// FamilyMember by id, so a hard delete would silently orphan real medical
// history. isActive already existed on the model but nothing ever set it.
export const deactivateFamilyMember = asyncHandler(async (req, res) => {
  const familyMember = await FamilyMember.findOneAndUpdate(
    { _id: req.params.id, ...ownership(req) },
    { isActive: false },
    { returnDocument: "after" },
  ).lean();
  if (!familyMember) throw new AppError("Family member not found", 404);
  res.status(200).json({ success: true, data: { familyMemberId: req.params.id }, message: "Family member removed" });
});

// One aggregate read per dependent — appointments/reports/prescriptions/
// insurance counts, all scoped by the existing familyMemberId reference
// already present on Appointment/MedicalReport/Insurance. No new models,
// no fabricated stats.
export const getFamilyMemberWorkspace = asyncHandler(async (req, res) => {
  const familyMember = await assertOwnedFamilyMember(req, req.params.id);
  const [appointmentCount, upcomingAppointment, reportCount, insurancePolicies] = await Promise.all([
    Appointment.countDocuments({ familyMemberId: familyMember._id }),
    Appointment.findOne({ familyMemberId: familyMember._id, status: { $in: ACTIVE_STATUSES }, date: { $gte: new Date() } })
      .populate({ path: "doctorId", populate: { path: "userId", select: "name" } })
      .sort({ date: 1 })
      .lean(),
    MedicalReport.countDocuments({ familyMemberId: familyMember._id }),
    Insurance.find({ familyMemberId: familyMember._id }).lean(),
  ]);
  res.status(200).json({
    success: true,
    data: { familyMember, appointmentCount, upcomingAppointment, reportCount, insurancePolicies },
    message: "Family member workspace fetched successfully",
  });
});

export const createFamilyMember = asyncHandler(async (req, res) => {
  const required = ["name", "relation", "age", "gender"];
  if (required.some((key) => req.body[key] === undefined || req.body[key] === "")) throw new AppError("Name, relation, age, and gender are required", 400);
  const familyMember = await FamilyMember.create({ ...pickFamilyMemberFields(req.body), userId: req.user._id });
  res.status(201).json({ success: true, data: { familyMember }, message: "Family member added successfully" });
});

export const updateFamilyMember = asyncHandler(async (req, res) => {
  // Only allowlisted fields are writable; ownership (userId) and lifecycle
  // (isActive) can never be changed through this endpoint. A deactivated
  // member is not editable (404), so this cannot be used to bypass
  // deactivateFamilyMember.
  const patch = pickFamilyMemberFields(req.body);
  if (Object.keys(patch).length === 0) throw new AppError("No editable family member fields were provided", 400);
  const familyMember = await FamilyMember.findOneAndUpdate(
    { _id: req.params.id, ...ownership(req), isActive: { $ne: false } },
    { $set: patch },
    { returnDocument: "after", runValidators: true },
  );
  if (!familyMember) throw new AppError("Family member not found", 404);
  res.status(200).json({ success: true, data: { familyMember }, message: "Family member updated successfully" });
});

export const listInsurance = asyncHandler(async (req, res) => {
  const filter = { ...ownership(req) };
  if (req.query.familyMemberId) filter.familyMemberId = req.query.familyMemberId;
  const policies = await Insurance.find(filter).populate("familyMemberId", "name relation").sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { policies }, message: "Insurance policies fetched successfully" });
});

export const createInsurance = asyncHandler(async (req, res) => {
  if (!req.body.provider || !req.body.policyNumber || !req.body.policyHolder || !req.body.validTill) throw new AppError("Insurance provider, policy number, holder, and validity are required", 400);
  assertValidUploadOrDelete(req.file);
  if (req.body.familyMemberId) await assertOwnedFamilyMember(req, req.body.familyMemberId);
  const existingPolicy =
  await Insurance.findOne({
    userId: req.user._id,
    policyNumber:
      req.body.policyNumber,
  });

  if (existingPolicy) {
    throw new AppError(
      "Insurance policy already exists",
      409
    );
  }
  // Explicit allowlist: claimStatus / claimHistory / claimAmount are
  // workflow-controlled and must never be settable through a create payload
  // (a patient could otherwise forge an "approved" claim).
  const policy = await Insurance.create({
    provider: req.body.provider,
    policyNumber: req.body.policyNumber,
    policyHolder: req.body.policyHolder,
    validTill: req.body.validTill,
    coverageAmount: req.body.coverageAmount,
    familyMemberId: req.body.familyMemberId || undefined,
    userId: req.user._id,
    document: req.file ? { fileName: req.file.originalname, filePath: req.file.path, mimeType: req.file.mimetype, uploadedAt: new Date() } : undefined,
  });
  res.status(201).json({ success: true, data: { policy }, message: "Insurance policy saved successfully" });
});

const assertOwnedInsurance = async (req, id) => {
  const policy = await Insurance.findOne({ _id: id, ...ownership(req) });
  if (!policy) throw new AppError("Insurance policy not found", 404);
  return policy;
};

export const updateInsurance = asyncHandler(async (req, res) => {
  await assertOwnedInsurance(req, req.params.id);
  if (req.file) assertValidUploadOrDelete(req.file);
  if (req.body.familyMemberId) await assertOwnedFamilyMember(req, req.body.familyMemberId);
  const patch = {};
  ["provider", "policyNumber", "policyHolder", "coverageAmount"].forEach((key) => {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  });
  if (req.body.validTill !== undefined) patch.validTill = new Date(req.body.validTill);
  if (req.body.familyMemberId !== undefined) patch.familyMemberId = req.body.familyMemberId || null;
  if (req.file) patch.document = { fileName: req.file.originalname, filePath: req.file.path, mimeType: req.file.mimetype, uploadedAt: new Date() };
  const policy = await Insurance.findOneAndUpdate({ _id: req.params.id, ...ownership(req) }, patch, { returnDocument: "after", runValidators: true }).lean();
  res.status(200).json({ success: true, data: { policy }, message: "Insurance policy updated successfully" });
});

export const deleteInsurance = asyncHandler(async (req, res) => {
  await assertOwnedInsurance(req, req.params.id);
  await Insurance.deleteOne({ _id: req.params.id, ...ownership(req) });
  res.status(200).json({ success: true, data: { policyId: req.params.id }, message: "Insurance policy deleted successfully" });
});

export const submitInsuranceClaim = asyncHandler(async (req, res) => {
  const policy = await assertOwnedInsurance(req, req.params.id);
  if (!req.body.claimAmount) throw new AppError("Claim amount is required", 400);
  policy.claimStatus = "submitted";
  policy.claimAmount = Number(req.body.claimAmount);
  policy.claimNotes = req.body.claimNotes || "";
  policy.claimHistory.push({ status: "submitted", note: req.body.claimNotes || "", at: new Date() });
  await policy.save();
  // Phase A6.2.3 — Automation Studio real trigger.
  await emitAutomationTrigger(TRIGGER_TYPES.INSURANCE_SUBMITTED, {
    insuranceId: policy._id,
    userId: req.user._id,
    provider: policy.provider,
  });
  res.status(200).json({ success: true, data: { policy }, message: "Claim submitted successfully" });
});

// Real coverage utilization: sums payments actually linked to this policy
// via Appointment.insuranceId (the field the Appointment Journey already
// writes on booking) rather than inventing a usage figure. Exported so the
// AI eligibility-summary endpoint reuses this exact computation.
export const buildInsuranceUtilization = async (policy, patientUserId) => {
  const linkedAppointments = await Appointment.find({ insuranceId: policy._id, patientId: patientUserId })
    .populate({ path: "doctorId", populate: { path: "userId", select: "name" } })
    .populate("paymentId", "totalAmount status")
    .populate("invoiceId", "invoiceNumber totalAmount")
    .sort({ date: -1 })
    .lean();
  const utilizedAmount = linkedAppointments.reduce((sum, appt) => sum + (appt.paymentId?.totalAmount || 0), 0);
  return {
    coverageAmount: policy.coverageAmount || 0,
    utilizedAmount,
    remainingAmount: Math.max((policy.coverageAmount || 0) - utilizedAmount, 0),
    linkedAppointments,
  };
};

export const getInsuranceUtilization = asyncHandler(async (req, res) => {
  const policy = await assertOwnedInsurance(req, req.params.id);
  const data = await buildInsuranceUtilization(policy, req.user._id);
  res.status(200).json({ success: true, data, message: "Insurance utilization fetched successfully" });
});
import { recalculateAndPersistDoctorRating } from "../../services/reviewRatingService.js";
export const listReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find(ownership(req)).populate({ path: "doctorId", populate: { path: "userId", select: "name" } }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { reviews }, message: "Reviews fetched successfully" });
});

export const upsertReview = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findOne({
    _id: req.body.appointmentId,
    patientId: req.user._id,
  }).lean();

  if (!appointment) {
    throw new AppError("Appointment not found for this patient", 404);
  }

  if (appointment.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw new AppError("Only paid appointments can be reviewed", 400);
  }

  // Accept both completed and review_eligible statuses
  const reviewableStatuses = [
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
  ];
  if (!reviewableStatuses.includes(appointment.status)) {
    throw new AppError(
      "Only completed appointments can be reviewed",
      400,
    );
  }

  if (
    Number(req.body.rating) < 1 ||
    Number(req.body.rating) > 5
  ) {
    throw new AppError("Rating must be between 1 and 5", 400);
  }

  const existing = await Review.findOne({
    userId: req.user._id,
    appointmentId: appointment._id,
    adminDeleted: { $ne: true },
  });

  const review = await Review.findOneAndUpdate(
    {
      userId: req.user._id,
      appointmentId: appointment._id,
    },
    {
      doctorId: appointment.doctorId,
      rating: Number(req.body.rating),
      comment: req.body.comment || "",
      isEdited: Boolean(existing),
      editHistory: existing
        ? [
            ...(existing.editHistory || []),
            {
              rating: existing.rating,
              comment: existing.comment,
              editedAt: new Date(),
            },
          ]
        : [],
    },
    {
      returnDocument: "after",
      upsert: true,
      runValidators: true,
    },
  );

  await recalculateAndPersistDoctorRating(appointment.doctorId);

  // Notify doctor that a review was submitted/updated
  try {
    const doctorDoc = await Doctor.findById(appointment.doctorId)
      .populate("userId", "_id")
      .lean();
    if (doctorDoc?.userId?._id) {
      await notificationEmitter.emitToUser(doctorDoc.userId._id, {
        // BUGFIX (Phase DOC-02 Smart Inbox audit): this was typed "appointment"
        // despite entityType already correctly saying "review" — Smart Inbox
        // groups by category, and this mislabeling put review notifications
        // under "Appointments" instead of "Reviews". Also added the patient's
        // name (already available on req.user, no extra query) so the doctor
        // doesn't have to open the notification to know who left it.
        type: "review",
        title: existing ? "Review updated" : "New review received",
        message: `${req.user.name || "A patient"} ${existing ? "updated their" : "left a"} ${req.body.rating}-star review.`,
        entityType: "review",
        entityId: review._id,
        severity: "info",
        eventKey: `review:${review._id}:${existing ? "updated" : "created"}`,
      });
    }
  } catch (error) {
    logger.warn("Review notification failed", { message: error?.message });
  }

  res.status(200).json({
    success: true,
    data: { review },
    message: existing ? "Review updated successfully" : "Review submitted successfully",
  });
});

export const listSavedDoctors = asyncHandler(async (req, res) => {
  const savedDoctors = await SavedDoctor.find(ownership(req)).populate({ path: "doctorId", populate: { path: "userId", select: "name email" } }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { savedDoctors }, message: "Saved doctors fetched successfully" });
});

export const saveDoctor = asyncHandler(async (req, res) => {

  const doctor =
  await Doctor.findById(
    req.body.doctorId
  );

  if (!doctor) {
    throw new AppError(
      "Doctor not found",
      404
    );
  }

  const isPrimaryPhysician = Boolean(req.body.isPrimaryPhysician);
  if (isPrimaryPhysician) {
    // Only one primary physician at a time per patient.
    await SavedDoctor.updateMany(
      { userId: req.user._id, doctorId: { $ne: req.body.doctorId } },
      { isPrimaryPhysician: false },
    );
  }

  const savedDoctor = await SavedDoctor.findOneAndUpdate(
    { userId: req.user._id, doctorId: req.body.doctorId },
    {
      notes: req.body.notes || "",
      ...(Array.isArray(req.body.tags) ? { tags: req.body.tags.filter(Boolean).slice(0, 10) } : {}),
      ...(req.body.isPrimaryPhysician !== undefined ? { isPrimaryPhysician } : {}),
      // Snapshot captured only on first save — never overwritten on
      // subsequent re-saves, so it stays a true "as saved" reference point.
      $setOnInsert: {
        feesAtSave: doctor.fees,
        specializationAtSave: doctor.specialization,
      },
    },
    { returnDocument: "after", upsert: true, runValidators: true },
  );
  res.status(200).json({ success: true, data: { savedDoctor }, message: "Doctor saved successfully" });
});

export const updateSavedDoctor = asyncHandler(async (req, res) => {
  const existing = await SavedDoctor.findOne({ userId: req.user._id, doctorId: req.params.doctorId });
  if (!existing) throw new AppError("Saved doctor not found", 404);

  if (req.body.isPrimaryPhysician === true) {
    await SavedDoctor.updateMany(
      { userId: req.user._id, doctorId: { $ne: req.params.doctorId } },
      { isPrimaryPhysician: false },
    );
  }

  if (req.body.notes !== undefined) existing.notes = req.body.notes;
  if (Array.isArray(req.body.tags)) existing.tags = req.body.tags.filter(Boolean).slice(0, 10);
  if (req.body.isPrimaryPhysician !== undefined) existing.isPrimaryPhysician = Boolean(req.body.isPrimaryPhysician);

  await existing.save();
  res.status(200).json({ success: true, data: { savedDoctor: existing }, message: "Saved doctor updated successfully" });
});

export const removeSavedDoctor = asyncHandler(async (req, res) => {
  await SavedDoctor.findOneAndDelete({ userId: req.user._id, doctorId: req.params.doctorId });
  res.status(200).json({ success: true, data: { doctorId: req.params.doctorId }, message: "Doctor removed from saved list" });
});

export const getProfileCompletion = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  const [insuranceCount, reportCount] = await Promise.all([Insurance.countDocuments(ownership(req)), MedicalReport.countDocuments(ownership(req))]);
  const checks = [
    ["personal details", Boolean(user.name && user.email)],
    ["blood group", Boolean(user.patientProfile?.bloodGroup)],
    ["emergency contact", Boolean(user.patientProfile?.emergencyContact?.phone)],
    ["allergies", Boolean(user.patientProfile?.allergies?.length)],
    ["insurance", insuranceCount > 0],
    ["reports", reportCount > 0],
  ];
  const completed = checks.filter(([, ok]) => ok).length;
  res.status(200).json({ success: true, data: { percentage: Math.round((completed / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => label), profile: user.patientProfile || {} }, message: "Profile completion fetched successfully" });
});

export const updatePatientProfile = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, { patientProfile: req.body.patientProfile }, { returnDocument: "after", runValidators: true }).select("-password");
  res.status(200).json({ success: true, data: { user }, message: "Profile updated successfully" });
});

// Shared by getHealthTimeline and getHealthJourney so the Personal Health
// Journey never re-derives a second, potentially divergent timeline query.
export const buildPatientTimelineData = async (req, familyMemberId) => {
  if (familyMemberId) await assertOwnedFamilyMember(req, familyMemberId);
  const appointmentFilter = familyMemberId ? { patientId: req.user._id, familyMemberId } : { patientId: req.user._id };
  const reportFilter = familyMemberId ? { ...ownership(req), familyMemberId } : ownership(req);
  const appointments = await Appointment.find(appointmentFilter).populate({ path: "doctorId", populate: { path: "userId", select: "name" } }).lean();
  const appointmentIds = appointments.map((item) => item._id);
  const [prescriptions, reports, payments, certificates] = await Promise.all([
    familyMemberId
      ? Prescription.find({ patientId: req.user._id, appointmentId: { $in: appointmentIds } }).lean()
      : Prescription.find({ patientId: req.user._id }).lean(),
    MedicalReport.find(reportFilter).lean(),
    familyMemberId
      ? Payment.find({ ...ownership(req), appointmentId: { $in: appointmentIds } }).lean()
      : Payment.find(ownership(req)).lean(),
    // Additive (Phase DOC-06): certificates now surface in the same real,
    // date-sorted timeline as everything else — never a synthetic entry,
    // omitted entirely for family members since Certificate has no
    // familyMemberId field to scope by.
    familyMemberId ? [] : Certificate.find({ patientId: req.user._id, status: "issued" }).lean(),
  ]);
  const timeline = [
    ...appointments.map((item) => ({
      type: "appointment",
      date: item.date,
      // PHASE P10 — a follow-up appointment on the patient's own timeline
      // read exactly like any other consultation ("Appointment with Dr.
      // X"), giving no answer to "why am I coming back?" (brief §15). Real
      // data only: Appointment.appointmentType is already a persisted
      // field, this just surfaces it instead of computing anything new.
      title:
        item.appointmentType === "follow_up"
          ? `Follow-up appointment with Dr. ${item.doctorId?.userId?.name || "Doctor"}`
          : `Appointment with Dr. ${item.doctorId?.userId?.name || "Doctor"}`,
      data: item,
    })),
    ...prescriptions.map((item) => ({
      type: "prescription",
      date: item.createdAt,
      // PHASE P10 — surfaces the real, already-stored follow-up
      // recommendation inline with the prescription that made it, rather
      // than only being visible via a separate appointment lookup.
      title: item.followUpDate ? `${item.diagnosis} (follow-up recommended ${new Date(item.followUpDate).toLocaleDateString()})` : item.diagnosis,
      data: item,
    })),
    ...reports.map((item) => ({ type: "report", date: item.reportDate, title: item.title, data: item })),
    ...payments.map((item) => ({ type: "payment", date: item.createdAt, title: `${item.currency} ${item.totalAmount} ${item.status}`, data: item })),
    ...certificates.map((item) => ({ type: "certificate", date: item.createdAt, title: item.title, data: item })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  return { timeline, appointments, prescriptions, reports, payments, certificates };
};

export const getHealthTimeline = asyncHandler(async (req, res) => {
  const { timeline } = await buildPatientTimelineData(req, req.query.familyMemberId);
  res.status(200).json({ success: true, data: { timeline }, message: "Health timeline fetched successfully" });
});

// Reused by both the Health Profile page and the AI profile-review endpoint
// so the score shown on screen and the score the AI narrates can never
// diverge. Every input is a real, already-queried figure — nothing here is
// invented or randomized.
export const buildHealthScore = ({ user, insuranceCount, reportCount, upcomingAppointment, overdueFollowUpCount }) => {
  const checks = [
    { label: "Personal details on file", ok: Boolean(user.name && user.email), weight: 10 },
    { label: "Blood group recorded", ok: Boolean(user.patientProfile?.bloodGroup), weight: 10 },
    { label: "Emergency contact recorded", ok: Boolean(user.patientProfile?.emergencyContact?.phone), weight: 15 },
    { label: "Allergies recorded", ok: Boolean(user.patientProfile?.allergies?.length), weight: 10 },
    { label: "Vitals recorded", ok: Boolean(user.patientProfile?.vitals?.heightCm && user.patientProfile?.vitals?.weightKg), weight: 15 },
    { label: "Insurance on file", ok: insuranceCount > 0, weight: 15 },
    { label: "Health records on file", ok: reportCount > 0, weight: 10 },
    { label: "Upcoming or recent checkup", ok: Boolean(upcomingAppointment), weight: 10 },
    { label: "No overdue follow-ups", ok: !overdueFollowUpCount, weight: 5 },
  ];
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.filter((check) => check.ok).reduce((sum, check) => sum + check.weight, 0);
  return {
    score: Math.round((earnedWeight / totalWeight) * 100),
    breakdown: checks.map(({ label, ok, weight }) => ({ label, ok, weight })),
  };
};

export const computeBMI = (heightCm, weightKg) => {
  if (!heightCm || !weightKg) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  let category;
  if (bmi < 18.5) category = "underweight";
  else if (bmi < 25) category = "normal";
  else if (bmi < 30) category = "overweight";
  else category = "obese";
  return { value: Math.round(bmi * 10) / 10, category };
};

// One combined read powering the Health Profile page — real profile data
// plus a real, reused primary-physician reference (SavedDoctor, never
// duplicated onto User) and real insurance counts (Insurance model).
export const getHealthProfileOverview = asyncHandler(async (req, res) => {
  const now = new Date();
  const followUpWindow = new Date(now);
  followUpWindow.setDate(followUpWindow.getDate() + 3);

  const [user, insurancePolicies, reportCount, upcomingAppointment, overdueFollowUpCount, primarySavedDoctor] = await Promise.all([
    User.findById(req.user._id).select("-password").lean(),
    Insurance.find(ownership(req)).select("provider validTill claimStatus coverageAmount").lean(),
    MedicalReport.countDocuments(ownership(req)),
    Appointment.findOne({ patientId: req.user._id, status: { $in: ACTIVE_STATUSES }, date: { $gte: now } }).sort({ date: 1 }).lean(),
    Prescription.countDocuments({ patientId: req.user._id, followUpDate: { $lt: now }, status: "active" }),
    SavedDoctor.findOne({ userId: req.user._id, isPrimaryPhysician: true }).populate({ path: "doctorId", populate: { path: "userId", select: "name email" } }).lean(),
  ]);

  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);
  const expiringPolicies = insurancePolicies.filter((policy) => new Date(policy.validTill) <= in30Days);

  const health = buildHealthScore({
    user,
    insuranceCount: insurancePolicies.length,
    reportCount,
    upcomingAppointment,
    overdueFollowUpCount,
  });

  res.status(200).json({
    success: true,
    data: {
      profile: user.patientProfile || {},
      bmi: computeBMI(user.patientProfile?.vitals?.heightCm, user.patientProfile?.vitals?.weightKg),
      healthScore: health.score,
      healthScoreBreakdown: health.breakdown,
      missing: health.breakdown.filter((check) => !check.ok).map((check) => check.label),
      primaryPhysician: primarySavedDoctor || null,
      insuranceSummary: { total: insurancePolicies.length, expiringSoon: expiringPolicies.length },
      overdueFollowUpCount,
    },
    message: "Health profile fetched successfully",
  });
});

// Personal Health Journey: reuses buildPatientTimeline (same query as the
// existing timeline endpoint) and layers on real, computed-not-fabricated
// milestones and a single "next recommended action" derived from real data.
export const getHealthJourney = asyncHandler(async (req, res) => {
  const familyMemberId = req.query.familyMemberId;
  const now = new Date();
  const followUpWindow = new Date(now);
  followUpWindow.setDate(followUpWindow.getDate() + 3);

  const [{ timeline, appointments, reports }, user, insuranceCount, upcomingFollowUp] = await Promise.all([
    buildPatientTimelineData(req, familyMemberId),
    User.findById(req.user._id).select("patientProfile createdAt").lean(),
    Insurance.countDocuments(ownership(req)),
    Prescription.findOne({ patientId: req.user._id, followUpDate: { $gte: now, $lte: followUpWindow }, status: "active" }).sort({ followUpDate: 1 }).lean(),
  ]);

  const completedAppointments = appointments.filter((item) => ["completed", "review_eligible"].includes(item.status));
  const upcomingAppointment = appointments
    .filter((item) => ACTIVE_STATUSES.includes(item.status) && new Date(item.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  const memberSinceYears = Math.max(0, Math.floor((now - new Date(user.createdAt)) / (365.25 * 24 * 60 * 60 * 1000)));

  // Real, computed counts only — no invented streaks or badge names.
  const milestones = [
    { label: "Completed visits", value: completedAppointments.length },
    { label: "Health records on file", value: reports.length },
    { label: "Years with MediCore", value: memberSinceYears },
  ].filter((m) => m.value > 0);

  const missingProfileFields = buildHealthScore({
    user,
    insuranceCount,
    reportCount: reports.length,
    upcomingAppointment,
    overdueFollowUpCount: 0,
  }).breakdown.filter((check) => !check.ok);

  let nextAction;
  if (upcomingFollowUp) {
    nextAction = { type: "follow_up", label: `Follow-up due by ${new Date(upcomingFollowUp.followUpDate).toLocaleDateString()} for ${upcomingFollowUp.diagnosis}` };
  } else if (upcomingAppointment) {
    nextAction = { type: "appointment", label: `Prepare for your upcoming appointment on ${new Date(upcomingAppointment.date).toLocaleDateString()}` };
  } else if (missingProfileFields.length) {
    nextAction = { type: "profile", label: `Complete your health profile: ${missingProfileFields[0].label.toLowerCase()}` };
  } else {
    nextAction = { type: "checkup", label: "No pending actions — consider scheduling a routine checkup" };
  }

  res.status(200).json({
    success: true,
    data: {
      timeline,
      milestones,
      nextAction,
      upcomingAppointment: upcomingAppointment || null,
      upcomingFollowUp: upcomingFollowUp || null,
    },
    message: "Health journey fetched successfully",
  });
});

export const getPatientNotifications = asyncHandler(async (req, res) => {
  const [appointments, prescriptions, reports, insurance] = await Promise.all([
    // BUGFIX: was hardcoded to [pending, approved] — the same too-narrow
    // lifecycle bug found elsewhere this session. Once a patient paid and
    // their appointment reached payment_completed/consultation_started, it
    // silently disappeared from their own notifications feed.
    Appointment.find({ patientId: req.user._id, status: { $in: ACTIVE_STATUSES } }).limit(5).lean(),
    Prescription.find({ patientId: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
    MedicalReport.find(ownership(req)).sort({ createdAt: -1 }).limit(5).lean(),
    Insurance.find(ownership(req)).sort({ updatedAt: -1 }).limit(5).lean(),
  ]);
  const notifications = [
    ...appointments.map((item) => ({ type: "appointment", message: `Appointment ${item.status} for ${new Date(item.date).toLocaleDateString()}`, createdAt: item.updatedAt })),
    ...prescriptions.map((item) => ({ type: "prescription", message: `Prescription updated: ${item.diagnosis}`, createdAt: item.updatedAt })),
    ...reports.map((item) => ({ type: "report", message: `Report uploaded: ${item.title}`, createdAt: item.createdAt })),
    ...insurance.map((item) => ({ type: "insurance", message: `Insurance status: ${item.claimStatus}`, createdAt: item.updatedAt })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.status(200).json({ success: true, data: { notifications }, message: "Notifications fetched successfully" });
});

export const exportPatientData = asyncHandler(async (req, res) => {
  const resource = req.query.resource || "appointments";
  const format = req.query.format || "csv";
  const datasets = {
    appointments: () => Appointment.find({ patientId: req.user._id }).lean(),
    prescriptions: () => Prescription.find({ patientId: req.user._id }).lean(),
    reports: () => MedicalReport.find(ownership(req)).lean(),
  };
  if (!datasets[resource]) throw new AppError("Unsupported export resource", 400);
  const rows = await datasets[resource]();
  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${resource}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text(`Patient ${resource} export`);
    rows.forEach((row) => doc.fontSize(9).text(JSON.stringify(row)));
    doc.end();
    return;
  }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}.csv"`);
  res.send(rows.map((row) => JSON.stringify(row).replaceAll(",", ";")).join("\n"));
});

// One combined read powering the shared header strip across Records/Family/
// Insurance so the three pages read as one connected ecosystem instead of
// three independent screens. Every figure below is a real count/query
// against existing models — nothing here is fabricated.
export const getHealthEcosystemOverview = asyncHandler(async (req, res) => {
  const now = new Date();
  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);

  const [reportCount, pinnedReports, familyMembers, policies, recentReports] = await Promise.all([
    MedicalReport.countDocuments(ownership(req)),
    MedicalReport.countDocuments({ ...ownership(req), isPinned: true }),
    FamilyMember.find({ ...ownership(req), isActive: true }).select("name relation age").lean(),
    Insurance.find(ownership(req)).select("provider validTill claimStatus familyMemberId").lean(),
    MedicalReport.find(ownership(req)).sort({ createdAt: -1 }).limit(5).select("title category reportDate").lean(),
  ]);

  const expiringPolicies = policies.filter((policy) => new Date(policy.validTill) <= in30Days);

  res.status(200).json({
    success: true,
    data: {
      records: { total: reportCount, pinned: pinnedReports, recent: recentReports },
      family: { total: familyMembers.length, members: familyMembers },
      insurance: { total: policies.length, expiringSoon: expiringPolicies.length, policies },
    },
    message: "Health ecosystem overview fetched successfully",
  });
});

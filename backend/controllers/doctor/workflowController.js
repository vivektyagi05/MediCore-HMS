import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import { assertValidUploadOrDelete } from "../../utils/fileValidation.js";
import Appointment from "../../models/Appointment.js";
import Certificate from "../../models/Certificate.js";
import ConsultationHistory from "../../models/ConsultationHistory.js";
import Doctor from "../../models/Doctor.js";
import FamilyMember from "../../models/FamilyMember.js";
import Insurance from "../../models/Insurance.js";
import LeaveRequest from "../../models/LeaveRequest.js";
import MedicalNote from "../../models/MedicalNote.js";
import MedicalReport from "../../models/MedicalReport.js";
import Payment from "../../models/Payment.js";
import Prescription from "../../models/Prescription.js";
import User from "../../models/User.js";
import ChatMessage from "../../models/ChatMessage.js";
import Review from "../../models/Review.js";
import { APPOINTMENT_STATUS, ACTIVE_STATUSES } from "../../constants/appointmentStatus.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { clinicalEmitter } from "../../realtime/clinicalEmitter.js";
import { appointmentEmitter } from "../../realtime/appointmentEmitter.js";
import { logger } from "../../utils/logger.js";
import { findDuplicateMedicinesInDraft, runPrescriptionSafetyChecks } from "../../utils/prescriptionSafety.js";
import { ensureDoctorProfileForUser } from "../../services/doctorProfileService.js";
import { validateAndDeriveAvailability } from "../../utils/slotEngine.js";
import { buildDayCapacity } from "../../utils/capacityAggregates.js";
import { roomManager } from "../../socket/roomManager.js";
// Phase DOC-07 final pass — reuse the EXACT patient-booking availability
// engine for doctor-initiated follow-up scheduling. No second scheduling
// engine is introduced; these are the same functions createAppointment
// already uses, only now exported from appointmentController.js.
import { ensureDoctorAvailable, findBlockedDate, getDayOfWeek } from "../../controllers/appointmentController.js";
import {
  computeRiskLevel,
  resolveFollowUpState,
  resolveScheduledFollowUps,
  claimFollowUpSlot,
  computeDoctorPatientAttentionItems,
  buildOpenClinicalActions,
  isInsuranceExpiringSoon,
} from "../../services/doctorPatientRelationshipService.js";
import { buildSinceLastVisitComparison, buildMedicationReconciliation } from "../../services/clinicalComparisonService.js";
import { canonicalizeConsultationMode, isKnownDoctorConsultationMode } from "../../constants/consultationMode.js";

const getDoctorProfile = async (userId) => {
  return ensureDoctorProfileForUser(userId);
};

const ensureAppointmentOwned = async (doctorId, appointmentId) => {
  const appointment = await Appointment.findOne({ _id: appointmentId, doctorId })
    .populate("patientId", "name email")
    .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } });
  if (!appointment) throw new AppError("Appointment not found for this doctor", 404);
  return appointment;
};

const normalizeDate = (value) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const parseRequiredDate = (value, fieldName) => {
  if (!value) {
    throw new AppError(`${fieldName} is required`, 400);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }

  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const createPrescriptionPdf = async (prescription, appointment) => {
  const dir = path.resolve(process.cwd(), "storage/prescriptions");
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `RX-${prescription._id}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(20).font("Helvetica-Bold").text("HMS Pro Prescription");
    doc.moveDown();
    doc.fontSize(10).font("Helvetica").text(`Patient: ${appointment.patientId.name}`);
    doc.text(`Doctor: Dr. ${appointment.doctorId.userId.name}`);
    doc.text(`Date: ${new Date(prescription.createdAt).toLocaleDateString()}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Diagnosis");
    doc.font("Helvetica").text(prescription.diagnosis);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Medicines");
    prescription.medicines.forEach((medicine) => {
      doc.font("Helvetica").text(`${medicine.name} - ${medicine.dosage}, ${medicine.frequency}, ${medicine.duration}`);
      if (medicine.instructions) doc.text(`Instructions: ${medicine.instructions}`);
    });
    doc.moveDown();
    if (prescription.notes) doc.text(`Notes: ${prescription.notes}`);
    if (prescription.followUpDate) doc.text(`Follow-up: ${new Date(prescription.followUpDate).toLocaleDateString()}`);
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
};

const upsertHistoryLink = async ({ doctorId, patientId, appointmentId, prescriptionId, noteId }) => {
  const addToSet = {};
  if (prescriptionId) addToSet.prescriptionIds = prescriptionId;
  if (noteId) addToSet.noteIds = noteId;
  if (!Object.keys(addToSet).length) return;
  await ConsultationHistory.findOneAndUpdate(
    { doctorId, patientId, appointmentId },
    { $addToSet: addToSet, $setOnInsert: { doctorId, patientId, appointmentId } },
    { upsert: true, runValidators: true },
  );
};

export const listPrescriptions = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.patientId) filter.patientId = req.query.patientId;
  const prescriptions = await Prescription.find(filter).populate("patientId", "name email").sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { prescriptions }, message: "Prescriptions fetched successfully" });
});
export const createPrescription = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);

  const {
    appointmentId,
    diagnosis,
    medicines,
    notes,
    followUpDate,
  } = req.body;

  if (!diagnosis || !Array.isArray(medicines) || medicines.length === 0) {
    throw new AppError(
      "Diagnosis and at least one medicine are required",
      400
    );
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("patientId", "name email patientProfile")
    .populate({
      path: "doctorId",
      populate: {
        path: "userId",
        select: "name email",
      },
    });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  if (
    appointment.doctorId._id.toString() !==
    doctor._id.toString()
  ) {
    throw new AppError(
      "You can create prescription only for your patients",
      403
    );
  }

  const prescriptionAllowed = [
    APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
  ];
  if (!prescriptionAllowed.includes(appointment.status)) {
    throw new AppError(
      "Prescription can only be created after consultation is completed",
      400,
    );
  }

  const existingPrescription =
    await Prescription.findOne({
      appointmentId,
      status: "active",
    });

  if (existingPrescription) {
    throw new AppError(
      "Prescription already exists for this appointment",
      409
    );
  }

  // Prescription Intelligence (Step 4/8): advisory safety warnings — never
  // blocks except for an in-draft duplicate medicine, which is thrown as a
  // hard 400 from within the checker itself.
  const allergies = [
    ...new Set([
      ...(appointment.allergies || []),
      ...(appointment.patientId?.patientProfile?.allergies || []),
    ]),
  ];
  const recentPrescriptions = await Prescription.find({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    status: "active",
  })
    .select("medicines")
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  const safetyWarnings = runPrescriptionSafetyChecks({ medicines, allergies, recentPrescriptions });

  const prescription = await Prescription.create({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    appointmentId,
    diagnosis,
    medicines,
    notes,
    followUpDate,
  });

  prescription.pdfPath =
    await createPrescriptionPdf(
      prescription,
      appointment
    );

  await prescription.save();

  await upsertHistoryLink({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    appointmentId,
    prescriptionId: prescription._id,
  });

  try {
    await clinicalEmitter.prescriptionCreated(doctor._id, appointment.patientId._id, prescription);
  } catch (error) {
    logger.warn("clinicalEmitter.prescriptionCreated failed", { message: error?.message });
  }

  res.status(201).json({
    success: true,
    data: { prescription, safetyWarnings },
    message: "Prescription created successfully",
  });
});

// Live pre-submit safety check — same rules as createPrescription, without
// persisting anything. Powers the Clinical Workspace's inline warning panel
// as the doctor is still drafting.
export const checkPrescriptionSafety = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const { appointmentId, medicines } = req.body;
  if (!Array.isArray(medicines) || !medicines.length) {
    throw new AppError("At least one medicine is required to run a safety check", 400);
  }

  let allergies = [];
  let recentPrescriptions = [];
  if (appointmentId) {
    const appointment = await Appointment.findOne({ _id: appointmentId, doctorId: doctor._id })
      .populate("patientId", "patientProfile")
      .lean();
    if (appointment) {
      allergies = [
        ...new Set([
          ...(appointment.allergies || []),
          ...(appointment.patientId?.patientProfile?.allergies || []),
        ]),
      ];
      recentPrescriptions = await Prescription.find({
        doctorId: doctor._id,
        patientId: appointment.patientId._id,
        status: "active",
      })
        .select("medicines")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    }
  }

  const warnings = runPrescriptionSafetyChecks({ medicines, allergies, recentPrescriptions });
  res.status(200).json({ success: true, data: { warnings }, message: "Safety check complete" });
});

// SECURITY BUGFIX (Phase 2-B audit, Section 14/24): this previously did
// `Prescription.findOneAndUpdate({ _id, doctorId }, req.body, ...)` with NO
// field whitelist. The `{ doctorId: doctor._id }` match clause stops a
// doctor from reaching another doctor's prescription, but nothing stopped
// them from sending `{ doctorId: <someone else's id>, patientId: <any
// patient>, appointmentId: <any appointment>, status: "void" }` in the body
// of a request against their OWN prescription -- silently reassigning a
// real clinical record to a different doctor/patient/appointment, or
// forging its lifecycle status. Only the fields a prescription edit
// legitimately needs are allowed through now; identity/lifecycle fields
// stay backend-authoritative.
const PRESCRIPTION_EDITABLE_FIELDS = ["diagnosis", "medicines", "notes", "followUpDate"];

export const pickPrescriptionEditableFields = (body) => {
  const picked = {};
  for (const field of PRESCRIPTION_EDITABLE_FIELDS) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
};

export const updatePrescription = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const prescription = await Prescription.findOneAndUpdate(
    { _id: req.params.id, doctorId: doctor._id },
    pickPrescriptionEditableFields(req.body),
    { returnDocument: "after", runValidators: true },
  );
  if (!prescription) throw new AppError("Prescription not found", 404);
  res.status(200).json({ success: true, data: { prescription }, message: "Prescription updated successfully" });
});

export const downloadPrescription = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const prescription = await Prescription.findOne({ _id: req.params.id, doctorId: doctor._id }).lean();
  if (!prescription?.pdfPath || !fs.existsSync(prescription.pdfPath)) throw new AppError("Prescription PDF not found", 404);
  res.download(prescription.pdfPath, `prescription-${prescription._id}.pdf`);
});

export const listMedicalNotes = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.appointmentId) filter.appointmentId = req.query.appointmentId;
  if (req.query.patientId) filter.patientId = req.query.patientId;
  const notes = await MedicalNote.find(filter).populate("patientId", "name email").sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { notes }, message: "Medical notes fetched successfully" });
});

export const createMedicalNote = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const appointment = await ensureAppointmentOwned(doctor._id, req.body.appointmentId);
  
  if (!req.body.notes) throw new AppError("Clinical note is required", 400);
  const noteAllowed = [
    APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
  ];
  if (!noteAllowed.includes(appointment.status)) {
    throw new AppError(
      "Clinical notes can only be added after consultation is completed",
      400,
    );
  }
  const note = await MedicalNote.create({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    appointmentId: appointment._id,
    symptoms: req.body.symptoms || [],
    notes: req.body.notes,
    recommendations: req.body.recommendations || "",
    attachments: req.body.attachments || [],
  });
  await upsertHistoryLink({ doctorId: doctor._id, patientId: appointment.patientId._id, appointmentId: appointment._id, noteId: note._id });
  res.status(201).json({ success: true, data: { note }, message: "Medical note saved successfully" });
});

export const getConsultationHistory = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.patientId) filter.patientId = req.query.patientId;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  const history = await ConsultationHistory.find(filter)
    .populate("patientId", "name email")
    .populate("appointmentId", "date timeSlot status paymentStatus")
    .populate("prescriptionIds")
    .populate("noteIds")
    .populate("paymentId", "totalAmount status")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.status(200).json({ success: true, data: { history }, message: "Consultation history fetched successfully" });
});

export const getSchedule = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  // BUGFIX (Phase DOC-07 audit): this previously also fetched EVERY active
  // appointment the doctor has ever had, with no date bound and no
  // pagination — a real "Large Data Protection" violation (see mission
  // §33) for any doctor with a long history. Audited every frontend
  // consumer (DoctorSchedule.jsx's Configure tab, DoctorDashboard.jsx) and
  // neither one ever reads `data.appointments` from this response — it
  // exists purely to configure the WEEKLY availability template, which
  // doesn't need appointment data at all. Removed rather than merely
  // bounded, since nothing consumes it; day-specific appointment data is
  // now served by getScheduleDay below, which is always date-bounded to a
  // single day.
  res.status(200).json({ success: true, data: { availability: doctor.availability, blockedDates: doctor.blockedDates }, message: "Schedule fetched successfully" });
});

// GET /api/doctor/workflow/schedule/day?date=YYYY-MM-DD — Phase DOC-07.
// Real Schedule & Capacity Intelligence for ONE specific day: combines the
// doctor's own working-hours config, blocked dates, approved leave, and
// every real appointment on that date into the single annotated timeline +
// capacity summary the "Today" view and Conflict Center both render from.
// Always date-bounded (never "all appointments") — see the bugfix note on
// getSchedule above for why that matters.
export const getScheduleDay = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);

  const dateParam = req.query.date;
  if (!dateParam || Number.isNaN(Date.parse(dateParam))) {
    throw new AppError("A valid date is required", 400);
  }
  const date = normalizeDate(dateParam);
  const today = normalizeDate(new Date());

  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
  const dayConfig = doctor.availability?.find((slot) => slot.dayOfWeek === dayOfWeek) || null;

  const blockedDate = doctor.blockedDates?.find((item) => {
    const bd = new Date(item.date);
    bd.setUTCHours(0, 0, 0, 0);
    return bd.getTime() === date.getTime();
  });

  const activeLeave = await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: "approved",
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).lean();

  // ALL statuses for this one date (not just ACTIVE_STATUSES) — the Today
  // timeline is meant to show the doctor cancelled/completed history for
  // the day too, each correctly labelled, not just what's currently taking
  // up a slot.
  const dayAppointments = await Appointment.find({ doctorId: doctor._id, date })
    .populate("patientId", "name")
    .select("timeSlot status consultationMode patientId")
    .lean();

  const capacity = buildDayCapacity({
    dayConfig,
    appointments: dayAppointments.map((a) => ({
      timeSlot: a.timeSlot,
      status: a.status,
      appointmentId: a._id,
      patientName: a.patientId?.name || "Patient",
      consultationMode: a.consultationMode,
    })),
    blockedReason: blockedDate?.reason || null,
    leaveReason: activeLeave?.reason || null,
    isPastDate: date < today,
  });

  res.status(200).json({
    success: true,
    data: { date: dateParam, ...capacity },
    message: "Day schedule fetched successfully",
  });
});

export const updateSchedule = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const availabilityInput = req.body.availability || doctor.availability;

  // Time Slot Engine: shared validation + derivation (same function the admin
  // create/update-doctor path now uses too, see controllers/doctorController.js)
  // so structured schedules and business rules can never drift between the two
  // entry points that can write `doctor.availability`.
  let availability;
  try {
    availability = validateAndDeriveAvailability(availabilityInput);
  } catch (err) {
    throw new AppError(err.message, err.statusCode || 400);
  }
  doctor.availability = availability;
  if (req.body.blockedDates) doctor.blockedDates = req.body.blockedDates.map((item) => ({ ...item, date: normalizeDate(item.date) }));
  await doctor.save();
  try { clinicalEmitter.scheduleUpdated(doctor._id); } catch (error) { logger.warn("clinicalEmitter.scheduleUpdated failed", { message: error?.message }); }
  res.status(200).json({ success: true, data: { doctor }, message: "Schedule updated successfully" });
});

// ── Scheduling Intelligence: Session Templates ──
// Named, reusable weekly-availability configs. Saving/applying a template
// still goes through the same validateAndDeriveAvailability engine as
// updateSchedule, so a template can never write an availability shape the
// slot engine wouldn't otherwise accept.
export const listScheduleTemplates = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  res.status(200).json({ success: true, data: { templates: doctor.scheduleTemplates || [] }, message: "Schedule templates fetched successfully" });
});

export const saveScheduleTemplate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  if (!req.body.name?.trim()) throw new AppError("Template name is required", 400);
  const availability = validateAndDeriveAvailability(req.body.availability || doctor.availability);
  doctor.scheduleTemplates.push({ name: req.body.name.trim(), availability });
  await doctor.save();
  res.status(201).json({ success: true, data: { template: doctor.scheduleTemplates.at(-1) }, message: "Schedule template saved successfully" });
});

export const deleteScheduleTemplate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  doctor.scheduleTemplates = doctor.scheduleTemplates.filter((item) => item._id.toString() !== req.params.id);
  await doctor.save();
  res.status(200).json({ success: true, data: { templateId: req.params.id }, message: "Schedule template deleted successfully" });
});

export const applyScheduleTemplate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const template = doctor.scheduleTemplates.id(req.params.id);
  if (!template) throw new AppError("Schedule template not found", 404);
  // Re-validate at apply-time too — a doctor's availability constraints
  // (e.g. slot engine rules) could change between when a template was saved
  // and when it's applied.
  doctor.availability = validateAndDeriveAvailability(template.availability);
  await doctor.save();
  try { clinicalEmitter.scheduleUpdated(doctor._id); } catch (error) { logger.warn("clinicalEmitter.scheduleUpdated failed", { message: error?.message }); }
  res.status(200).json({ success: true, data: { doctor }, message: "Schedule template applied successfully" });
});

export const requestLeave = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const startDate = parseRequiredDate(req.body.startDate, "Start date");
  const endDate = parseRequiredDate(req.body.endDate, "End date");
  if (!req.body.reason?.trim()) throw new AppError("Leave reason is required", 400);
  if (endDate < startDate) throw new AppError("Leave end date cannot be before start date", 400);
  const conflict = await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: { $in: ["pending", "approved"] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  }).lean();
  if (conflict) throw new AppError("Leave request overlaps with an existing leave", 409);
  const leave = await LeaveRequest.create({ doctorId: doctor._id, userId: req.user._id, startDate, endDate, reason: req.body.reason.trim() });
  res.status(201).json({ success: true, data: { leave }, message: "Leave request submitted successfully" });
});

export const listLeaves = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await getDoctorProfile(req.user._id);
    filter.doctorId = doctor._id;
  }
  if (req.query.status) filter.status = req.query.status;
  const leaves = await LeaveRequest.find(filter).populate("userId", "name email role").sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { leaves }, message: "Leave requests fetched successfully" });
});

export const updateLeaveStatus = asyncHandler(async (req, res) => {
  if (![ROLES.SUPER_ADMIN].includes(req.user.role)) throw new AppError("Admin access is required", 403);
  const leave = await LeaveRequest.findById(req.params.id);
  if (!leave) throw new AppError("Leave request not found", 404);
  leave.status = req.body.status;
  leave.adminComment = req.body.adminComment || "";
  leave.reviewedBy = req.user._id;
  leave.reviewedAt = new Date();
  await leave.save();
  if (leave.status === "approved") {
    // Pre-existing bug fix: this only ever blocked the leave's *start* date,
    // so a multi-day approved leave left every date after day 1 still
    // bookable. Block every date in the [startDate, endDate] range instead.
    const blockedDates = [];
    const cursor = new Date(leave.startDate);
    while (cursor <= leave.endDate) {
      blockedDates.push({ date: new Date(cursor), reason: leave.reason });
      cursor.setDate(cursor.getDate() + 1);
    }
    await Doctor.findByIdAndUpdate(leave.doctorId, { $addToSet: { blockedDates: { $each: blockedDates } } });
  }
  try {
    await clinicalEmitter.leaveStatusChanged(leave);
  } catch (error) {
    logger.warn("clinicalEmitter.leaveStatusChanged failed", { message: error?.message });
  }
  res.status(200).json({ success: true, data: { leave }, message: "Leave request updated successfully" });
});

export const uploadDoctorDocument = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  if (!req.file) throw new AppError("Document file is required", 400);
  assertValidUploadOrDelete(req.file);
  const document = {
    type: req.body.type || "other",
    title: req.body.title || req.file.originalname,
    fileName: req.file.originalname,
    filePath: req.file.path,
    mimeType: req.file.mimetype,
    fileSize: req.file.size || null,
    expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
  };
  doctor.documents.push(document);
  await doctor.save();
  res.status(201).json({ success: true, data: { document: doctor.documents.at(-1) }, message: "Document uploaded successfully" });
});

export const deleteDoctorDocument = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const document = doctor.documents.id(req.params.id);
  if (!document) throw new AppError("Document not found", 404);
  document.deleteOne();
  await doctor.save();
  res.status(200).json({ success: true, data: { documentId: req.params.id }, message: "Document deleted successfully" });
});

export const getDoctorDocuments = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  res.status(200).json({ success: true, data: { documents: doctor.documents }, message: "Documents fetched successfully" });
});

// ── Document Center overview (Step 5) ──
// Aggregates real counts already sitting in existing models — no new
// storage, no fabricated verification/version data. Version History is
// intentionally left out: the Doctor.documents subdocument overwrites in
// place today with no history array, so we surface that as "not tracked"
// rather than inventing a history the backend doesn't keep.
export const getDocumentCenterOverview = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const documents = doctor.documents || [];
  const expiring = documents.filter((doc) => doc.expiryDate && doc.expiryDate <= soon && doc.expiryDate >= now);
  const expired = documents.filter((doc) => doc.expiryDate && doc.expiryDate < now);
  const pendingVerification = documents.filter((doc) => doc.status === "pending");

  const [certificateCount, prescriptionCount, reportsSharedCount] = await Promise.all([
    Certificate.countDocuments({ doctorId: doctor._id, status: "issued" }),
    Prescription.countDocuments({ doctorId: doctor._id }),
    MedicalReport.countDocuments({ appointmentId: { $in: await Appointment.find({ doctorId: doctor._id }).distinct("_id") } }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      identityAndLicenses: documents,
      expiringSoon: expiring,
      expired,
      pendingVerification,
      generated: {
        certificates: certificateCount,
        prescriptions: prescriptionCount,
        reportsOnFileForPatients: reportsSharedCount,
      },
      versionHistorySupported: false,
    },
    message: "Document center overview fetched successfully",
  });
});

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function buildDoctorAnalyticsIntelligence(doctor) {
  const [appointments, revenue, paidPayments] = await Promise.all([
    Appointment.find({ doctorId: doctor._id }).lean(),
    Payment.aggregate([{ $match: { doctorId: doctor._id } }, { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } }]),
    Payment.find({ doctorId: doctor._id, status: "paid" }).select("totalAmount paidAt createdAt").lean(),
  ]);

  const completed = appointments.filter((item) => item.status === APPOINTMENT_STATUS.COMPLETED || item.status === APPOINTMENT_STATUS.REVIEW_ELIGIBLE).length;
  const cancelled = appointments.filter((item) => item.status === APPOINTMENT_STATUS.CANCELLED).length;
  const uniquePatients = new Set(appointments.map((item) => item.patientId.toString()));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const patientsToday = appointments.filter((item) => {
    const apptDate = new Date(item.date);
    apptDate.setHours(0, 0, 0, 0);
    return apptDate.getTime() === today.getTime();
  }).length;

  // Approval rate: of appointments a doctor has actually acted on (excludes
  // ones still sitting pending, since those haven't been decided yet).
  const decided = appointments.filter((item) => item.status !== APPOINTMENT_STATUS.PENDING);
  const approvalRate = decided.length
    ? Number(((decided.length - cancelled) / decided.length).toFixed(2))
    : 0;

  // Most common consultation type — reuses the visit-intake field captured
  // at booking time (Phase A3). Appointments booked before that field existed
  // simply have consultationMode === "" and are excluded rather than guessed.
  const modeCounts = appointments.reduce((acc, item) => {
    if (item.consultationMode) acc[item.consultationMode] = (acc[item.consultationMode] || 0) + 1;
    return acc;
  }, {});
  const mostCommonConsultationType = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Most active day of week, by appointment volume.
  const dayCounts = appointments.reduce((acc, item) => {
    const day = WEEKDAY_NAMES[new Date(item.date).getDay()];
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {});
  const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Revenue trend + monthly growth: last 6 calendar months of paid revenue.
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const monthlyRevenueMap = paidPayments.reduce((acc, payment) => {
    const key = monthKey(new Date(payment.paidAt || payment.createdAt));
    acc[key] = (acc[key] || 0) + (payment.totalAmount || 0);
    return acc;
  }, {});
  const revenueTrend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = monthKey(d);
    revenueTrend.push({ month: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), revenue: Number((monthlyRevenueMap[key] || 0).toFixed(2)) });
  }
  const lastMonthRevenue = revenueTrend[revenueTrend.length - 2]?.revenue || 0;
  const currentMonthRevenue = revenueTrend[revenueTrend.length - 1]?.revenue || 0;
  const monthlyGrowth = lastMonthRevenue
    ? Number((((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1))
    : (currentMonthRevenue > 0 ? 100 : 0);

  // ── Doctor Command Center additions (additive only) ──
  // Real, rule-based queue/productivity signals derived from the same
  // `appointments` array already loaded above — no new heavy queries beyond
  // one lightweight Prescription projection to know which completed
  // consultations still have no prescription on file.
  const pendingApprovals = appointments.filter((item) => item.status === APPOINTMENT_STATUS.PENDING).length;
  const incompleteConsultations = appointments.filter((item) => item.status === APPOINTMENT_STATUS.CONSULTATION_STARTED).length;

  const consultationCompletedIds = appointments
    .filter((item) => item.status === APPOINTMENT_STATUS.CONSULTATION_COMPLETED)
    .map((item) => item._id.toString());
  const prescribedAppointmentIds = consultationCompletedIds.length
    ? new Set(
        (
          await Prescription.find({ doctorId: doctor._id, appointmentId: { $in: consultationCompletedIds } })
            .select("appointmentId")
            .lean()
        ).map((p) => p.appointmentId.toString()),
      )
    : new Set();
  const pendingPrescriptions = consultationCompletedIds.filter((id) => !prescribedAppointmentIds.has(id)).length;

  const todaysAppointments = appointments.filter((item) => {
    const apptDate = new Date(item.date);
    apptDate.setHours(0, 0, 0, 0);
    return apptDate.getTime() === today.getTime() && item.status !== APPOINTMENT_STATUS.CANCELLED;
  });
  const emergencyToday = todaysAppointments.filter((item) => (item.painLevel || 0) >= 8).length;
  const reportsSharedToday = new Set(
    todaysAppointments.flatMap((item) => (item.reportIds || []).map((id) => id.toString())),
  ).size;

  // ── Analytics Intelligence additions (Phase D3, additive only) ──
  // All derived from the same `appointments`/`paidPayments` already loaded
  // above, plus one lightweight Prescription/Payment projection each.

  // Appointment funnel: real lifecycle counts (see STATUS_TRANSITIONS).
  const appointmentFunnel = {
    requested: appointments.length,
    approvedOrBeyond: appointments.filter((item) => item.status !== APPOINTMENT_STATUS.PENDING && item.status !== APPOINTMENT_STATUS.CANCELLED).length,
    completed,
    cancelled,
  };

  // Revenue funnel: payment lifecycle counts on this doctor's payments.
  const allPayments = await Payment.find({ doctorId: doctor._id }).select("status refundStatus totalAmount").lean();
  const revenueFunnel = {
    created: allPayments.length,
    paid: allPayments.filter((p) => p.status === "paid").length,
    refunded: allPayments.filter((p) => p.refundStatus && p.refundStatus !== "none").length,
  };

  // Patient funnel: new vs returning patients this month, from real visit history.
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstVisitByPatient = appointments.reduce((acc, item) => {
    const id = item.patientId.toString();
    const d = new Date(item.date);
    if (!acc[id] || d < acc[id]) acc[id] = d;
    return acc;
  }, {});
  const monthAppointments = appointments.filter((item) => new Date(item.date) >= startOfThisMonth);
  const monthPatientIds = new Set(monthAppointments.map((i) => i.patientId.toString()));
  const newPatientsThisMonth = [...monthPatientIds].filter((id) => firstVisitByPatient[id] >= startOfThisMonth).length;
  const patientFunnel = {
    newPatients: newPatientsThisMonth,
    returningPatients: Math.max(monthPatientIds.size - newPatientsThisMonth, 0),
  };

  // Peak hours: parsed defensively from timeSlot strings (format isn't fixed
  // across the app, so unparsable slots are simply excluded, not guessed).
  const hourCounts = {};
  appointments.forEach((item) => {
    const match = /^(\d{1,2}):/.exec(item.timeSlot || "");
    if (match) {
      const hour = Number(match[1]);
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  });
  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour, count]) => ({ hour: Number(hour), count }));

  // Cancellation trend: last 6 months of cancelled-appointment counts.
  const monthKeyFn = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const cancelledMap = appointments
    .filter((item) => item.status === APPOINTMENT_STATUS.CANCELLED)
    .reduce((acc, item) => {
      const key = monthKeyFn(new Date(item.updatedAt || item.date));
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  const cancellationTrend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    cancellationTrend.push({ month: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), cancelled: cancelledMap[monthKeyFn(d)] || 0 });
  }

  // Prescription follow-up success: of prescriptions with a followUpDate that
  // has already passed, what fraction had a subsequent real appointment for
  // that same patient on/after the follow-up date.
  const prescriptions = await Prescription.find({ doctorId: doctor._id }).select("patientId followUpDate createdAt").lean();
  const duePrescriptions = prescriptions.filter((p) => p.followUpDate && new Date(p.followUpDate) < today);
  const followUpKept = duePrescriptions.filter((p) =>
    appointments.some((a) => a.patientId.toString() === p.patientId.toString() && new Date(a.date) >= new Date(p.followUpDate)),
  ).length;
  const followUpSuccessRate = duePrescriptions.length ? Number(((followUpKept / duePrescriptions.length) * 100).toFixed(1)) : null;
  const prescriptionStats = {
    total: prescriptions.length,
    withFollowUp: prescriptions.filter((p) => p.followUpDate).length,
  };

  // Report statistics: distinct reports shared across this doctor's entire history.
  const reportStatsTotal = new Set(appointments.flatMap((item) => (item.reportIds || []).map((id) => id.toString()))).size;

  // Revenue & growth forecast: simple average-growth projection off the
  // existing 6-month revenueTrend — a projection, not a guarantee.
  const monthGrowths = [];
  for (let i = 1; i < revenueTrend.length; i += 1) {
    const prev = revenueTrend[i - 1].revenue;
    const curr = revenueTrend[i].revenue;
    if (prev > 0) monthGrowths.push((curr - prev) / prev);
  }
  const avgGrowth = monthGrowths.length ? monthGrowths.reduce((s, g) => s + g, 0) / monthGrowths.length : 0;
  const revenueForecast = Number((currentMonthRevenue * (1 + avgGrowth)).toFixed(2));
  const growthForecast = Number((avgGrowth * 100).toFixed(1));

  return {
    completed,
    averageRating: doctor.rating,
    patientReturnRatio: appointments.length ? Number(((appointments.length - uniquePatients.size) / appointments.length).toFixed(2)) : 0,
    revenue: revenue[0]?.total || 0,
    cancellationRate: appointments.length ? Number((cancelled / appointments.length).toFixed(2)) : 0,
    patientsToday,
    approvalRate,
    mostCommonConsultationType,
    mostActiveDay,
    monthlyGrowth,
    revenueTrend,
    pendingApprovals,
    incompleteConsultations,
    pendingPrescriptions,
    emergencyToday,
    reportsSharedToday,
    appointmentFunnel,
    revenueFunnel,
    patientFunnel,
    peakHours,
    cancellationTrend,
    followUpSuccessRate,
    prescriptionStats,
    reportStatsTotal,
    revenueForecast,
    growthForecast,
  };
}

export const getDoctorAnalytics = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const data = await buildDoctorAnalyticsIntelligence(doctor);

  res.status(200).json({
    success: true,
    data,
    message: "Doctor analytics fetched successfully",
  });
});

export const exportDoctorData = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const resource = req.query.resource || "prescriptions";
  const format = req.query.format || "csv";
  const data = resource === "schedules"
    ? doctor.availability
    : await Prescription.find({ doctorId: doctor._id }).populate("patientId", "name email").lean();
  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${resource}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text(`Doctor ${resource} export`);
    doc.moveDown();
    data.forEach((item) => doc.fontSize(9).text(JSON.stringify(item)));
    doc.end();
    return;
  }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}.csv"`);
  res.send(data.map((item) => JSON.stringify(item).replaceAll(",", ";")).join("\n"));
});

// ── Prescription Intelligence: Medicine Templates & Favourites (Step 4) ──
export const listMedicineTemplates = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  res.status(200).json({ success: true, data: { templates: doctor.medicineTemplates || [] }, message: "Medicine templates fetched successfully" });
});

export const createMedicineTemplate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const { name, medicines } = req.body;
  if (!name?.trim()) throw new AppError("Template name is required", 400);
  if (!Array.isArray(medicines) || !medicines.length) throw new AppError("At least one medicine is required", 400);
  const duplicates = findDuplicateMedicinesInDraft(medicines);
  if (duplicates.length) throw new AppError(`Duplicate medicine(s) in template: ${duplicates.join(", ")}`, 400);
  doctor.medicineTemplates.push({ name: name.trim(), medicines });
  await doctor.save();
  res.status(201).json({ success: true, data: { template: doctor.medicineTemplates.at(-1) }, message: "Medicine template saved successfully" });
});

export const deleteMedicineTemplate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  doctor.medicineTemplates = doctor.medicineTemplates.filter((item) => item._id.toString() !== req.params.id);
  await doctor.save();
  res.status(200).json({ success: true, data: { templateId: req.params.id }, message: "Medicine template deleted successfully" });
});

export const listFavouriteMedicines = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  res.status(200).json({ success: true, data: { favourites: doctor.favouriteMedicines || [] }, message: "Favourite medicines fetched successfully" });
});

export const addFavouriteMedicine = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  if (!req.body.name?.trim()) throw new AppError("Medicine name is required", 400);
  const alreadyExists = doctor.favouriteMedicines.some((item) => item.name.trim().toLowerCase() === req.body.name.trim().toLowerCase());
  if (alreadyExists) throw new AppError("This medicine is already in your favourites", 409);
  doctor.favouriteMedicines.push({
    name: req.body.name.trim(),
    dosage: req.body.dosage || "",
    frequency: req.body.frequency || "",
    duration: req.body.duration || "",
    instructions: req.body.instructions || "",
  });
  await doctor.save();
  res.status(201).json({ success: true, data: { favourite: doctor.favouriteMedicines.at(-1) }, message: "Added to favourite medicines" });
});

export const removeFavouriteMedicine = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  doctor.favouriteMedicines = doctor.favouriteMedicines.filter((item) => item._id.toString() !== req.params.id);
  await doctor.save();
  res.status(200).json({ success: true, data: { favouriteId: req.params.id }, message: "Removed from favourite medicines" });
});

// ── Certificate Generator (Step 3/5) ──
// A certificate can only be issued for a patient the doctor has actually
// treated (at least one appointment together) — the same wrong-patient
// guard the rest of the clinical workflow already relies on.
export const ensureDoctorTreatedPatient = async (doctorId, patientId) => {
  const treated = await Appointment.exists({ doctorId, patientId });
  if (!treated) throw new AppError("You can only issue a certificate for a patient you have an appointment history with", 403);
};

const createCertificatePdf = async (certificate, patientName, doctorName) => {
  const dir = path.resolve(process.cwd(), "storage/certificates");
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `CERT-${certificate._id}.pdf`);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(20).font("Helvetica-Bold").text(certificate.title);
    doc.moveDown();
    doc.fontSize(10).font("Helvetica").text(`Patient: ${patientName}`);
    doc.text(`Issuing Doctor: Dr. ${doctorName}`);
    doc.text(`Type: ${certificate.type.replace("_", " ")}`);
    doc.text(`Date: ${new Date(certificate.createdAt).toLocaleDateString()}`);
    doc.moveDown();
    if (certificate.content.diagnosis) doc.text(`Diagnosis: ${certificate.content.diagnosis}`);
    if (certificate.content.validFrom) doc.text(`Valid From: ${new Date(certificate.content.validFrom).toLocaleDateString()}`);
    if (certificate.content.validTill) doc.text(`Valid Till: ${new Date(certificate.content.validTill).toLocaleDateString()}`);
    if (certificate.content.referredTo) doc.text(`Referred To: ${certificate.content.referredTo}`);
    if (certificate.content.notes) {
      doc.moveDown();
      doc.font("Helvetica-Bold").text("Notes");
      doc.font("Helvetica").text(certificate.content.notes);
    }
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return filePath;
};

export const listCertificates = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.patientId) filter.patientId = req.query.patientId;
  const certificates = await Certificate.find(filter).populate("patientId", "name email").sort({ createdAt: -1 }).limit(200).lean();
  res.status(200).json({ success: true, data: { certificates }, message: "Certificates fetched successfully" });
});

export const createCertificate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const { patientId, appointmentId, type, title, content } = req.body;
  if (!patientId) throw new AppError("Patient is required", 400);
  if (!title?.trim()) throw new AppError("Certificate title is required", 400);
  if (!["fitness", "sick_leave", "referral", "other"].includes(type)) throw new AppError("Invalid certificate type", 400);
  await ensureDoctorTreatedPatient(doctor._id, patientId);

  if (appointmentId) {
    // Wrong-patient/wrong-appointment guard: if an appointment is linked, it
    // must actually belong to this doctor AND this patient.
    const owned = await Appointment.exists({ _id: appointmentId, doctorId: doctor._id, patientId });
    if (!owned) throw new AppError("Appointment does not belong to this doctor/patient pair", 403);
  }

  const patientUser = await User.findById(patientId).select("name").lean();
  const doctorUser = await User.findById(req.user._id).select("name").lean();

  const certificate = await Certificate.create({
    doctorId: doctor._id,
    patientId,
    appointmentId: appointmentId || undefined,
    type,
    title: title.trim(),
    content: content || {},
  });
  certificate.pdfPath = await createCertificatePdf(certificate, patientUser?.name || "Patient", doctorUser?.name || "Doctor");
  await certificate.save();

  try {
    await clinicalEmitter.certificateCreated(doctor._id, patientId, certificate);
  } catch (error) {
    logger.warn("clinicalEmitter.certificateCreated failed", { message: error?.message });
  }

  res.status(201).json({ success: true, data: { certificate }, message: "Certificate issued successfully" });
});

export const downloadCertificate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const certificate = await Certificate.findOne({ _id: req.params.id, doctorId: doctor._id }).lean();
  if (!certificate?.pdfPath || !fs.existsSync(certificate.pdfPath)) throw new AppError("Certificate PDF not found", 404);
  res.download(certificate.pdfPath, `certificate-${certificate._id}.pdf`);
});

export const revokeCertificate = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const certificate = await Certificate.findOne({ _id: req.params.id, doctorId: doctor._id });
  if (!certificate) throw new AppError("Certificate not found", 404);
  certificate.status = "revoked";
  certificate.revokedReason = req.body.reason || "";
  await certificate.save();
  res.status(200).json({ success: true, data: { certificate }, message: "Certificate revoked successfully" });
});

// ── Doctor-scoped read access to a patient's lab/medical reports (Step 3) ──
// Previously doctors could only see report titles/categories via the
// patient-list aggregate (getDoctorPatients) with no way to actually open a
// file. This adds real, ownership-checked read access — a doctor can only
// list/download reports for a patient they have treated, never any patient.
export const getPatientReportsForDoctor = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  await ensureDoctorTreatedPatient(doctor._id, req.params.patientId);
  const reports = await MedicalReport.find({ userId: req.params.patientId })
    .sort({ reportDate: -1, createdAt: -1 })
    .limit(200)
    .lean();
  res.status(200).json({ success: true, data: { reports }, message: "Patient reports fetched successfully" });
});

export const downloadPatientReportForDoctor = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  await ensureDoctorTreatedPatient(doctor._id, req.params.patientId);
  const report = await MedicalReport.findOne({ _id: req.params.reportId, userId: req.params.patientId }).lean();
  if (!report?.filePath || !fs.existsSync(report.filePath)) throw new AppError("Report file not found", 404);
  res.download(report.filePath, report.fileName || `report-${report._id}`);
});

// ── Single-patient Clinical Snapshot (Step 3: Patient Snapshot/Timeline) ──
// Reuses the exact same aggregation pieces getDoctorPatients already
// computes, scoped to one patient, plus the appointment-linked reports and
// insurance now readable via the endpoints above. Never invents a value —
// any section with no underlying data returns an empty array/null, not a
// placeholder.
export const getPatientClinicalProfile = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const { patientId } = req.params;
  await ensureDoctorTreatedPatient(doctor._id, patientId);

  const [patient, appointments, prescriptions, notes, reports, insurance, family, certificates, reviews] = await Promise.all([
    User.findById(patientId).select("name email gender bloodGroup dateOfBirth patientProfile").lean(),
    Appointment.find({ doctorId: doctor._id, patientId }).sort({ date: -1, createdAt: -1 }).limit(50).lean(),
    Prescription.find({ doctorId: doctor._id, patientId }).sort({ createdAt: -1 }).limit(20).lean(),
    MedicalNote.find({ doctorId: doctor._id, patientId }).sort({ createdAt: -1 }).limit(20).lean(),
    MedicalReport.find({ userId: patientId }).sort({ reportDate: -1 }).limit(20).lean(),
    Insurance.find({ userId: patientId }).lean(),
    FamilyMember.find({ userId: patientId, isActive: { $ne: false } }).lean(),
    Certificate.find({ doctorId: doctor._id, patientId, status: "issued" }).sort({ createdAt: -1 }).limit(20).lean(),
    // PHASE P3 — this patient's real reviews of THIS doctor. Reuses the
    // existing Review model/fields exactly as doctorReviewController.js
    // does (no second review engine); scoped to doctorId+userId so a
    // doctor only ever sees this one patient's own reviews of them, never
    // another patient's or another doctor's.
    Review.find({ doctorId: doctor._id, userId: patientId, adminDeleted: { $ne: true } })
      .select("rating comment doctorReply isPinned createdAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  if (!patient) throw new AppError("Patient not found", 404);

  const outstandingBills = await Payment.find({ userId: patientId, status: { $in: ["pending", "failed"] } }).select("amount status createdAt").lean();

  // Timeline: merge appointment/prescription/note/report events into one
  // real, date-sorted list — no synthetic events.
  const timeline = [
    ...appointments.map((a) => ({ kind: "appointment", date: a.date, status: a.status, id: a._id, appointmentType: a.appointmentType })),
    ...prescriptions.map((p) => ({ kind: "prescription", date: p.createdAt, id: p._id })),
    ...notes.map((n) => ({ kind: "note", date: n.createdAt, id: n._id })),
    ...reports.map((r) => ({ kind: "report", date: r.reportDate || r.createdAt, id: r._id, category: r.category })),
    ...certificates.map((c) => ({ kind: "certificate", date: c.createdAt, id: c._id, type: c.type })),
    // PHASE P3 — real patient feedback event, not fabricated: only appears
    // when this patient has actually left a review for this doctor.
    ...reviews.map((r) => ({
      kind: "review",
      date: r.createdAt,
      id: r._id,
      rating: r.rating,
      hasReply: Boolean(r.doctorReply?.message),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // ── PHASE DOC-03 additions (additive only — every existing field above
  // is untouched, so PatientSnapshot/ClinicalTimeline and any other
  // existing consumer keep working unchanged). Real Attention/Communication
  // data for the Patient Relationship Center, computed from the same data
  // already gathered above plus one small batched, indexed query for
  // unread messages — never fabricated. ──
  const now = Date.now();
  const nonCancelled = appointments.filter((a) => a.status !== "cancelled");
  const lastVisit = nonCancelled.filter((a) => new Date(a.date).getTime() <= now).sort((a, b) => new Date(b.date) - new Date(a.date))[0]?.date || null;
  const nextVisit = nonCancelled.filter((a) => new Date(a.date).getTime() > now).sort((a, b) => new Date(a.date) - new Date(b.date))[0]?.date || null;
  const latestPainLevel = nonCancelled.find((a) => new Date(a.date).getTime() <= now)?.painLevel ?? null;

  const allergies = [...new Set([...(patient.patientProfile?.allergies || []), ...appointments.flatMap((a) => a.allergies || [])])];
  // Phase DOC-07 final pass: a follow-up already turned into a real
  // scheduled Appointment is done, not pending — same exclusion the
  // dashboard's Follow-up Queue applies, so this patient's status card and
  // the dashboard never disagree about whether a follow-up is still owed.
  const followUp = resolveFollowUpState({
    followUpDates: prescriptions.filter((p) => !p.followUpScheduledAppointmentId).map((p) => p.followUpDate),
    lastVisit,
    now,
  });
  // PHASE P10 — the other half of the loop resolveFollowUpState above
  // doesn't track (see resolveScheduledFollowUps' header comment). Reuses
  // the `appointments` array already fetched for this same patient/doctor
  // pair above — no second query, and the appointment can never disagree
  // with what the Appointments tab itself would show for the same id.
  const scheduledFollowUps = resolveScheduledFollowUps(
    prescriptions
      .filter((p) => p.followUpScheduledAppointmentId)
      .map((p) => ({
        prescription: p,
        appointment: appointments.find((a) => String(a._id) === String(p.followUpScheduledAppointmentId)),
      })),
    now,
  );
  const riskLevel = computeRiskLevel({
    painLevel: latestPainLevel,
    conditionCount: (patient.patientProfile?.medicalConditions || []).length,
    allergyCount: allergies.length,
  });

  const activeInsurance = insurance.find((i) => isInsuranceExpiringSoon(i.validTill, now)) || null;
  const outstandingAmount = outstandingBills.reduce((sum, b) => sum + (b.amount || 0), 0);
  // PHASE P6 — real persisted review state, zero extra queries (reports
  // already fetched above for the timeline/reports card).
  const unreviewedReports = reports.filter((r) => !r.reviewedAt).length;

  const unreadMessages = await ChatMessage.countDocuments({
    conversationKey: roomManager.conversationKey(req.user._id, patientId),
    recipientId: req.user._id,
    readAt: null,
  });
  const lastMessage = await ChatMessage.findOne({
    conversationKey: roomManager.conversationKey(req.user._id, patientId),
  })
    .sort({ createdAt: -1 })
    .select("body senderId createdAt readAt")
    .lean();

  const attentionItems = computeDoctorPatientAttentionItems({
    followUp,
    scheduledFollowUps,
    nextVisit,
    allergies,
    insurance: activeInsurance ? { expiringSoon: true, validTill: activeInsurance.validTill } : null,
    outstandingAmount,
    unreadMessages,
    unreviewedReports,
  });

  // PHASE P6 — Since Last Visit + Medication Reconciliation. Reuses the
  // exact appointments/prescriptions/reports/certificates/followUp already
  // fetched/computed above — zero additional queries. Real data only; see
  // clinicalComparisonService.js for the "comparison unavailable" fallback.
  const sinceLastVisit = buildSinceLastVisitComparison({ appointments, prescriptions, reports, certificates, followUp });
  const medicationReconciliation = buildMedicationReconciliation(prescriptions);

  // PHASE P6 (gap-closure) — Open Clinical Actions. Reuses the exact
  // appointments/reports/followUp already computed above (zero extra
  // queries). "Awaiting completion" mirrors the frontend's own filter
  // (status === consultation_completed) so the two never disagree.
  const consultationAwaitingCompletion = appointments.filter((a) => a.status === "consultation_completed");
  const openClinicalActions = buildOpenClinicalActions({ followUp, reports, consultationAwaitingCompletion, scheduledFollowUps });

  res.status(200).json({
    success: true,
    data: {
      patient,
      allergies,
      chronicConditions: patient.patientProfile?.medicalConditions || [],
      currentMedications: patient.patientProfile?.medications || [],
      vitals: patient.patientProfile?.vitals || null,
      appointments,
      prescriptions,
      notes,
      reports,
      insurance,
      family,
      certificates,
      reviews,
      outstandingBills,
      timeline,
      // DOC-03 additions:
      lastVisit,
      nextVisit,
      followUp,
      scheduledFollowUps,
      riskLevel,
      attentionItems,
      unreadMessages,
      lastMessage,
      unreviewedReports,
      sinceLastVisit,
      medicationReconciliation,
      openClinicalActions,
    },
    message: "Patient clinical profile fetched successfully",
  });
});

// PHASE P6 — Report Review workflow. MedicalReport already has
// reviewedAt/reviewedBy (Phase D5) and a doctor-owned review endpoint
// already exists in commandCenterController.js, but it's scoped to
// `report.doctorId === this doctor`, which is only set when a patient
// explicitly tags a report to a doctor at upload time. A report the doctor
// can legitimately see here (via ensureDoctorTreatedPatient, same guard as
// getPatientReportsForDoctor) could still 404 on that stricter check. This
// is a second, correctly-scoped entry point for the SAME persisted fields
// — not a duplicate review engine, not a second status model.
export const markPatientReportReviewed = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const { patientId, reportId } = req.params;
  await ensureDoctorTreatedPatient(doctor._id, patientId);

  const report = await MedicalReport.findOneAndUpdate(
    { _id: reportId, userId: patientId },
    { reviewedAt: new Date(), reviewedBy: req.user._id },
    { new: true },
  ).lean();
  if (!report) throw new AppError("Report not found for this patient", 404);

  try {
    clinicalEmitter.reportReviewed(doctor._id, patientId, report);
  } catch (error) {
    logger.warn("clinicalEmitter.reportReviewed failed", { message: error?.message });
  }

  res.status(200).json({ success: true, data: { report }, message: "Report marked as reviewed" });
});

// ── PHASE DOC-07 FINAL PASS — Follow-up → Real Scheduling ──
// Turns a Follow-up Work Queue item into an actual, persisted Appointment,
// reusing the exact patient-booking availability engine (ensureDoctorAvailable
// + findBlockedDate from appointmentController.js, generateDaySlots underneath
// that) so a slot the doctor picks here can never disagree with what the
// Today/Week/Month capacity views or a patient's own booking flow would say
// about that same slot. No second scheduling engine, no fake "success"
// response — this either creates a real Appointment document or throws a
// real, specific error (no availability / leave / blocked / conflict).
export const scheduleFollowUpAppointment = asyncHandler(async (req, res) => {
  const doctorProfile = await getDoctorProfile(req.user._id);
  const { patientId } = req.params;
  const { date: dateInput, timeSlot, consultationMode, reason, prescriptionId } = req.body;

  if (!timeSlot) throw new AppError("A time slot is required", 400);
  if (!dateInput || Number.isNaN(Date.parse(dateInput))) throw new AppError("A valid date is required", 400);

  // Wrong-patient guard: a doctor may only schedule a follow-up for a
  // patient they have an actual appointment history with — same guard the
  // certificate/report endpoints already use.
  await ensureDoctorTreatedPatient(doctorProfile._id, patientId);

  const doctor = await Doctor.findById(doctorProfile._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);

  // PHASE P10 (hardened) — real backend duplicate-prevention (brief §11),
  // made safe under concurrent requests.
  //
  // The original version here (find existing link → later, after creating
  // a brand new Appointment, set the link) had a genuine race: two
  // concurrent requests can both read "no active link" before either has
  // written anything, and both go on to create a REAL Appointment document
  // — the duplication is at the Appointment-creation step, not at the
  // Prescription field (a single field can never literally hold two
  // values at once, so the field itself was never the unsafe part).
  //
  // Fix: atomically CLAIM the prescription — using a MongoDB
  // findOneAndUpdate with a precondition on the current state — for a
  // pre-generated appointment id BEFORE the real Appointment document is
  // created. A single-document findOneAndUpdate is atomic in MongoDB
  // regardless of deployment topology (this does not require a replica
  // set or multi-document transactions, neither of which this project's
  // standalone `mongo:7` deployment — see docker-compose.yml — supports;
  // every other race-condition fix in this codebase, e.g. the
  // doctorId+date+timeSlot unique partial index on Appointment, uses the
  // exact same single-document-atomicity idiom rather than transactions).
  // Whichever concurrent request's claim lands first wins; the other's
  // conditional filter simply no longer matches, so it is rejected before
  // ever creating a second real Appointment — no duplicate is ever
  // observable, not even transiently.
  let followUpAppointmentId; // pre-generated so the claim can reference it before the real doc exists
  let claimedPrescription = false;
  if (prescriptionId) {
    const scopedFilter = { _id: prescriptionId, doctorId: doctor._id, patientId };

    // Self-heal (defense in depth, not the enforcement mechanism itself):
    // if the current link points at an appointment that's already
    // cancelled — expected to have been cleared by cancelAppointmentCore's
    // own atomic unlink already — clear it proactively here too, scoped so
    // it can only ever clear the SPECIFIC stale id it just observed (never
    // clobbers a fresh concurrent claim).
    const current = await Prescription.findOne(scopedFilter).select("followUpScheduledAppointmentId").lean();
    if (!current) throw new AppError("Prescription not found for this patient", 404);
    if (current.followUpScheduledAppointmentId) {
      const linked = await Appointment.findById(current.followUpScheduledAppointmentId).select("status").lean();
      if (linked && linked.status === APPOINTMENT_STATUS.CANCELLED) {
        await Prescription.updateOne(
          { ...scopedFilter, followUpScheduledAppointmentId: current.followUpScheduledAppointmentId },
          { $unset: { followUpScheduledAppointmentId: "" }, $set: { followUpCancelledAt: new Date() } },
        );
      }
    }

    followUpAppointmentId = new mongoose.Types.ObjectId();
    const claim = await claimFollowUpSlot(Prescription, {
      prescriptionId,
      doctorId: doctor._id,
      patientId,
      appointmentId: followUpAppointmentId,
    });
    if (!claim) {
      // The scoped-existence check above already confirmed the
      // prescription is real and belongs to this doctor/patient, so a
      // failed claim here means exactly one thing: someone (this request's
      // loser in a race, or an earlier already-active schedule) still
      // holds an active link.
      throw new AppError("This follow-up recommendation already has an active scheduled appointment.", 409, { code: "FOLLOWUP_ALREADY_SCHEDULED" });
    }
    claimedPrescription = true;
  }

  const date = normalizeDate(dateInput);
  const today = normalizeDate(new Date());
  if (date < today) throw new AppError("Past dates are not allowed", 400);

  // Real availability check — throws the same specific errors a patient
  // booking would get (not a working day / blocked date).
  ensureDoctorAvailable(doctor, date, timeSlot);

  const activeLeave = await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: "approved",
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).lean();
  if (activeLeave) throw new AppError("You are on approved leave for this date", 409);

  const conflicting = await Appointment.findOne({
    doctorId: doctor._id,
    date,
    timeSlot,
    status: { $in: ACTIVE_STATUSES },
  }).lean();
  if (conflicting) throw new AppError("You already have an appointment booked in this slot", 409);

  // Same Doctor->Appointment consultation-mode contract as patient booking
  // (see backend/constants/consultationMode.js) — this endpoint accepts a
  // raw Doctor-producer value and must canonicalize it before storing,
  // never trusting the client's claim of which modes are actually offered.
  let canonicalConsultationMode = "";
  if (consultationMode) {
    if (!isKnownDoctorConsultationMode(consultationMode)) {
      throw new AppError("Consultation mode must be 'online', 'offline', or 'home_visit'", 400);
    }
    const offeredModes = doctor.consultationMode || [];
    if (!offeredModes.includes(consultationMode)) {
      throw new AppError(`You do not offer ${consultationMode.replace("_", " ")} consultations`, 400);
    }
    canonicalConsultationMode = canonicalizeConsultationMode(consultationMode);
  }

  let appointment;
  try {
    appointment = await Appointment.create({
      // PHASE P10 — pre-generated above (when a prescriptionId is given)
      // so the atomic Prescription claim could reference this exact id
      // before this document existed. Omitted entirely for an
      // ad-hoc/no-prescription follow-up, in which case Mongo assigns one
      // as normal.
      ...(followUpAppointmentId ? { _id: followUpAppointmentId } : {}),
      patientId,
      doctorId: doctor._id,
      date,
      timeSlot,
      consultationMode: canonicalConsultationMode,
      reason: reason || "Follow-up consultation",
      status: APPOINTMENT_STATUS.APPROVED, // doctor-initiated — no patient approval step needed
      bookedBy: "doctor",
      appointmentType: "follow_up",
    });
  } catch (error) {
    // PHASE P10 — the prescription may already hold a claim on
    // followUpAppointmentId from the atomic claim above; if the real
    // Appointment document never actually gets created (slot conflict,
    // validation error, anything), that claim must not be left dangling —
    // it would otherwise permanently and incorrectly block every future
    // scheduling attempt for this prescription with a 409 for an
    // appointment that doesn't exist. Scoped to the exact id we claimed,
    // so this can never clear a different, legitimate concurrent claim.
    if (claimedPrescription) {
      await Prescription.updateOne(
        { _id: prescriptionId, doctorId: doctor._id, patientId, followUpScheduledAppointmentId: followUpAppointmentId },
        { $unset: { followUpScheduledAppointmentId: "" } },
      ).catch((unclaimError) =>
        logger.error("Failed to roll back follow-up prescription claim after appointment creation failed", {
          message: unclaimError?.message,
          prescriptionId,
          followUpAppointmentId,
        }),
      );
    }
    // Same real DB-level race-condition guarantee createAppointment relies
    // on (unique partial index on doctorId+date+timeSlot for active
    // statuses) — translated into a structured conflict, never a raw 500.
    if (error?.code === 11000) {
      throw new AppError("That slot was just booked. Please choose another time.", 409, { code: "SLOT_CONFLICT" });
    }
    throw error;
  }

  // No separate "link the prescription" step needed here — the atomic
  // claim above already set Prescription.followUpScheduledAppointmentId to
  // this exact appointment's id before it was created.

  const populatedAppointment = await appointment.populate([
    { path: "patientId", select: "name email role" },
    { path: "doctorId", select: "specialization fees rating userId", populate: { path: "userId", select: "name email role" } },
  ]);

  // Reuse the exact same realtime + notification path a patient's own
  // booking goes through — patient sees the appointment, doctor's own
  // dashboard/schedule refresh via the same dashboardSyncTick pattern, no
  // second notification engine.
  try {
    await appointmentEmitter.created(populatedAppointment);
  } catch (error) {
    logger.warn("appointmentEmitter.created failed for follow-up scheduling", { message: error?.message, appointmentId: populatedAppointment?._id });
  }

  res.status(201).json({ success: true, data: { appointment: populatedAppointment }, message: "Follow-up appointment scheduled successfully" });
});

// GET /api/doctor/workflow/schedule/range?startDate=&endDate= — Phase DOC-07
// final pass. Week/Month view intelligence: the SAME buildDayCapacity engine
// getScheduleDay uses, run once per date in the requested range, with all
// appointments/leave for the whole range fetched up front (2 queries total,
// not one query per day) so this never turns into an N+1 scan. Bounded to 31
// days so a mistaken multi-year range can't be requested.
export const MAX_RANGE_DAYS = 31;

// Pure, DB-free — extracted so the boundary arithmetic (inclusive day count,
// endDate-before-startDate) is unit-testable without MongoDB, matching the
// project's established pattern (slotEngine.js / capacityAggregates.js).
export const countInclusiveDays = (startDate, endDate) =>
  Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

export const getScheduleRange = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);

  const { startDate: startInput, endDate: endInput } = req.query;
  if (!startInput || Number.isNaN(Date.parse(startInput))) throw new AppError("A valid startDate is required", 400);
  if (!endInput || Number.isNaN(Date.parse(endInput))) throw new AppError("A valid endDate is required", 400);

  const startDate = normalizeDate(startInput);
  const endDate = normalizeDate(endInput);
  if (endDate < startDate) throw new AppError("endDate must be on or after startDate", 400);

  const dayCount = countInclusiveDays(startDate, endDate);
  if (dayCount > MAX_RANGE_DAYS) throw new AppError(`Range cannot exceed ${MAX_RANGE_DAYS} days`, 400);

  const today = normalizeDate(new Date());

  const [approvedLeaves, rangeAppointments] = await Promise.all([
    LeaveRequest.find({
      doctorId: doctor._id,
      status: "approved",
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    }).select("startDate endDate reason").lean(),
    Appointment.find({ doctorId: doctor._id, date: { $gte: startDate, $lte: endDate } })
      .populate("patientId", "name")
      .select("date timeSlot status consultationMode patientId")
      .lean(),
  ]);

  const appointmentsByDate = new Map();
  for (const appt of rangeAppointments) {
    const key = appt.date.toISOString().slice(0, 10);
    const list = appointmentsByDate.get(key) || [];
    list.push({
      timeSlot: appt.timeSlot,
      status: appt.status,
      appointmentId: appt._id,
      patientName: appt.patientId?.name || "Patient",
      consultationMode: appt.consultationMode,
    });
    appointmentsByDate.set(key, list);
  }

  const isOnLeave = (date) =>
    approvedLeaves.find((leave) => new Date(leave.startDate) <= date && new Date(leave.endDate) >= date);

  const days = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const candidate = new Date(startDate);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    const dateKey = candidate.toISOString().slice(0, 10);

    const blockedDate = findBlockedDate(doctor, candidate);
    const leave = isOnLeave(candidate);
    const dayConfig = doctor.availability?.find((slot) => slot.dayOfWeek === getDayOfWeek(candidate)) || null;

    const capacity = buildDayCapacity({
      dayConfig,
      appointments: appointmentsByDate.get(dateKey) || [],
      blockedReason: blockedDate?.reason || null,
      leaveReason: leave?.reason || null,
      isPastDate: candidate < today,
    });

    days.push({
      date: dateKey,
      isToday: candidate.getTime() === today.getTime(),
      isPastDate: candidate < today,
      ...capacity,
    });
  }

  res.status(200).json({
    success: true,
    data: { startDate: startInput, endDate: endInput, days },
    message: "Schedule range fetched successfully",
  });
});

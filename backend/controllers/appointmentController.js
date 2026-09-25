import { containsRegex } from "../utils/regexSafe.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import FamilyMember from "../models/FamilyMember.js";
import {
  ACTIVE_STATUSES,
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_VALUES,
  CANCELLABLE_STATUSES,
  PAYMENT_STATUS,
  STATUS_TRANSITIONS,
} from "../constants/appointmentStatus.js";
import { cancelAppointmentCore } from "../services/appointmentCancellationService.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { emailService } from "../services/emailService.js";
import { appointmentEmitter } from "../realtime/appointmentEmitter.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";
import {
  validateAppointmentCreate,
  validateAppointmentStatusUpdate,
} from "../validations/appointmentValidation.js";
import LeaveRequest from "../models/LeaveRequest.js";
import Insurance from "../models/Insurance.js";
import MedicalNote from "../models/MedicalNote.js";
import MedicalReport from "../models/MedicalReport.js";
import { LEGAL_DOCUMENTS } from "../../shared/legalDocuments.js";
import Prescription from "../models/Prescription.js";
import { generateDaySlots } from "../utils/slotEngine.js";
import { buildDayCapacity, dayHasAvailability } from "../utils/capacityAggregates.js";
import { logger } from "../utils/logger.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { buildAttentionMatch, computeNeedsAttention } from "../utils/appointmentAttention.js";
import User from "../models/User.js";
import { appendAppointmentHistory } from "../services/appointmentHistoryService.js";
import {
  canonicalizeConsultationMode,
  isKnownDoctorConsultationMode,
} from "../constants/consultationMode.js";
import { enforceAppointmentBookingPolicy } from "../services/appointmentBookingPolicyService.js";
import { getAppointmentLimits } from "../services/hospitalSettingsService.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// Exported (Phase DOC-07 final pass) so doctor-initiated booking (follow-up
// scheduling in workflowController.js) can reuse the EXACT same
// availability/blocked-date checks a patient booking goes through, instead
// of a second scheduling engine being written for the doctor side.
export const getDayOfWeek = (date) =>
  date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();

export const normalizeDate = (dateValue) => {
  const date = new Date(dateValue);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

// Single source of truth for "is this date blocked on the doctor's calendar" —
// previously implemented independently in ensureDoctorAvailable AND
// getAvailableSlots. Now also reused by updateAppointmentStatus's approval
// re-check (see below), and by doctor-initiated follow-up scheduling.
export const findBlockedDate = (doctor, date) =>
  doctor.blockedDates?.find((item) => {
    const bd = new Date(item.date);
    bd.setUTCHours(0, 0, 0, 0);
    return bd.getTime() === date.getTime();
  });

export const ensureDoctorAvailable = (doctor, date, timeSlot) => {
  const dayOfWeek = getDayOfWeek(date);
  const dayAvailability = doctor.availability.find((slot) => slot.dayOfWeek === dayOfWeek);

  // generateDaySlots handles both legacy manually-typed slots AND structured
  // (startTime/endTime/duration/buffer/breaks) schedules with the same logic
  // used to show the patient their options, so what they picked is guaranteed
  // to be something that was actually offered.
  const validSlots = generateDaySlots(dayAvailability);
  if (!dayAvailability || !validSlots.includes(timeSlot)) {
    throw new AppError("Doctor is not available on this day/time", 409);
  }

  const blockedDate = findBlockedDate(doctor, date);
  if (blockedDate) {
    throw new AppError(blockedDate.reason || "Doctor is unavailable on selected date", 409);
  }
};

// Pure, dependency-free date-range filter builder — extracted so it's unit
// testable without a DB connection, mirroring the same validation
// admin/appointmentAdminController.buildListFilter already uses. Returns
// {} (no-op) when neither dateFrom/dateTo/quickDate is present or valid.
//
// BUGFIX (Phase DOC-04 audit): admin's buildListFilter independently grew a
// quickDate=today/upcoming/past shortcut that this endpoint never got, so
// the Doctor Appointments rebuild had no server-side way to ask for "just
// today" or "just upcoming" without downloading everything and filtering in
// memory. Added here (dateFrom/dateTo still take priority when present, so
// existing callers/tests passing only dateFrom/dateTo are unaffected byte
// for byte) instead of hand-copying admin's inline version a second time.
export const buildDateRangeFilter = (query = {}) => {
  if (query.dateFrom || query.dateTo) {
    const date = {};
    if (query.dateFrom && !Number.isNaN(Date.parse(query.dateFrom))) {
      const from = new Date(query.dateFrom);
      from.setUTCHours(0, 0, 0, 0);
      date.$gte = from;
    }
    if (query.dateTo && !Number.isNaN(Date.parse(query.dateTo))) {
      const to = new Date(query.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      date.$lte = to;
    }
    return Object.keys(date).length ? { date } : {};
  }

  if (query.quickDate === "today" || query.quickDate === "upcoming" || query.quickDate === "past") {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    if (query.quickDate === "today") {
      const endOfToday = new Date(startOfToday);
      endOfToday.setUTCHours(23, 59, 59, 999);
      return { date: { $gte: startOfToday, $lte: endOfToday } };
    }
    if (query.quickDate === "upcoming") return { date: { $gte: startOfToday } };
    return { date: { $lt: startOfToday } };
  }

  return {};
};

// Pure-ish (one shared, index-backed query) patient-name/email search filter
// for the doctor/admin views of this shared endpoint. Extracted so the
// Doctor Appointments rebuild gets real server-side search instead of
// downloading a page and filtering in memory (which is what the old page
// did over its capped limit:200 fetch). Scoped to patients only (unlike
// admin's own resolveSearchFilter, which also matches doctor name — not
// useful here since the caller already knows which doctor they are).
export const resolvePatientSearchFilter = async (term) => {
  const regex = containsRegex(term);
  const matchingPatients = await User.find({ role: "patient", $or: [{ name: regex }, { email: regex }] })
    .select("_id")
    .lean();
  return { patientId: { $in: matchingPatients.map((p) => p._id) } };
};

const buildRoleBasedFilter = async (req) => {
  if (ADMIN_ROLES.includes(req.user.role)) return {};

  if (req.user.role === ROLES.PATIENT) {
    return { patientId: req.user._id };
  }

  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await ensureDoctorProfileForUser(req.user);
    return { doctorId: doctor._id };
  }

  throw new AppError("Unsupported appointment access role", 403);
};

// GET /api/appointments/available-slots?doctorId=&date=
// Additive endpoint (does not replace or remove any existing route).
// Returns the exact set of slots a patient is allowed to book for a given
// doctor + date, having already removed: past dates, blocked dates, approved
// leave, and slots that are already taken by an active appointment.
export const getAvailableSlots = asyncHandler(async (req, res) => {
  const { doctorId, date: dateParam } = req.query;

  if (!doctorId || !mongoose.Types.ObjectId.isValid(doctorId)) {
    throw new AppError("A valid doctorId is required", 400);
  }
  if (!dateParam || Number.isNaN(Date.parse(dateParam))) {
    throw new AppError("A valid date is required", 400);
  }

  const doctor = await Doctor.findById(doctorId)
    .populate({ path: "userId", select: "role isActive", match: { role: ROLES.DOCTOR, isActive: true } })
    .lean();
  if (!doctor || !doctor.userId) throw new AppError("Doctor profile not found", 404);
  if (!doctor.isVerified || doctor.verificationStatus !== "approved" || !doctor.isActive) {
    throw new AppError("Doctor is not approved for appointments", 403);
  }

  const date = normalizeDate(dateParam);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (date < today) {
    return res.status(200).json({ success: true, data: { slots: [], reason: "past_date" }, message: "No slots available for a past date" });
  }

  // Appointment Engine Remediation (2026-09-24): keep this display endpoint
  // consistent with the now-enforced server-side booking window
  // (HospitalSetting.appointmentLimits.bookingWindowDays) so a patient
  // never sees "available" slots that createAppointment would then reject
  // — mirrors the past_date short-circuit immediately above rather than
  // letting the two disagree.
  const { bookingWindowDays } = await getAppointmentLimits();
  const maxBookableDate = new Date(today);
  maxBookableDate.setUTCDate(maxBookableDate.getUTCDate() + bookingWindowDays);
  if (date > maxBookableDate) {
    return res.status(200).json({
      success: true,
      data: { slots: [], reason: "beyond_booking_window", bookingWindowDays },
      message: `Appointments can only be booked up to ${bookingWindowDays} days in advance`,
    });
  }

  const blockedDate = findBlockedDate(doctor, date);
  if (blockedDate) {
    return res.status(200).json({ success: true, data: { slots: [], reason: "blocked_date" }, message: blockedDate.reason || "Doctor is unavailable on this date" });
  }

  const activeLeave = await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: "approved",
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).lean();
  if (activeLeave) {
    return res.status(200).json({ success: true, data: { slots: [], reason: "on_leave" }, message: "Doctor is on approved leave for this date" });
  }

  const dayOfWeek = getDayOfWeek(date);
  const dayAvailability = doctor.availability?.find((slot) => slot.dayOfWeek === dayOfWeek);

  const takenAppointments = await Appointment.find({
    doctorId: doctor._id,
    date,
    status: { $in: ACTIVE_STATUSES }, // full lifecycle, not just pending/approved -- see ACTIVE_STATUSES
  })
    .select("timeSlot")
    .lean();
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const isToday = date.toISOString().slice(0, 10) === todayKey;
  const currentTimeMinutes = isToday
    ? now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60
    : null;

  const dayCapacity = buildDayCapacity({
    dayConfig: dayAvailability,
    appointments: takenAppointments.map((appointment) => ({
      timeSlot: appointment.timeSlot,
      status: "approved",
    })),
    blockedReason: null,
    leaveReason: null,
    isPastDate: false,
    currentTimeMinutes,
  });
  const availableSlots = dayCapacity.timeline
    .filter((item) => item.status === "available")
    .map((item) => item.slot);

  res.status(200).json({
    success: true,
    data: { slots: availableSlots, reason: availableSlots.length ? null : "fully_booked" },
    message: "Available slots fetched successfully",
  });
});

const MAX_NEXT_AVAILABLE_HORIZON_DAYS = 60;

// GET /api/appointments/next-available?doctorId=&fromDate=&horizonDays=
// Phase DOC-07 — real server-side "next available slot" search. Replaces the
// need for any caller to loop N sequential /available-slots requests
// client-side (the patient booking wizard's "Find Next Available" used to do
// exactly that, 14 requests in a row): one request here fetches the
// doctor's blocked dates (already on the doc), every approved leave, and
// every active appointment across the whole search window UP FRONT, then
// walks forward day-by-day in memory using the exact same buildDayCapacity
// engine the Doctor Today view uses — so "next available" can never
// disagree with what the doctor's own schedule shows for that same day.
// Bounded at MAX_NEXT_AVAILABLE_HORIZON_DAYS so this can never turn into an
// unbounded scan for a doctor with no near-term availability at all.
export const findNextAvailableSlotForDoctor = ({ doctor, approvedLeaves = [], windowAppointments = [], startFrom, horizonDays = MAX_NEXT_AVAILABLE_HORIZON_DAYS }) => {
  const appointmentsByDate = new Map();
  for (const appt of windowAppointments) {
    const key = new Date(appt.date).toISOString().slice(0, 10);
    const list = appointmentsByDate.get(key) || [];
    list.push({ timeSlot: appt.timeSlot, status: appt.status, appointmentId: appt._id });
    appointmentsByDate.set(key, list);
  }

  const isOnLeave = (date) =>
    approvedLeaves.find((leave) => new Date(leave.startDate) <= date && new Date(leave.endDate) >= date);

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const currentTimeMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const candidate = new Date(startFrom);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    const dateKey = candidate.toISOString().slice(0, 10);
    const blockedDate = findBlockedDate(doctor, candidate);
    const leave = isOnLeave(candidate);
    const dayAvailability = doctor.availability?.find((slot) => slot.dayOfWeek === getDayOfWeek(candidate));
    const dayCapacity = buildDayCapacity({
      dayConfig: dayAvailability,
      appointments: appointmentsByDate.get(dateKey) || [],
      blockedReason: blockedDate?.reason || null,
      leaveReason: leave?.reason || null,
      isPastDate: dateKey < todayKey,
      currentTimeMinutes: dateKey === todayKey ? currentTimeMinutes : null,
    });
    if (dayHasAvailability(dayCapacity)) {
      const availableSlots = dayCapacity.timeline.filter((t) => t.status === "available").map((t) => t.slot);
      return { date: dateKey, nextSlot: availableSlots[0], slots: availableSlots };
    }
  }
  return { date: null, nextSlot: null, slots: [] };
};

export const getNextAvailableSlot = asyncHandler(async (req, res) => {
  const { doctorId } = req.query;
  if (!doctorId || !mongoose.Types.ObjectId.isValid(doctorId)) {
    throw new AppError("A valid doctorId is required", 400);
  }
  const doctor = await Doctor.findById(doctorId).lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  // Availability of an unpublished doctor is not bookable and must not be probed.
  if (req.user?.role !== ROLES.SUPER_ADMIN && (!doctor.isVerified || doctor.verificationStatus !== "approved" || !doctor.isActive)) {
    throw new AppError("Doctor is not approved for appointments", 403);
  }
  const horizonDays = Math.min(Math.max(Number(req.query.horizonDays) || MAX_NEXT_AVAILABLE_HORIZON_DAYS, 1), MAX_NEXT_AVAILABLE_HORIZON_DAYS);
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const requestedStart = req.query.fromDate && !Number.isNaN(Date.parse(req.query.fromDate))
    ? normalizeDate(req.query.fromDate)
    : today;
  const startFrom = requestedStart < today ? today : requestedStart;
  const rangeEnd = new Date(startFrom);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + horizonDays);
  const [approvedLeaves, windowAppointments] = await Promise.all([
    LeaveRequest.find({ doctorId: doctor._id, status: "approved", startDate: { $lte: rangeEnd }, endDate: { $gte: startFrom } }).select("startDate endDate").lean(),
    Appointment.find({ doctorId: doctor._id, date: { $gte: startFrom, $lte: rangeEnd }, status: { $in: ACTIVE_STATUSES } }).select("date timeSlot status").lean(),
  ]);
  const result = findNextAvailableSlotForDoctor({ doctor, approvedLeaves, windowAppointments, startFrom, horizonDays });
  res.status(200).json({ success: true, data: result, message: result.date ? "Next available slot found" : `No availability found in the next ${horizonDays} days` });
});

export const createAppointment = asyncHandler(async (req, res) => {
  // ── Consultation Mode Contract (Appointment Regression Repair) ──
  // The patient booking UI reads consultationMode straight off the Doctor
  // document and submits it verbatim, so the value on the wire here is a
  // Doctor-producer value ("online" | "offline" | "home_visit") — NOT the
  // canonical Appointment value validateAppointmentCreate/the Appointment
  // schema expect. Canonicalize before validation ever sees it, and reject
  // outright (never silently allow) anything outside the known producer
  // vocabulary. See backend/constants/consultationMode.js.
  let canonicalConsultationMode = "";
  if (req.body.consultationMode) {
    if (!isKnownDoctorConsultationMode(req.body.consultationMode)) {
      throw new AppError("Validation failed", 400, {
        consultationMode: "Consultation mode must be 'online', 'offline', or 'home_visit'",
      });
    }
    canonicalConsultationMode = canonicalizeConsultationMode(req.body.consultationMode);
  }

  const validation = validateAppointmentCreate({ ...req.body, consultationMode: canonicalConsultationMode });
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);

  const bookingRequestId = typeof req.body.bookingRequestId === "string" ? req.body.bookingRequestId.trim() : "";
  if (bookingRequestId) {
    const existingByRequest = await Appointment.findOne({ bookingRequestId }).populate([
      { path: "patientId", select: "name email role" },
      { path: "doctorId", select: "specialization fees rating userId", populate: { path: "userId", select: "name email role" } },
    ]);
    if (existingByRequest) {
      if (existingByRequest.patientId?._id?.toString() !== req.user._id.toString()) {
        throw new AppError("This booking request identifier is not available", 409);
      }
      return res.status(200).json({ success: true, data: existingByRequest, message: "Existing appointment returned safely" });
    }
  }

  const doctor = await Doctor.findById(req.body.doctorId)
    .populate({ path: "userId", select: "role isActive", match: { role: ROLES.DOCTOR, isActive: true } })
    .lean();
  if (!doctor || !doctor.userId) throw new AppError("Doctor profile not found", 404);

  if (!doctor.isVerified || doctor.verificationStatus !== "approved" || !doctor.isActive) {
    throw new AppError("Doctor is not approved for appointments", 403);
  }

  const appointmentDate = normalizeDate(req.body.date);

  // Canonical, server-authoritative timing/window policy (Appointment
  // Engine Remediation, 2026-09-24) — see appointmentBookingPolicyService.js.
  // Replaces the previous date-only comparison, which could not catch a
  // past TIME on today's date (e.g. booking 09:00 when the real server
  // time is already 12:00 the same day).
  await enforceAppointmentBookingPolicy({
    date: appointmentDate,
    timeSlot: req.body.timeSlot,
    doctorId: doctor._id,
  });

  ensureDoctorAvailable(doctor, appointmentDate, req.body.timeSlot);

  const activeLeave = await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: "approved",
    startDate: { $lte: appointmentDate },
    endDate: { $gte: appointmentDate },
  });
  if (activeLeave) throw new AppError("Doctor is on approved leave for this date", 409);

  const existingAppointment = await Appointment.findOne({
    doctorId: doctor._id,
    date: appointmentDate,
    timeSlot: req.body.timeSlot,
    status: { $in: ACTIVE_STATUSES }, // full lifecycle, not just pending/approved -- see ACTIVE_STATUSES
  }).lean();
  if (existingAppointment) throw new AppError("This doctor is already booked for the selected slot", 409);

  let familyMemberId;
  if (req.body.familyMemberId) {
    const familyMember = await FamilyMember.findOne({
      _id: req.body.familyMemberId,
      userId: req.user._id,
      isActive: true,
    }).lean();
    if (!familyMember) throw new AppError("Family member was not found for this patient account", 403);
    familyMemberId = familyMember._id;
  }

  // Appointment Journey — consultation mode must be one the doctor actually
  // offers (Doctor.consultationMode), never trust the client's claim alone.
  // Compared against the RAW producer value the client sent (Doctor.
  // consultationMode is stored in that vocabulary), not the canonical value.
  if (req.body.consultationMode) {
    const offeredModes = doctor.consultationMode || [];
    if (!offeredModes.includes(req.body.consultationMode)) {
      throw new AppError(
        `This doctor does not offer ${req.body.consultationMode.replace("_", " ")} consultations`,
        400,
      );
    }
  }

  // Ownership check: a patient may only attach their OWN insurance policy.
  let insuranceId;
  if (req.body.insuranceId) {
    const insurance = await Insurance.findOne({
      _id: req.body.insuranceId,
      userId: req.user._id,
    }).lean();
    if (!insurance) throw new AppError("Insurance policy was not found for this patient account", 403);
    insuranceId = insurance._id;
  }

  // Ownership check: a patient may only attach reports from their OWN library.
  let reportIds;
  if (Array.isArray(req.body.reportIds) && req.body.reportIds.length > 0) {
    const ownedReports = await MedicalReport.find({
      _id: { $in: req.body.reportIds },
      userId: req.user._id,
    })
      .select("_id")
      .lean();
    if (ownedReports.length !== req.body.reportIds.length) {
      throw new AppError("One or more reports were not found for this patient account", 403);
    }
    reportIds = ownedReports.map((report) => report._id);
  }

  if (req.body.consentAccepted !== true) {
    throw new AppError("Booking confirmation requires acknowledgement of the applicable terms and privacy notice", 400, {
      consentAccepted: "Required",
    });
  }

  const duplicateBooking = await Appointment.findOne({
    patientId: req.user._id,
    doctorId: doctor._id,
    date: appointmentDate,
    timeSlot: req.body.timeSlot,
    status: { $in: ACTIVE_STATUSES }, // full lifecycle, not just pending/approved -- see ACTIVE_STATUSES
  });
  if (duplicateBooking) throw new AppError("You already have an appointment with this doctor on this date", 409);

  let appointment;
  try {
    appointment = await Appointment.create({
    patientId: req.user._id,
    familyMemberId,
    doctorId: doctor._id,
    date: appointmentDate,
    timeSlot: req.body.timeSlot,
    notes: req.body.notes || "",
    consultationMode: canonicalConsultationMode,
    reason: req.body.reason || "",
    symptoms: Array.isArray(req.body.symptoms) ? req.body.symptoms : [],
    symptomDuration: req.body.symptomDuration || "",
    painLevel:
      req.body.painLevel !== undefined && req.body.painLevel !== null && req.body.painLevel !== ""
        ? Number(req.body.painLevel)
        : undefined,
    hasPreviousConsultation: Boolean(req.body.hasPreviousConsultation),
    existingConditions: Array.isArray(req.body.existingConditions) ? req.body.existingConditions : [],
    currentMedications: Array.isArray(req.body.currentMedications) ? req.body.currentMedications : [],
    allergies: Array.isArray(req.body.allergies) ? req.body.allergies : [],
    preferredLanguage: req.body.preferredLanguage || "",
    specialAssistance: req.body.specialAssistance || "",
    emergencyContact: {
      name: req.body.emergencyContact?.name || "",
      phone: req.body.emergencyContact?.phone || "",
    },
    insuranceId,
    reportIds,
    bookingRequestId: bookingRequestId || undefined,
    legalConsent: {
      acceptedAt: new Date(),
      termsVersion: LEGAL_DOCUMENTS.terms.version,
      privacyPolicyVersion: LEGAL_DOCUMENTS.privacy.version,
      medicalDisclaimerVersion: LEGAL_DOCUMENTS.medicalDisclaimer.version,
    },
    });
    appendAppointmentHistory({
      appointment,
      status: appointment.status,
      actorId: req.user._id,
      actorRole: req.user.role || "patient",
      reason: "Appointment requested",
    });
    await appointment.save();
  } catch (error) {
    // Real double-booking protection (DOC-07 §10): the findOne conflict
    // check above is a best-effort pre-check, not the actual guarantee —
    // two requests can both pass it in the same instant. The Appointment
    // schema's unique partial index (doctorId+date+timeSlot, active
    // statuses only) is the real, DB-level guarantee, and it throws a
    // MongoDB E11000 duplicate-key error when a race is lost. Translate
    // that into the structured, friendly conflict this phase requires
    // instead of letting a raw Mongo error reach the patient.
    if (error?.code === 11000) {
      if (bookingRequestId) {
        const existingRetry = await Appointment.findOne({ bookingRequestId }).populate([
          { path: "patientId", select: "name email role" },
          { path: "doctorId", select: "specialization fees rating userId", populate: { path: "userId", select: "name email role" } },
        ]);
        if (existingRetry && existingRetry.patientId?._id?.toString() === req.user._id.toString()) {
          return res.status(200).json({ success: true, data: existingRetry, message: "Existing appointment returned safely" });
        }
      }
      throw new AppError("That slot was just booked by someone else. Please choose another time.", 409, {
        code: "SLOT_CONFLICT",
      });
    }
    throw error;
  }

  const populatedAppointment = await appointment.populate([
    { path: "patientId", select: "name email role" },
    {
      path: "doctorId",
      select: "specialization fees rating userId",
      populate: { path: "userId", select: "name email role" },
    },
  ]);

  try { await appointmentEmitter.created(populatedAppointment); } catch (error) { logger.warn("appointmentEmitter.created failed", { message: error?.message, appointmentId: populatedAppointment?._id }); }
  try { appointmentEmitter.slotUnavailable(doctor._id, appointmentDate, req.body.timeSlot); } catch (error) { logger.warn("appointmentEmitter.slotUnavailable failed", { message: error?.message, doctorId: doctor._id }); }

  res.status(201).json({
    success: true,
    data: populatedAppointment,
    message: "Appointment created successfully",
  });
});

export const getAppointmentById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid appointment id", 400);
  const filter = await buildRoleBasedFilter(req);
  filter._id = req.params.id;
  const appointment = await Appointment.findOne(filter)
    .populate("patientId", "name email role patientProfile")
    .populate({ path: "doctorId", select: "specialization fees rating userId hospitalName consultationMode profilePhoto city state", populate: { path: "userId", select: "name email role" } })
    .populate("familyMemberId", "name relation age gender bloodGroup medicalConditions")
    .populate("paymentId", "status refundStatus refundedAmount amount")
    .populate("invoiceId", "invoiceNumber")
    .populate("insuranceId", "provider policyNumber policyHolder validTill coverageAmount claimStatus")
    .populate("reportIds", "title category reportDate fileName")
    .lean();
  if (!appointment) throw new AppError("Appointment not found", 404);
  appointment.statusHistory = [...(appointment.statusHistory || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
  res.status(200).json({ success: true, data: appointment, message: "Appointment fetched successfully" });
});

export const getAppointments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = await buildRoleBasedFilter(req);
  if (req.query.status) {
    // Phase DOC-04: comma-separated status support (e.g.
    // "consultation_completed,completed,review_eligible" for a combined
    // "Completed" queue) — a real $in filter server-side instead of the
    // frontend issuing one request per status and merging results by hand.
    // A single value behaves exactly as before (backward compatible).
    const statuses = String(req.query.status)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => APPOINTMENT_STATUS_VALUES.includes(s));
    filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
  } else if (req.query.excludeStatus) {
    // Phase DOC-04: lets a caller ask for e.g. "today, but not cancelled"
    // without a second round trip to filter cancelled rows out client-side.
    // Only takes effect when a single exact status isn't also requested.
    const excluded = String(req.query.excludeStatus)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => APPOINTMENT_STATUS_VALUES.includes(s));
    if (excluded.length) filter.status = { $nin: excluded };
  }
  // Lets the doctor workspace scope this same endpoint to one patient (e.g.
  // from the Patient Directory's "History"/"Follow Up" links) without a new
  // endpoint. Scoped to doctors only — a patient must never be able to pull
  // another patient's appointments by passing an arbitrary patientId.
  if (req.query.patientId && req.user.role === ROLES.DOCTOR) {
    filter.patientId = req.query.patientId;
  }

  // BUGFIX (Phase DOC-01 audit): this endpoint had no date filtering, so any
  // caller that actually needed "today onward" (e.g. the Doctor Dashboard)
  // had no way to ask for it — it could only request a flat page of results
  // sorted oldest-first, which silently omitted today's/upcoming appointments
  // for any doctor with more history than the page size. Mirrors the same
  // dateFrom/dateTo validation already used by
  // admin/appointmentAdminController.buildListFilter, so this is the second
  // consumer of an established pattern, not a new one.
  Object.assign(filter, buildDateRangeFilter(req.query));

  // BUGFIX (Phase DOC-04 audit): the doctor appointment page had no
  // server-side search at all — it fetched a flat capped page and filtered
  // patient name/email in memory client-side, which silently missed any
  // match outside whatever page happened to be loaded. Real, index-backed
  // search, scoped only to doctor/admin callers (a patient searching their
  // own appointments by their own name is meaningless). Combined with an
  // existing patientId scope (e.g. doctor viewing one patient's history) via
  // $and rather than overwriting it, so both constraints hold together.
  const andFragments = [filter];
  if (req.query.search && req.query.search.trim() && req.user.role !== ROLES.PATIENT) {
    andFragments.push(await resolvePatientSearchFilter(req.query.search.trim()));
  }
  // Phase DOC-04: a real, paginated "Attention" queue for the doctor page —
  // reuses the exact same rule as admin's Attention view (see
  // utils/appointmentAttention.js) rather than only flagging rows on
  // whichever page happens to already be loaded, which would silently miss
  // attention items sitting on other pages once real pagination is in use.
  if (req.query.attentionOnly === "true" && req.user.role === ROLES.DOCTOR) {
    andFragments.push(buildAttentionMatch());
  }
  const combinedFilter = andFragments.length > 1 ? { $and: andFragments } : filter;

  // Doctor-facing requests additionally need the patient's clinical profile
  // (age/gender/allergies/blood group) plus insurance + report details so the
  // doctor workspace's pre-consultation "Patient Overview" panel can render
  // from this single call instead of the doctor issuing N follow-up requests.
  // Kept role-gated so patient/admin list views (which don't need this extra
  // payload) are unaffected.
  const isDoctorRequest = req.user.role === ROLES.DOCTOR;

  let query = Appointment.find(combinedFilter)
    .populate("patientId", isDoctorRequest ? "name email role patientProfile" : "name email role")
    .populate({
      path: "doctorId",
      select: "specialization fees rating userId hospitalName consultationMode profilePhoto city state",
      populate: { path: "userId", select: "name email role" },
    })
    .populate("familyMemberId", "name relation age gender bloodGroup medicalConditions")
    .populate("paymentId", "status refundStatus refundedAmount amount")
    .populate("invoiceId", "invoiceNumber")
    .sort({ date: 1, timeSlot: 1 })
    .skip(skip)
    .limit(limit);

  const isPatientRequest = req.user.role === ROLES.PATIENT;
  if (isDoctorRequest || isPatientRequest) {
    // Safe for patients too: buildRoleBasedFilter above already scopes this
    // entire query to req.user._id === patientId, so a patient can only ever
    // see their own insurance/report records here — never another patient's.
    query = query
      .populate("insuranceId", "provider policyNumber policyHolder validTill coverageAmount claimStatus")
      .populate("reportIds", "title category reportDate fileName");
  }

  const [appointments, total] = await Promise.all([
    query.lean(),
    Appointment.countDocuments(combinedFilter),
  ]);

  // Real, non-fabricated attention flag on doctor-facing rows only — reuses
  // the exact same rule admin's list already applies (see
  // utils/appointmentAttention.js), so "needs attention" never means two
  // different things depending on which screen you're looking at it from.
  const enriched = isDoctorRequest
    ? appointments.map((appointment) => ({ ...appointment, needsAttention: computeNeedsAttention(appointment) }))
    : appointments;

  res.status(200).json({
    success: true,
    data: {
      appointments: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    message: "Appointments fetched successfully",
  });
});

// GET /api/appointments/summary — doctor-only real dashboard counts for the
// rebuilt Doctor Appointments page (Phase DOC-04). Mirrors
// admin/appointmentAdminController.getAppointmentSummaryAdmin's approach
// (parallel countDocuments over the real collection, buildAttentionMatch
// for "needs attention") but scoped to the requesting doctor's own
// appointments — reused rather than re-invented.
//
// BUGFIX this endpoint exists to prevent: once the doctor page moves to
// real server-side pagination (see getAppointments above), computing
// "Total/Pending/Completed/..." from whatever page of appointments happens
// to be loaded in the browser would silently show wrong counts (a doctor
// with 300 appointments would see stats reflecting only the current page).
// These numbers must come from a real aggregate over the FULL doctor-scoped
// collection, not the paginated slice the list itself renders.
export const getAppointmentSummary = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user);
  const base = { doctorId: doctor._id };
  const now = Date.now();

  const [
    total,
    pending,
    approved,
    paymentPending,
    paymentCompleted,
    consultationStarted,
    consultationCompleted,
    completed,
    cancelled,
    reviewEligible,
    today,
    upcoming,
    emergency,
    needsAttention,
  ] = await Promise.all([
    Appointment.countDocuments(base),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.PENDING }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.APPROVED }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.PAYMENT_PENDING }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.PAYMENT_COMPLETED }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.CONSULTATION_STARTED }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.CONSULTATION_COMPLETED }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.COMPLETED }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.CANCELLED }),
    Appointment.countDocuments({ ...base, status: APPOINTMENT_STATUS.REVIEW_ELIGIBLE }),
    Appointment.countDocuments({ ...base, ...buildDateRangeFilter({ quickDate: "today" }) }),
    Appointment.countDocuments({ ...base, ...buildDateRangeFilter({ quickDate: "upcoming" }), status: { $ne: APPOINTMENT_STATUS.CANCELLED } }),
    Appointment.countDocuments({ ...base, painLevel: { $gte: 8 }, status: { $nin: [APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE] } }),
    Appointment.countDocuments({ $and: [base, buildAttentionMatch(now)] }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      total,
      pending,
      approved,
      paymentPending,
      paymentCompleted,
      consultationStarted,
      consultationCompleted,
      completed,
      cancelled,
      reviewEligible,
      inConsultation: paymentCompleted + consultationStarted,
      today,
      upcoming,
      emergency,
      needsAttention,
    },
    message: "Appointment summary fetched successfully",
  });
});

export const updateAppointmentStatus = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid appointment id", 400);

  const validation = validateAppointmentStatusUpdate(req.body);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);

  const appointment = await Appointment.findById(req.params.id).populate("doctorId", "userId");
  if (!appointment) throw new AppError("Appointment not found", 404);

  // RBAC: doctors can only update their own appointments
  if (
    req.user.role === ROLES.DOCTOR &&
    appointment.doctorId.userId.toString() !== req.user._id.toString()
  ) {
    throw new AppError("Doctors can only update their own appointments", 403);
  }

  const { status: newStatus } = req.body;

  // BUGFIX (Phase DOC-04 audit): both DoctorAppointments.jsx and
  // DoctorDashboard.jsx's "Reject"/"Cancel" quick actions were sending
  // status: "cancelled" through this generic endpoint, which bypasses
  // cancelAppointmentCore entirely — no cancellation reason was ever
  // captured, no automatic refund request was created for a paid
  // appointment, and the audit trail (cancelReason) was left blank. The
  // patient-cancel and admin-cancel paths already share cancelAppointmentCore
  // (see appointmentCancellationService.js); this was the one path that had
  // silently drifted from it. Rather than patch each caller individually,
  // this endpoint now refuses the cancellation transition outright so EVERY
  // caller (doctor, admin, or any future one) is forced through the shared
  // core via PATCH /:id/cancel, which is the one place refund-request
  // creation, notification, and cancelReason persistence actually happen.
  if (newStatus === APPOINTMENT_STATUS.CANCELLED) {
    throw new AppError(
      "Cancelling an appointment requires a reason — use the cancel endpoint instead of a direct status update.",
      400,
    );
  }

  const allowedTransitions = STATUS_TRANSITIONS[appointment.status] || [];

  if (!allowedTransitions.includes(newStatus)) {
    throw new AppError(
      `Cannot transition appointment from "${appointment.status}" to "${newStatus}"`,
      400,
    );
  }

  // Guard: cannot mark completed unless payment is paid
  if (
    newStatus === APPOINTMENT_STATUS.CONSULTATION_COMPLETED &&
    appointment.paymentStatus !== PAYMENT_STATUS.PAID
  ) {
    throw new AppError("Appointment payment must be completed before ending consultation", 400);
  }

  // When approving: set payment status to pending
  if (newStatus === APPOINTMENT_STATUS.APPROVED) {
    // Re-validate against the doctor's CURRENT calendar. The slot itself was
    // already exclusively reserved at booking time (DB unique index), but
    // leave/blocked-dates can be added *after* booking and *before*
    // approval — without this check a doctor could approve an appointment
    // that falls inside their own now-approved leave or a date they just
    // blocked off.
    const doctorDoc = await Doctor.findById(appointment.doctorId._id).lean();
    const blockedDate = findBlockedDate(doctorDoc, new Date(appointment.date));
    if (blockedDate) {
      throw new AppError(
        `Cannot approve — this date is now blocked on your calendar (${blockedDate.reason || "no reason given"}). Cancel this appointment instead.`,
        409,
      );
    }
    const activeLeave = await LeaveRequest.findOne({
      doctorId: appointment.doctorId._id,
      status: "approved",
      startDate: { $lte: appointment.date },
      endDate: { $gte: appointment.date },
    }).lean();
    if (activeLeave) {
      throw new AppError(
        "Cannot approve — you have approved leave covering this date. Cancel this appointment instead.",
        409,
      );
    }

    appointment.paymentStatus = PAYMENT_STATUS.PENDING;
  }

  // Clinical safety (Step 8): don't let a consultation be finalized as
  // COMPLETED with zero clinical documentation on file. Prescription/note
  // creation is only allowed from CONSULTATION_COMPLETED onward, so this
  // check sits on the *next* transition (finalizing), not on entering
  // CONSULTATION_COMPLETED itself — that would be a chicken-and-egg block.
  if (
    newStatus === APPOINTMENT_STATUS.COMPLETED &&
    appointment.status === APPOINTMENT_STATUS.CONSULTATION_COMPLETED
  ) {
    const [hasPrescription, hasNote] = await Promise.all([
      Prescription.exists({ appointmentId: appointment._id }),
      MedicalNote.exists({ appointmentId: appointment._id }),
    ]);
    if (!hasPrescription && !hasNote) {
      throw new AppError(
        "Add a prescription or a clinical note for this visit before completing the consultation.",
        400,
      );
    }
  }

  const previousStatus = appointment.status;
  appointment.status = newStatus;
  if (req.body.notes !== undefined) appointment.notes = req.body.notes;
  appendAppointmentHistory({
    appointment,
    status: newStatus,
    fromStatus: previousStatus,
    actorId: req.user._id,
    actorRole: req.user.role || "admin",
    reason: req.body.reason || "",
  });
  await appointment.save();

  const populatedAppointment = await appointment.populate([
    { path: "patientId", select: "name email role" },
    {
      path: "doctorId",
      select: "specialization fees rating userId",
      populate: { path: "userId", select: "name email role" },
    },
  ]);

  // Email: wrap in try/catch so email failure never breaks business flow
  if (newStatus === APPOINTMENT_STATUS.APPROVED) {
    try {
      await emailService.sendAppointmentConfirmation({
        patient: populatedAppointment.patientId,
        appointment: populatedAppointment,
      });
    } catch (error) {
      logger.warn("Doctor status-update notification failed", { message: error?.message, appointmentId: populatedAppointment?._id });
    }
  }

  try { await appointmentEmitter.statusUpdated(populatedAppointment); } catch (error) { logger.warn("appointmentEmitter.statusUpdated failed", { message: error?.message, appointmentId: populatedAppointment?._id }); }

  // Phase A6.2.3 — Automation Studio real trigger.
  if (newStatus === APPOINTMENT_STATUS.COMPLETED) {
    await emitAutomationTrigger(TRIGGER_TYPES.APPOINTMENT_COMPLETED, {
      appointmentId: populatedAppointment._id,
      patientId: populatedAppointment.patientId?._id,
      doctorId: populatedAppointment.doctorId?._id,
      date: populatedAppointment.date,
    });
  }

  res.status(200).json({
    success: true,
    data: populatedAppointment,
    message: "Appointment status updated successfully",
  });
});

// BUGFIX (Phase DOC-04 audit): the doctor had no dedicated cancel endpoint
// at all — DoctorAppointments.jsx's "Reject"/"Cancel" buttons went through
// updateAppointmentStatus, which is now blocked for cancellation (see
// above). This endpoint is role-aware: a patient may only cancel their own
// appointment (unchanged behavior); a doctor may only cancel their own
// appointment and, matching the admin cancel path, must supply a reason —
// the patient sees WHY their booking was rejected/cancelled rather than a
// bare status flip. Both branches funnel through the exact same
// cancelAppointmentCore the admin path already uses, so refund-request
// creation, notification, and cancelReason persistence are identical no
// matter who cancels.
export const cancelAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.id).populate("doctorId", "userId");
  if (!appointment) throw new AppError("Appointment not found", 404);

  let cancelledBy;

  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await ensureDoctorProfileForUser(req.user);
    if (appointment.doctorId._id.toString() !== doctor._id.toString()) {
      throw new AppError("Doctors can only cancel their own appointments", 403);
    }
    if (!req.body.reason || !req.body.reason.trim()) {
      throw new AppError("A cancellation reason is required", 400);
    }
    cancelledBy = "doctor";
  } else {
    // Ownership: only the patient who booked it can cancel
    if (appointment.patientId.toString() !== req.user._id.toString()) {
      throw new AppError("You can only cancel your own appointment", 403);
    }
    cancelledBy = "patient";
  }

  const { appointment: cancelledAppointment, refundRequestCreated } = await cancelAppointmentCore({
    appointment,
    reason: req.body.reason,
    cancelledBy,
    actorId: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: cancelledAppointment,
    message: refundRequestCreated
      ? "Appointment cancelled and a refund request was created automatically."
      : "Appointment cancelled successfully",
  });
});

// PATCH /api/appointments/:id/reschedule — Phase DOC-04: rescheduling did
// not exist anywhere in the codebase (audited: no model field, no endpoint,
// no UI beyond a reminder message's text mentioning the word). Real
// end-to-end implementation: only reschedulable while the appointment
// hasn't started (same rule as cancellation, CANCELLABLE_STATUSES — one
// source of truth, not a second hand-maintained list), re-validates the new
// slot with the EXACT same doctor-availability/leave/conflict rules booking
// already uses, and records a real history entry rather than silently
// overwriting the old date/time.
export const rescheduleAppointment = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid appointment id", 400);

  const { date: newDateRaw, timeSlot: newTimeSlot } = req.body;
  if (!newDateRaw || Number.isNaN(Date.parse(newDateRaw))) {
    throw new AppError("A valid new date is required", 400);
  }
  if (!newTimeSlot || typeof newTimeSlot !== "string") {
    throw new AppError("A valid new time slot is required", 400);
  }

  const appointment = await Appointment.findById(req.params.id).populate("doctorId", "userId");
  if (!appointment) throw new AppError("Appointment not found", 404);

  let rescheduledBy;
  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await ensureDoctorProfileForUser(req.user);
    if (appointment.doctorId._id.toString() !== doctor._id.toString()) {
      throw new AppError("Doctors can only reschedule their own appointments", 403);
    }
    rescheduledBy = "doctor";
  } else if (req.user.role === ROLES.PATIENT) {
    if (appointment.patientId.toString() !== req.user._id.toString()) {
      throw new AppError("You can only reschedule your own appointment", 403);
    }
    rescheduledBy = "patient";
  } else {
    rescheduledBy = "admin";
  }

  if (!CANCELLABLE_STATUSES.includes(appointment.status)) {
    throw new AppError(
      `Appointment cannot be rescheduled — current status is "${appointment.status}". ` +
        "Only appointments that have not yet started consultation can be rescheduled.",
      400,
    );
  }

  const doctorDoc = await Doctor.findById(appointment.doctorId._id).lean();
  if (!doctorDoc) throw new AppError("Doctor profile not found", 404);

  const newDate = normalizeDate(newDateRaw);

  // Same canonical timing/window policy as booking — Phase 10's explicit
  // requirement that rescheduling go through the SAME validation pipeline
  // as a new appointment, not a second, weaker path. excludeAppointmentId
  // stops this appointment's OWN current slot from counting against the
  // doctor's daily cap when rescheduling within the same date.
  await enforceAppointmentBookingPolicy({
    date: newDate,
    timeSlot: newTimeSlot,
    doctorId: doctorDoc._id,
    excludeAppointmentId: appointment._id,
  });

  // Same real conflict/availability rules as booking — never a UI-only date
  // picker (Step 7's explicit requirement).
  ensureDoctorAvailable(doctorDoc, newDate, newTimeSlot);

  const activeLeave = await LeaveRequest.findOne({
    doctorId: doctorDoc._id,
    status: "approved",
    startDate: { $lte: newDate },
    endDate: { $gte: newDate },
  }).lean();
  if (activeLeave) throw new AppError("Doctor is on approved leave for the selected date", 409);

  const conflicting = await Appointment.findOne({
    _id: { $ne: appointment._id },
    doctorId: doctorDoc._id,
    date: newDate,
    timeSlot: newTimeSlot,
    status: { $in: ACTIVE_STATUSES },
  }).lean();
  if (conflicting) throw new AppError("This doctor is already booked for the selected slot", 409);

  const fromDate = appointment.date;
  const fromTimeSlot = appointment.timeSlot;

  appointment.rescheduleHistory = appointment.rescheduleHistory || [];
  appointment.rescheduleHistory.push({
    fromDate,
    fromTimeSlot,
    toDate: newDate,
    toTimeSlot: newTimeSlot,
    rescheduledBy,
    reason: req.body.reason || "",
  });
  appendAppointmentHistory({
    appointment,
    status: appointment.status,
    fromStatus: appointment.status,
    actorId: req.user._id,
    actorRole: rescheduledBy,
    reason: `Rescheduled from ${fromDate.toISOString()} ${fromTimeSlot} to ${newDate.toISOString()} ${newTimeSlot}${req.body.reason ? ` — ${req.body.reason}` : ""}`,
  });
  appointment.date = newDate;
  appointment.timeSlot = newTimeSlot;
  try {
    await appointment.save();
  } catch (error) {
    // Same real race-condition guarantee as createAppointment — the
    // conflicting-appointment check above is best-effort, the unique
    // partial index is the actual guarantee.
    if (error?.code === 11000) {
      throw new AppError("That slot was just booked by someone else. Please choose another time.", 409, {
        code: "SLOT_CONFLICT",
      });
    }
    throw error;
  }

  const populatedAppointment = await appointment.populate([
    { path: "patientId", select: "name email role" },
    {
      path: "doctorId",
      select: "specialization fees rating userId",
      populate: { path: "userId", select: "name email role" },
    },
  ]);

  try {
    await appointmentEmitter.rescheduled(populatedAppointment, { fromDate, fromTimeSlot, rescheduledBy });
  } catch (error) {
    logger.warn("appointmentEmitter.rescheduled failed", { message: error?.message, appointmentId: populatedAppointment?._id });
  }

  res.status(200).json({
    success: true,
    data: populatedAppointment,
    message: "Appointment rescheduled successfully",
  });
});

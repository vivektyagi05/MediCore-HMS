// ─────────────────────────────────────────────────────────────────────────
// CLINICAL ACCESS — the single authority for "may doctor D see / talk to
// patient P?".
//
// Before this module, "the doctor has treated the patient" meant
// `Appointment.exists({ doctorId, patientId })`: ANY appointment, in ANY
// status (a cancelled or never-approved request included), ever. That check
// was used to hand a doctor every report, insurance policy and family-member
// record the patient had, and separately to authorise chat.
//
// Rules implemented here (derived from the existing booking lifecycle — an
// appointment only becomes clinical once the patient has paid):
//
//  RECORD ACCESS (clinical profile, reports, insurance, family, certificates,
//  follow-ups, AI clinical context)
//    - the doctor is currently approved + active (doctorLifecycleService)
//    - the patient account is active
//    - at least one appointment between them is in a CLINICAL status:
//      payment_completed | consultation_started | consultation_completed |
//      completed | review_eligible
//      (pending / approved / payment_pending / cancelled never qualify)
//    - and the SPECIFIC record was shared with THIS doctor:
//        report     -> tagged to the doctor, linked to one of the eligible
//                      appointments, or attached to one at booking
//        insurance  -> attached to one of the eligible appointments
//        family     -> the appointment was booked FOR that family member
//      A family-member report is only ever visible through an appointment
//      that was booked for that same family member.
//
//  CHAT (ONE policy — resolveChatAccess — used by REST history, conversation
//  list, socket room join, send, typing, read/delivery receipts, attachment
//  upload and attachment download, and notification creation)
//    - relationship: an appointment in an ACTIVE status (approved ..
//      consultation_completed) or a completed/review_eligible one. Cancelled /
//      pending-only pairings have NO relationship and therefore no access.
//    - status "active"    => canRead + canSend: the doctor is approved+active
//      and there is an ACTIVE appointment, or a completed/review_eligible one
//      within CHAT_FOLLOWUP_WINDOW_DAYS of its date.
//    - status "read_only" => canRead only: a real relationship existed but the
//      communication window expired (COMMUNICATION_WINDOW_EXPIRED) or the
//      doctor is no longer eligible (DOCTOR_NOT_ELIGIBLE, patient side only).
//      A patient never loses their own history; sending is blocked and the UI
//      says so. Read access is deliberately NOT the same as send access, and
//      socket room join follows READ access so REST and socket never disagree.
//    - a DOCTOR whose own account is no longer eligible has no access at all.
//    - super_admin (support) may chat with any participant (admin<->user
//      conversations only; it never grants access to a doctor<->patient pair).
//
// The decision functions below are PURE (they take already-fetched
// appointments) so the policy is unit-testable without a database; the
// async wrappers only fetch and delegate.
// ─────────────────────────────────────────────────────────────────────────
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import MedicalReport from "../models/MedicalReport.js";
import User from "../models/User.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";
import { isDoctorClinicallyEligible } from "./doctorLifecycleService.js";

const S = APPOINTMENT_STATUS;

export const CLINICAL_RECORD_STATUSES = Object.freeze([
  S.PAYMENT_COMPLETED,
  S.CONSULTATION_STARTED,
  S.CONSULTATION_COMPLETED,
  S.COMPLETED,
  S.REVIEW_ELIGIBLE,
]);

export const CHAT_ACTIVE_STATUSES = Object.freeze([
  S.APPROVED,
  S.PAYMENT_PENDING,
  S.PAYMENT_COMPLETED,
  S.CONSULTATION_STARTED,
  S.CONSULTATION_COMPLETED,
]);

export const CHAT_FOLLOWUP_STATUSES = Object.freeze([S.COMPLETED, S.REVIEW_ELIGIBLE]);

const DAY_MS = 24 * 60 * 60 * 1000;
const RELATIONSHIP_FETCH_LIMIT = 500;

const idOf = (value) => (value === undefined || value === null ? null : String(value._id ?? value));

// ── Pure policy ─────────────────────────────────────────────────────────

/** Appointments that qualify for RECORD ACCESS. */
export const filterRecordAppointments = (appointments = []) =>
  appointments.filter((appointment) => CLINICAL_RECORD_STATUSES.includes(appointment.status));

/**
 * What exactly has been shared with the doctor through the eligible
 * appointments. Everything the doctor may see about the patient is derived
 * from this scope — never from "an appointment exists".
 */
export function buildSharedRecordScope(appointments = []) {
  const eligible = filterRecordAppointments(appointments);
  const appointmentIds = new Set();
  const attachedReportIds = new Set();
  const insuranceIds = new Set();
  const familyMemberIds = new Set();

  for (const appointment of eligible) {
    appointmentIds.add(idOf(appointment._id));
    for (const reportId of appointment.reportIds || []) attachedReportIds.add(idOf(reportId));
    if (appointment.insuranceId) insuranceIds.add(idOf(appointment.insuranceId));
    if (appointment.familyMemberId) familyMemberIds.add(idOf(appointment.familyMemberId));
  }

  return {
    hasAccess: eligible.length > 0,
    appointmentIds: [...appointmentIds],
    attachedReportIds: [...attachedReportIds],
    insuranceIds: [...insuranceIds],
    familyMemberIds: [...familyMemberIds],
  };
}

/**
 * Mongo filter for the MedicalReports of `patientId` that were shared with
 * `doctorId`. Returns null when the doctor has no record access at all.
 * Callers must treat null as "nothing".
 */
export function buildSharedReportFilter({ patientId, doctorId, scope }) {
  if (!scope?.hasAccess) return null;

  const sharedVia = [{ doctorId }];
  if (scope.appointmentIds.length) sharedVia.push({ appointmentId: { $in: scope.appointmentIds } });
  if (scope.attachedReportIds.length) sharedVia.push({ _id: { $in: scope.attachedReportIds } });

  // A family-member report is only reachable if the doctor has an eligible
  // appointment booked for THAT family member. Account-holder reports (no
  // familyMemberId) are governed by the sharing rules above alone.
  const familyGuard = {
    $or: [
      { familyMemberId: { $exists: false } },
      { familyMemberId: null },
      ...(scope.familyMemberIds.length ? [{ familyMemberId: { $in: scope.familyMemberIds } }] : []),
    ],
  };

  return { userId: patientId, $and: [{ $or: sharedVia }, familyGuard] };
}

/** Insurance policies attached to the doctor's eligible appointments. */
export function buildSharedInsuranceFilter({ patientId, scope }) {
  if (!scope?.hasAccess || scope.insuranceIds.length === 0) return null;
  return { userId: patientId, _id: { $in: scope.insuranceIds } };
}

/** Family members the doctor has actually been booked for. */
export function buildSharedFamilyFilter({ patientId, scope }) {
  if (!scope?.hasAccess || scope.familyMemberIds.length === 0) return null;
  return { userId: patientId, _id: { $in: scope.familyMemberIds }, isActive: { $ne: false } };
}

/**
 * CHAT eligibility from a doctor↔patient appointment list.
 * @param {Array} appointments  { status, date }
 * @param {number} [now]
 * @param {number} [windowDays]
 */
export function chatEligibleFromAppointments(appointments = [], now = Date.now(), windowDays = env.clinical.chatFollowUpWindowDays) {
  return evaluateChatAccess({
    summary: summarizeChatRelationship(appointments),
    doctorEligible: true,
    requesterIsDoctor: false,
    now,
    windowDays,
  }).canSend;
}

// ── Data access ─────────────────────────────────────────────────────────

const fetchPairAppointments = (doctorId, patientId, statuses) =>
  Appointment.find({ doctorId, patientId, status: { $in: statuses } })
    .select("_id status date familyMemberId insuranceId reportIds")
    .sort({ date: -1 })
    .limit(RELATIONSHIP_FETCH_LIMIT)
    .lean();

/**
 * Throws 403 unless `doctor` (a Doctor document/lean object) may access the
 * patient's clinical records. Returns the shared-record scope on success.
 */
export async function assertDoctorPatientRecordAccess(doctor, patientId) {
  if (!isDoctorClinicallyEligible(doctor)) {
    throw new AppError("Your doctor account is not currently eligible to access patient records", 403);
  }
  if (!patientId) throw new AppError("Patient is required", 400);

  const patient = await User.findOne({ _id: patientId, role: ROLES.PATIENT, isActive: true }).select("_id").lean();
  if (!patient) throw new AppError("You do not have an active care relationship with this patient", 403);

  const appointments = await fetchPairAppointments(doctor._id, patientId, CLINICAL_RECORD_STATUSES);
  const scope = buildSharedRecordScope(appointments);
  if (!scope.hasAccess) {
    throw new AppError(
      "You can access this patient's records only after a paid consultation with them has started",
      403,
    );
  }
  return scope;
}

/** Non-throwing variant for callers that degrade (AI context, listings). */
export async function getDoctorPatientRecordScope(doctor, patientId) {
  try {
    return await assertDoctorPatientRecordAccess(doctor, patientId);
  } catch (error) {
    if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 400)) return null;
    throw error;
  }
}

export const CHAT_ACCESS = Object.freeze({ ACTIVE: "active", READ_ONLY: "read_only", NONE: "none" });

export const CHAT_DENIAL_REASON = Object.freeze({
  NO_RELATIONSHIP: "NO_CARE_RELATIONSHIP",
  WINDOW_EXPIRED: "COMMUNICATION_WINDOW_EXPIRED",
  DOCTOR_NOT_ELIGIBLE: "DOCTOR_NOT_ELIGIBLE",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  INVALID_PARTICIPANTS: "INVALID_PARTICIPANTS",
});

/**
 * PURE. Collapse a doctor<->patient appointment list into the only facts the
 * chat policy needs. Also the shape the contact-list aggregation produces, so
 * the list and the per-request decision can never disagree.
 * @returns {{ hasRelationship: boolean, hasActive: boolean, latestFollowUpAt: number|null }}
 */
export function summarizeChatRelationship(appointments = []) {
  let hasRelationship = false;
  let hasActive = false;
  let latestFollowUpAt = null;
  for (const appointment of appointments) {
    if (CHAT_ACTIVE_STATUSES.includes(appointment.status)) {
      hasRelationship = true;
      hasActive = true;
    } else if (CHAT_FOLLOWUP_STATUSES.includes(appointment.status)) {
      hasRelationship = true;
      const at = new Date(appointment.date).getTime();
      if (Number.isFinite(at) && (latestFollowUpAt === null || at > latestFollowUpAt)) latestFollowUpAt = at;
    }
  }
  return { hasRelationship, hasActive, latestFollowUpAt };
}

/**
 * PURE. The single decision function behind every chat entry point.
 * @param {{ summary: ReturnType<typeof summarizeChatRelationship>, doctorEligible: boolean, requesterIsDoctor: boolean, now?: number, windowDays?: number }} input
 */
export function evaluateChatAccess({ summary, doctorEligible, requesterIsDoctor, now = Date.now(), windowDays = env.clinical.chatFollowUpWindowDays }) {
  const deny = (reason) => ({ status: CHAT_ACCESS.NONE, canRead: false, canSend: false, readOnlyReason: null, denialReason: reason });
  if (!summary?.hasRelationship) return deny(CHAT_DENIAL_REASON.NO_RELATIONSHIP);
  if (requesterIsDoctor && !doctorEligible) return deny(CHAT_DENIAL_REASON.DOCTOR_NOT_ELIGIBLE);

  const readOnly = (reason) => ({ status: CHAT_ACCESS.READ_ONLY, canRead: true, canSend: false, readOnlyReason: reason, denialReason: null });
  if (!doctorEligible) return readOnly(CHAT_DENIAL_REASON.DOCTOR_NOT_ELIGIBLE);

  const withinWindow = summary.latestFollowUpAt !== null && now - summary.latestFollowUpAt <= windowDays * DAY_MS;
  if (summary.hasActive || withinWindow) {
    return { status: CHAT_ACCESS.ACTIVE, canRead: true, canSend: true, readOnlyReason: null, denialReason: null };
  }
  return readOnly(CHAT_DENIAL_REASON.WINDOW_EXPIRED);
}

const NO_ACCESS = (reason) => ({ status: CHAT_ACCESS.NONE, canRead: false, canSend: false, readOnlyReason: null, denialReason: reason });

/**
 * THE chat-authorisation decision. `requester`/`other` are User documents
 * (needs _id, role, isActive). Never throws for a denial. Callers choose the
 * capability they need (canRead for history/join/receipts/download, canSend
 * for send/typing/upload) — they must not re-derive access themselves.
 */
export async function resolveChatAccess(requester, other) {
  if (!requester?._id || !other?._id) return NO_ACCESS(CHAT_DENIAL_REASON.INVALID_PARTICIPANTS);
  if (String(requester._id) === String(other._id)) return NO_ACCESS(CHAT_DENIAL_REASON.INVALID_PARTICIPANTS);
  if (requester.isActive === false || other.isActive === false) return NO_ACCESS(CHAT_DENIAL_REASON.ACCOUNT_INACTIVE);

  if (ADMIN_ROLES.includes(requester.role) || ADMIN_ROLES.includes(other.role)) {
    return { status: CHAT_ACCESS.ACTIVE, canRead: true, canSend: true, readOnlyReason: null, denialReason: null, adminSupport: true };
  }

  const doctorUser = requester.role === ROLES.DOCTOR ? requester : other.role === ROLES.DOCTOR ? other : null;
  const patientUser = requester.role === ROLES.PATIENT ? requester : other.role === ROLES.PATIENT ? other : null;
  if (!doctorUser || !patientUser) return NO_ACCESS(CHAT_DENIAL_REASON.INVALID_PARTICIPANTS);

  const doctor = await Doctor.findOne({ userId: doctorUser._id }).select("_id verificationStatus isVerified isActive").lean();
  if (!doctor) return NO_ACCESS(CHAT_DENIAL_REASON.NO_RELATIONSHIP);

  const appointments = await fetchPairAppointments(doctor._id, patientUser._id, [...CHAT_ACTIVE_STATUSES, ...CHAT_FOLLOWUP_STATUSES]);
  return evaluateChatAccess({
    summary: summarizeChatRelationship(appointments),
    doctorEligible: isDoctorClinicallyEligible(doctor),
    requesterIsDoctor: String(requester._id) === String(doctorUser._id),
  });
}

/**
 * Batch form of resolveChatAccess for list endpoints: ONE Doctor query + ONE
 * Appointment query for the whole page instead of one pair of queries per
 * conversation (no N+1). Uses the exact same pure policy functions, so the
 * list can never disagree with the per-request decision.
 * @param {object} requester  User (needs _id, role, isActive)
 * @param {object[]} others   Users (need _id, role, isActive)
 * @returns {Promise<Map<string, ReturnType<typeof evaluateChatAccess>>>} keyed by String(other._id)
 */
export async function resolveChatAccessBatch(requester, others = []) {
  const result = new Map();
  if (!requester?._id || requester.isActive === false) {
    for (const other of others) result.set(String(other._id), NO_ACCESS(CHAT_DENIAL_REASON.ACCOUNT_INACTIVE));
    return result;
  }
  const requesterIsDoctor = requester.role === ROLES.DOCTOR;
  const requesterIsPatient = requester.role === ROLES.PATIENT;

  const pairs = [];
  for (const other of others) {
    const key = String(other._id);
    if (key === String(requester._id) || other.isActive === false) {
      result.set(key, NO_ACCESS(other.isActive === false ? CHAT_DENIAL_REASON.ACCOUNT_INACTIVE : CHAT_DENIAL_REASON.INVALID_PARTICIPANTS));
    } else if (ADMIN_ROLES.includes(requester.role) || ADMIN_ROLES.includes(other.role)) {
      result.set(key, { status: CHAT_ACCESS.ACTIVE, canRead: true, canSend: true, readOnlyReason: null, denialReason: null, adminSupport: true });
    } else if ((requesterIsDoctor && other.role === ROLES.PATIENT) || (requesterIsPatient && other.role === ROLES.DOCTOR)) {
      pairs.push(other);
    } else {
      result.set(key, NO_ACCESS(CHAT_DENIAL_REASON.INVALID_PARTICIPANTS));
    }
  }
  if (!pairs.length) return result;

  const statuses = [...CHAT_ACTIVE_STATUSES, ...CHAT_FOLLOWUP_STATUSES];
  if (requesterIsDoctor) {
    const doctor = await Doctor.findOne({ userId: requester._id }).select("_id verificationStatus isVerified isActive").lean();
    const eligible = Boolean(doctor) && isDoctorClinicallyEligible(doctor);
    const appointments = doctor
      ? await Appointment.find({ doctorId: doctor._id, patientId: { $in: pairs.map((p) => p._id) }, status: { $in: statuses } })
        .select("_id status date patientId").limit(RELATIONSHIP_FETCH_LIMIT * 4).lean()
      : [];
    const byPatient = new Map();
    for (const appointment of appointments) {
      const key = String(appointment.patientId);
      if (!byPatient.has(key)) byPatient.set(key, []);
      byPatient.get(key).push(appointment);
    }
    for (const other of pairs) {
      result.set(String(other._id), evaluateChatAccess({
        summary: summarizeChatRelationship(byPatient.get(String(other._id)) || []),
        doctorEligible: eligible,
        requesterIsDoctor: true,
      }));
    }
    return result;
  }

  const doctors = await Doctor.find({ userId: { $in: pairs.map((p) => p._id) } })
    .select("_id userId verificationStatus isVerified isActive").lean();
  const doctorByUser = new Map(doctors.map((doctor) => [String(doctor.userId), doctor]));
  const appointments = doctors.length
    ? await Appointment.find({ patientId: requester._id, doctorId: { $in: doctors.map((d) => d._id) }, status: { $in: statuses } })
      .select("_id status date doctorId").limit(RELATIONSHIP_FETCH_LIMIT * 4).lean()
    : [];
  const byDoctor = new Map();
  for (const appointment of appointments) {
    const key = String(appointment.doctorId);
    if (!byDoctor.has(key)) byDoctor.set(key, []);
    byDoctor.get(key).push(appointment);
  }
  for (const other of pairs) {
    const doctor = doctorByUser.get(String(other._id));
    result.set(String(other._id), doctor
      ? evaluateChatAccess({
        summary: summarizeChatRelationship(byDoctor.get(String(doctor._id)) || []),
        doctorEligible: isDoctorClinicallyEligible(doctor),
        requesterIsDoctor: false,
      })
      : NO_ACCESS(CHAT_DENIAL_REASON.NO_RELATIONSHIP));
  }
  return result;
}

/** Sending / typing / uploading: active window only. Thin wrapper over resolveChatAccess. */
export async function usersCanChat(userA, userB) {
  return (await resolveChatAccess(userA, userB)).canSend;
}

/** Reading an existing conversation, joining its room, receipts, attachment download. */
export async function usersCanReadConversationHistory(requester, other) {
  return (await resolveChatAccess(requester, other)).canRead;
}

/**
 * Mark a report reviewed — ONE implementation for both doctor entry points
 * (patient workspace and command center). Access is the shared policy; an
 * unshared or unknown report is a 404 so ids cannot be probed.
 * @returns {Promise<object>} the updated report without its storage path
 */
export async function markSharedReportReviewed({ doctor, patientId, reportId, reviewerUserId }) {
  const scope = await assertDoctorPatientRecordAccess(doctor, patientId);
  const shared = buildSharedReportFilter({ patientId, doctorId: doctor._id, scope });
  const isValidId = /^[a-f\d]{24}$/i.test(String(reportId));
  const report = shared && isValidId
    ? await MedicalReport.findOneAndUpdate(
      { userId: shared.userId, $and: [{ _id: reportId }, ...shared.$and] },
      { reviewedAt: new Date(), reviewedBy: reviewerUserId },
      { new: true },
    ).select("-filePath").lean()
    : null;
  if (!report) throw new AppError("Report not found for this patient", 404);
  return report;
}

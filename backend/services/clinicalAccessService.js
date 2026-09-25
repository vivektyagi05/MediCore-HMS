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
//  CHAT
//    - doctor approved+active, patient active
//    - an appointment in an ACTIVE status (approved .. consultation_completed)
//      or a completed/review_eligible one within CHAT_FOLLOWUP_WINDOW_DAYS
//      of its date. Cancelled / pending appointments never open chat.
//    - super_admin (support) may always chat, as before.
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
  return appointments.some((appointment) => {
    if (CHAT_ACTIVE_STATUSES.includes(appointment.status)) return true;
    if (CHAT_FOLLOWUP_STATUSES.includes(appointment.status)) {
      const at = new Date(appointment.date).getTime();
      return Number.isFinite(at) && now - at <= windowDays * DAY_MS;
    }
    return false;
  });
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

/**
 * The one chat-authorisation decision, shared by REST, socket join and
 * socket send. `userA`/`userB` are User documents (needs _id, role,
 * isActive). Never throws for a denial — returns a boolean.
 */
export async function usersCanChat(userA, userB) {
  if (!userA?._id || !userB?._id) return false;
  if (String(userA._id) === String(userB._id)) return false;
  if (userA.isActive === false || userB.isActive === false) return false;

  if (ADMIN_ROLES.includes(userA.role) || ADMIN_ROLES.includes(userB.role)) return true;

  const doctorUser = userA.role === ROLES.DOCTOR ? userA : userB.role === ROLES.DOCTOR ? userB : null;
  const patientUser = userA.role === ROLES.PATIENT ? userA : userB.role === ROLES.PATIENT ? userB : null;
  if (!doctorUser || !patientUser) return false;

  const doctor = await Doctor.findOne({ userId: doctorUser._id }).select("_id verificationStatus isVerified isActive").lean();
  if (!isDoctorClinicallyEligible(doctor)) return false;

  const appointments = await fetchPairAppointments(doctor._id, patientUser._id, [...CHAT_ACTIVE_STATUSES, ...CHAT_FOLLOWUP_STATUSES]);
  return chatEligibleFromAppointments(appointments);
}

/**
 * Reading an EXISTING conversation. Deliberately looser than sending: a
 * patient must not lose access to their own past messages just because the
 * follow-up window closed, but a relationship must still have existed (no
 * cancelled/never-approved pairings) and a doctor must still be eligible.
 */
export async function usersCanReadConversationHistory(requester, other) {
  if (!requester?._id || !other?._id) return false;
  if (String(requester._id) === String(other._id)) return false;
  if (requester.isActive === false || other.isActive === false) return false;
  if (ADMIN_ROLES.includes(requester.role) || ADMIN_ROLES.includes(other.role)) return true;

  const doctorUser = requester.role === ROLES.DOCTOR ? requester : other.role === ROLES.DOCTOR ? other : null;
  const patientUser = requester.role === ROLES.PATIENT ? requester : other.role === ROLES.PATIENT ? other : null;
  if (!doctorUser || !patientUser) return false;

  const doctor = await Doctor.findOne({ userId: doctorUser._id }).select("_id verificationStatus isVerified isActive").lean();
  if (!doctor) return false;
  if (String(requester._id) === String(doctorUser._id) && !isDoctorClinicallyEligible(doctor)) return false;

  const exists = await Appointment.exists({
    doctorId: doctor._id,
    patientId: patientUser._id,
    status: { $in: [...CHAT_ACTIVE_STATUSES, ...CHAT_FOLLOWUP_STATUSES] },
  });
  return Boolean(exists);
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

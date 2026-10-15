// ─────────────────────────────────────────────────────────────────────────
// APPOINTMENT OPERATIONAL LIFECYCLE
//   check-in → call → (consultation via status endpoint) ; no-show ;
//   missed-appointment resolution ; scheduled sweep (flag + auto-expire).
//
// Every mutation here is one atomic conditional write (atomicTransition) with
// its audit entry; the DB write ALWAYS precedes realtime/notification, and a
// failed emit never rolls back state. All time decisions come from
// utils/hospitalTime.js via services/appointmentActionPolicy.js.
// ─────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import { APPOINTMENT_STATUS as S } from "../constants/appointmentStatus.js";
import { VISIT_STATE as V, REASON_CODE, RESOLUTION_OUTCOME as O } from "../constants/appointmentVisitState.js";
import { getAppointmentRules } from "./hospitalSettingsService.js";
import { ACTION, ACTOR, evaluateAppointmentAction } from "./appointmentActionPolicy.js";
import { atomicTransition } from "./appointmentTransitionService.js";
import { cancelAppointmentCore } from "./appointmentCancellationService.js";
import { appointmentEmitter } from "../realtime/appointmentEmitter.js";
import { queueAppointmentEmails } from "./appointmentEmailService.js";
import { appointmentError } from "../utils/appointmentErrors.js";
import { logger } from "../utils/logger.js";
import {
  classifyAppointmentTime,
  APPOINTMENT_TIME_STATE as T,
  hospitalToday,
  resolveAppointmentInstant,
} from "../utils/hospitalTime.js";

const POPULATE = [
  { path: "patientId", select: "name email role" },
  { path: "doctorId", select: "specialization fees userId", populate: { path: "userId", select: "name email role" } },
];

const safeEmit = async (fn, ctx) => {
  try { await fn(); } catch (error) { logger.warn("appointment realtime/notification failed (state already persisted)", { message: error?.message, ...ctx }); }
};

/** Loads + authorizes by RELATIONSHIP (never trusts ids from the client body). */
export const loadAppointmentForActor = async (appointmentId, actor) => {
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) throw appointmentError("APPOINTMENT_NOT_FOUND");
  const appointment = await Appointment.findById(appointmentId).populate(POPULATE);
  if (!appointment) throw appointmentError("APPOINTMENT_NOT_FOUND");
  const role = actor.role;
  if (role === ACTOR.PATIENT) {
    if (appointment.patientId?._id?.toString() !== actor._id.toString()) throw appointmentError("APPOINTMENT_NOT_OWNED");
  } else if (role === ACTOR.DOCTOR) {
    if (appointment.doctorId?.userId?._id?.toString() !== actor._id.toString()) throw appointmentError("APPOINTMENT_NOT_OWNED");
  } else if (role !== ACTOR.SUPER_ADMIN) {
    throw appointmentError("UNAUTHORIZED_APPOINTMENT_ACTION");
  }
  return appointment;
};

const verdictOrThrow = (appointment, action, actor, now, rules) => {
  const v = evaluateAppointmentAction({ action, actorRole: actor.role, appointment, now, tz: rules.timezone, rules });
  if (!v.allowed) throw appointmentError(v.code, { action, timeState: v.timeState, ...(v.opensAt ? { opensAt: v.opensAt } : {}) });
  return v;
};

// ── Patient check-in: not_arrived → checked_in (== waiting; queue order = checkedInAt) ──
export const checkIn = async ({ appointmentId, actor, now = new Date() }) => {
  const rules = await getAppointmentRules();
  const appt = await loadAppointmentForActor(appointmentId, actor);
  verdictOrThrow(appt, ACTION.CHECK_IN, actor, now, rules);
  const updated = await atomicTransition({
    appointmentId: appt._id,
    fromStatuses: [S.PAYMENT_COMPLETED],
    fromVisitStates: [V.NOT_ARRIVED],
    set: { "visit.state": V.CHECKED_IN, "visit.checkedInAt": now },
    history: { status: S.PAYMENT_COMPLETED, fromStatus: S.PAYMENT_COMPLETED, actorId: actor._id, actorRole: "patient", event: "checked_in", visitState: V.CHECKED_IN, reason: "Patient checked in" },
  });
  const populated = await updated.populate(POPULATE);
  await safeEmit(() => appointmentEmitter.operational("checked_in", populated, {
    notifyDoctor: { title: "Patient checked in", message: `${populated.patientId?.name || "A patient"} has checked in for ${populated.timeSlot}.`, severity: "info" },
  }), { appointmentId });
  return populated;
};

// ── Doctor calls next patient: checked_in → called ──
export const callPatient = async ({ appointmentId, actor, now = new Date() }) => {
  const rules = await getAppointmentRules();
  const appt = await loadAppointmentForActor(appointmentId, actor);
  verdictOrThrow(appt, ACTION.CALL_PATIENT, actor, now, rules);
  const updated = await atomicTransition({
    appointmentId: appt._id,
    fromStatuses: [S.PAYMENT_COMPLETED],
    fromVisitStates: [V.CHECKED_IN],
    set: { "visit.state": V.CALLED, "visit.calledAt": now },
    history: { status: S.PAYMENT_COMPLETED, fromStatus: S.PAYMENT_COMPLETED, actorId: actor._id, actorRole: "doctor", event: "called", visitState: V.CALLED, reason: "Doctor called the patient" },
  });
  const populated = await updated.populate(POPULATE);
  await safeEmit(() => appointmentEmitter.operational("called", populated, {
    notifyPatient: { title: "The doctor is ready for you", message: `Dr. ${populated.doctorId?.userId?.name || ""} is ready to see you now.`.replace("Dr.  ", "Dr. "), severity: "success" },
  }), { appointmentId });
  return populated;
};

// ── Queue (deterministic): checked_in/called ordered by checkedInAt, then scheduled slot, then _id ──
export const buildQueue = (appointments) =>
  appointments
    .filter((a) => [V.CHECKED_IN, V.CALLED].includes(a.visit?.state) && a.status === S.PAYMENT_COMPLETED)
    .sort((a, b) =>
      (a.visit?.state === V.CALLED ? 0 : 1) - (b.visit?.state === V.CALLED ? 0 : 1) ||
      new Date(a.visit?.checkedInAt || 0) - new Date(b.visit?.checkedInAt || 0) ||
      String(a.timeSlot).localeCompare(String(b.timeSlot)) ||
      String(a._id).localeCompare(String(b._id)));

// ── Delay from PERSISTED timestamps only (never updatedAt / socket / browser time) ──
export const computeDelayMinutes = ({ date, timeSlot, consultationStartedAt, tz }) => {
  if (!consultationStartedAt) return null; // no authoritative timestamp → no delay is invented
  const scheduled = resolveAppointmentInstant(date, timeSlot, tz);
  if (!scheduled) return null;
  return Math.max(0, Math.round((new Date(consultationStartedAt).getTime() - scheduled.getTime()) / 60000));
};

/**
 * After a consultation starts late, tell the doctor's OTHER still-upcoming
 * patients that day — factually ("running about N minutes behind"), never an
 * ETA. Deduped per patient by a threshold bucket persisted on the appointment
 * (conditional $lt update) AND by the deterministic notification eventKey.
 */
export const notifyDelayToWaitingPatients = async ({ startedAppointment, rules }) => {
  const delay = computeDelayMinutes({ date: startedAppointment.date, timeSlot: startedAppointment.timeSlot, consultationStartedAt: startedAppointment.visit?.consultationStartedAt, tz: rules.timezone });
  const threshold = rules.delayNotifyThresholdMinutes;
  if (delay === null || delay < threshold) return { delay, notified: 0 };
  const bucket = Math.floor(delay / threshold) * threshold;
  const others = await Appointment.find({
    doctorId: startedAppointment.doctorId?._id ?? startedAppointment.doctorId,
    date: startedAppointment.date,
    _id: { $ne: startedAppointment._id },
    status: { $in: [S.PAYMENT_COMPLETED] },
    "visit.state": { $in: [V.NOT_ARRIVED, V.CHECKED_IN, V.CALLED, null] },
  }).limit(100);
  let notified = 0;
  for (const other of others) {
    const start = resolveAppointmentInstant(other.date, other.timeSlot, rules.timezone);
    if (!start || start.getTime() <= new Date(startedAppointment.visit.consultationStartedAt).getTime()) continue; // only later slots
    const claimed = await Appointment.findOneAndUpdate(
      { _id: other._id, $or: [{ "visit.delayNotifiedMinutes": { $lt: bucket } }, { "visit.delayNotifiedMinutes": { $exists: false } }] },
      { $set: { "visit.delayNotifiedMinutes": bucket } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    const populated = await claimed.populate(POPULATE);
    await safeEmit(() => appointmentEmitter.operational("delay", populated, {
      extra: { delayMinutes: delay },
      keySuffix: `:${bucket}`,
      notifyPatient: { title: "Doctor is running behind", message: `Your doctor is running about ${delay} minutes behind schedule. Your appointment time is unchanged.`, severity: "warning" },
    }), { appointmentId: other._id });
    notified += 1;
  }
  return { delay, notified };
};

// ── No-show ──
export const markPatientNoShow = async ({ appointmentId, actor, note = "", now = new Date() }) => {
  const rules = await getAppointmentRules();
  const appt = await loadAppointmentForActor(appointmentId, actor);
  verdictOrThrow(appt, ACTION.MARK_PATIENT_NO_SHOW, actor, now, rules);
  // Business rule: closes the appointment (cancelled / PATIENT_NO_SHOW). NO
  // penalty is invented and NO automatic refund is created — the payment stays
  // as captured; any refund goes through the normal request/approval flow.
  const { appointment } = await cancelAppointmentCore({
    appointment: appt,
    cancelledBy: actor.role === ACTOR.SUPER_ADMIN ? "super_admin" : "doctor",
    actorId: actor._id,
    reasonCode: REASON_CODE.PATIENT_NO_SHOW,
    reason: note?.trim() || "Patient did not attend the appointment",
    tz: rules.timezone,
    autoRefund: false,
    extraFilter: { "visit.state": { $in: [V.NOT_ARRIVED, V.MISSED, null] } }, // checked-in patients can never be no-shows
    extraSet: { "visit.state": V.NO_SHOW_PATIENT, "visit.noShowAt": now },
  });
  return appointment;
};

export const reportDoctorNoShow = async ({ appointmentId, actor, now = new Date() }) => {
  const rules = await getAppointmentRules();
  const appt = await loadAppointmentForActor(appointmentId, actor);
  verdictOrThrow(appt, ACTION.REPORT_DOCTOR_NO_SHOW, actor, now, rules);
  // Evidence-based: only a patient who genuinely checked in can report, and
  // only if the doctor never started. Patient is made whole (auto refund request).
  const { appointment, refundRequestCreated } = await cancelAppointmentCore({
    appointment: appt,
    cancelledBy: "patient",
    actorId: actor._id,
    reasonCode: REASON_CODE.DOCTOR_NO_SHOW,
    reason: "Doctor did not start the consultation after the patient checked in",
    tz: rules.timezone,
    extraFilter: { "visit.state": { $in: [V.CHECKED_IN, V.CALLED] } },
    extraSet: { "visit.state": V.NO_SHOW_DOCTOR, "visit.noShowAt": now },
  });
  return { appointment, refundRequestCreated };
};

// ── Explicit "Resolve missed appointment" workflow ──
export const resolveMissedAppointment = async ({ appointmentId, actor, outcome, note = "", now = new Date() }) => {
  const rules = await getAppointmentRules();
  if (!Object.values(O).includes(outcome)) throw appointmentError("ACTION_NOT_ALLOWED", { field: "outcome" });
  const appt = await loadAppointmentForActor(appointmentId, actor);
  verdictOrThrow(appt, ACTION.RESOLVE_MISSED, actor, now, rules);
  const trimmed = String(note || "").trim();
  if (!trimmed) throw appointmentError("REASON_REQUIRED");
  const role = actor.role === ACTOR.SUPER_ADMIN ? "super_admin" : "doctor";

  if (outcome === O.ATTENDED) {
    if (appt.paymentStatus !== "paid") throw appointmentError("PAYMENT_REQUIRED");
    // The consultation really took place but was never recorded. Closes it at
    // consultation_completed (clinical documentation is still required before
    // COMPLETED by the existing rule). No start timestamp is fabricated.
    const updated = await atomicTransition({
      appointmentId: appt._id,
      fromStatuses: [S.PAYMENT_COMPLETED, S.CONSULTATION_STARTED],
      set: {
        status: S.CONSULTATION_COMPLETED,
        "visit.state": V.COMPLETED,
        "visit.consultationEndedAt": now,
        "resolution.resolvedAt": now,
        "resolution.resolvedBy": actor._id,
        "resolution.resolvedByRole": role,
        "resolution.outcome": O.ATTENDED,
        "resolution.note": trimmed,
      },
      history: { status: S.CONSULTATION_COMPLETED, fromStatus: appt.status, actorId: actor._id, actorRole: role, event: "resolved_attended", reasonCode: REASON_CODE.RESOLVED_ATTENDED, visitState: V.COMPLETED, reason: trimmed },
    });
    const populated = await updated.populate(POPULATE);
    await safeEmit(() => appointmentEmitter.statusUpdated(populated), { appointmentId });
    return populated;
  }

  if (appt.status === S.CONSULTATION_STARTED) throw appointmentError("APPOINTMENT_ALREADY_STARTED"); // a started consultation can only be resolved as attended
  const map = {
    [O.PATIENT_NO_SHOW]: { code: REASON_CODE.PATIENT_NO_SHOW, visit: V.NO_SHOW_PATIENT, refund: false, by: role },
    [O.DOCTOR_NO_SHOW]: { code: REASON_CODE.DOCTOR_NO_SHOW, visit: V.NO_SHOW_DOCTOR, refund: true, by: role },
    [O.CANCELLED]: { code: role === "doctor" ? REASON_CODE.DOCTOR_CANCELLED : REASON_CODE.ADMIN_CANCELLED, visit: V.MISSED, refund: true, by: role },
  }[outcome];
  const { appointment } = await cancelAppointmentCore({
    appointment: appt, cancelledBy: map.by, actorId: actor._id, reasonCode: map.code, reason: trimmed, tz: rules.timezone, autoRefund: map.refund,
    extraSet: {
      "visit.state": map.visit,
      ...(outcome === O.CANCELLED ? {} : { "visit.noShowAt": now }),
      "resolution.resolvedAt": now, "resolution.resolvedBy": actor._id, "resolution.resolvedByRole": role, "resolution.outcome": outcome, "resolution.note": trimmed,
    },
  });
  return appointment;
};

// ── Sweep: flag unresolved, auto-expire beyond the window. IDEMPOTENT + BOUNDED. ──
const UNRESOLVED_STATUSES = [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED];

export const runUnresolvedAppointmentSweep = async ({ now = new Date(), batchSize = 200, jobRef = `unresolved-sweep:${now.toISOString()}` } = {}) => {
  const rules = await getAppointmentRules();
  const tz = rules.timezone;
  // Bound the scan with the indexed (status,date) key: nothing newer than
  // hospital-local "today" can have ended yet, and nothing older than
  // window+2 days is still within reach of the per-row classification.
  const today = hospitalToday(now, tz);
  const result = { flagged: 0, expired: 0, staleStarted: 0, skipped: 0 };

  const candidates = await Appointment.find({
    status: { $in: [...UNRESOLVED_STATUSES, S.CONSULTATION_STARTED] },
    date: { $lte: today },
  }).sort({ date: 1 }).limit(batchSize).populate(POPULATE);

  for (const appt of candidates) {
    const time = classifyAppointmentTime({ date: appt.date, timeSlot: appt.timeSlot, now, tz, resolutionWindowDays: rules.resolutionWindowDays, fallbackMinutes: rules.defaultSlotMinutes });
    if (time.state === T.UPCOMING || time.state === T.CURRENT || time.state === T.UNKNOWN) { result.skipped += 1; continue; }
    try {
      // A started consultation can never be auto-cancelled (the patient WAS
      // seen). It is flagged for doctor resolution and left for them/admin.
      if (appt.status === S.CONSULTATION_STARTED) {
        const flagged = await atomicTransition({
          appointmentId: appt._id, fromStatuses: [S.CONSULTATION_STARTED],
          extraFilter: { "resolution.flaggedAt": { $exists: false } },
          set: { "resolution.flaggedAt": now },
          history: { status: S.CONSULTATION_STARTED, fromStatus: S.CONSULTATION_STARTED, actorRole: "system", event: "resolution_required", reasonCode: REASON_CODE.MISSED_UNRESOLVED, reason: "Consultation was started but never completed", jobRef },
          returnNullOnConflict: true,
        });
        if (flagged) {
          result.staleStarted += 1;
          const populated = await flagged.populate(POPULATE);
          await safeEmit(() => appointmentEmitter.operational("resolution_required", populated, {
            notifyDoctor: { title: "Consultation needs completion", message: `A consultation on ${new Date(populated.date).toDateString()} at ${populated.timeSlot} was started but never completed.`, severity: "warning" },
          }), { appointmentId: appt._id });
        }
        continue;
      }

      if (time.state === T.EXPIRED) {
        const { appointment } = await cancelAppointmentCore({
          appointment: appt, cancelledBy: "system", reasonCode: REASON_CODE.MISSED_UNRESOLVED, jobRef, tz,
          reason: "Automatically cancelled because the appointment was not completed or resolved within the allowed resolution window.",
          // write-time guard: still unresolved, still not started
          extraFilter: { status: { $in: UNRESOLVED_STATUSES } },
        });
        result.expired += 1;
        const populated = await appointment.populate(POPULATE);
        await safeEmit(() => appointmentEmitter.operational("expired", populated, {}), { appointmentId: appt._id });
        continue;
      }

      // RECENTLY_MISSED: flag once (atomic, conditional on not-yet-flagged)
      const flagged = await atomicTransition({
        appointmentId: appt._id, fromStatuses: UNRESOLVED_STATUSES,
        fromVisitStates: [V.NOT_ARRIVED, V.CHECKED_IN, V.CALLED],
        extraFilter: { "resolution.flaggedAt": { $exists: false } },
        set: { "visit.state": V.MISSED, "resolution.flaggedAt": now },
        history: { status: appt.status, fromStatus: appt.status, actorRole: "system", event: "missed", reasonCode: REASON_CODE.MISSED_UNRESOLVED, visitState: V.MISSED, reason: "Appointment time passed without completion; awaiting resolution", jobRef },
        returnNullOnConflict: true,
      });
      if (flagged) {
        result.flagged += 1;
        await queueAppointmentEmails({ appointmentId: appt._id, event: "missed" });
        const populated = await flagged.populate(POPULATE);
        await safeEmit(() => appointmentEmitter.operational("missed", populated, {
          notifyPatient: { title: "Appointment missed", message: "Your appointment was missed and is awaiting resolution by your doctor.", severity: "warning" },
          notifyDoctor: { title: "Appointment needs resolution", message: `The appointment on ${new Date(populated.date).toDateString()} at ${populated.timeSlot} needs to be resolved.`, severity: "warning" },
        }), { appointmentId: appt._id });
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      if (["APPOINTMENT_STATE_CHANGED", "APPOINTMENT_NOT_FOUND"].includes(error?.details?.code)) { result.skipped += 1; continue; } // another actor won — correct
      logger.error("Unresolved-appointment sweep failed for appointment", { appointmentId: appt._id, message: error?.message });
    }
  }
  return { ...result, processedCount: result.flagged + result.expired + result.staleStarted };
};

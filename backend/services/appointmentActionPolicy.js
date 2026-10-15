// ─────────────────────────────────────────────────────────────────────────
// APPOINTMENT ACTION POLICY — the one backend-authoritative matrix that
// answers: "may THIS actor perform THIS action on THIS appointment NOW?"
//
// Pure (no DB, no clock reads): callers pass `now`, the hospital timezone
// and the configured rules. Every controller guard and the `allowedActions`
// list the UI renders come from this one function, so the UI can never
// offer an action the backend would reject (and the backend never trusts
// that the UI hid a button).
//
// Layers evaluated, in order, for every action:
//   role → lifecycle status → time window → visit state → payment
// ─────────────────────────────────────────────────────────────────────────
import { APPOINTMENT_STATUS as S, PAYMENT_STATUS } from "../constants/appointmentStatus.js";
import { VISIT_STATE as V } from "../constants/appointmentVisitState.js";
import { classifyAppointmentTime, APPOINTMENT_TIME_STATE as T, calendarDateKey, hospitalDateKey } from "../utils/hospitalTime.js";

export const ACTOR = Object.freeze({ PATIENT: "patient", DOCTOR: "doctor", SUPER_ADMIN: "super_admin", SYSTEM: "system" });

export const ACTION = Object.freeze({
  VIEW: "view",
  APPROVE: "approve",
  REJECT: "reject",
  CANCEL: "cancel",
  RESCHEDULE: "reschedule",
  PAY: "pay",
  CHECK_IN: "check_in",
  CALL_PATIENT: "call_patient",
  START_CONSULTATION: "start_consultation",
  COMPLETE_CONSULTATION: "complete_consultation",
  FINALIZE: "finalize",
  ADD_CLINICAL: "add_clinical", // notes / prescription / report / certificate
  MARK_PATIENT_NO_SHOW: "mark_patient_no_show",
  REPORT_DOCTOR_NO_SHOW: "report_doctor_no_show",
  RESOLVE_MISSED: "resolve_missed",
  JOIN_ONLINE: "join_online",
  REVIEW: "review",
});

const ok = () => ({ allowed: true, code: null });
const no = (code, extra = {}) => ({ allowed: false, code, ...extra });

const PRE_CONSULTATION = [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED];
const POST_CONSULTATION = [S.CONSULTATION_COMPLETED, S.COMPLETED, S.REVIEW_ELIGIBLE];

export const visitStateOf = (appointment) => appointment?.visit?.state || V.NOT_ARRIVED;

/** Terminal-status short circuit shared by every mutating action. */
const terminalBlock = (status) => {
  if (status === S.CANCELLED) return no("APPOINTMENT_ALREADY_CANCELLED");
  if ([S.COMPLETED, S.REVIEW_ELIGIBLE].includes(status)) return no("APPOINTMENT_ALREADY_COMPLETED");
  return null;
};

/**
 * @param {object} p
 * @param {string} p.action  one of ACTION
 * @param {string} p.actorRole  one of ACTOR
 * @param {object} p.appointment  needs { status, paymentStatus, date, timeSlot, visit?, consultationMode? }
 * @param {Date}   p.now
 * @param {string} p.tz
 * @param {object} p.rules  getAppointmentRules() result
 * @returns {{allowed:boolean, code:string|null, timeState:string}}
 */
export const evaluateAppointmentAction = ({ action, actorRole, appointment, now = new Date(), tz, rules }) => {
  const status = appointment.status;
  const visit = visitStateOf(appointment);
  const time = classifyAppointmentTime({
    date: appointment.date,
    timeSlot: appointment.timeSlot,
    now,
    tz,
    resolutionWindowDays: rules.resolutionWindowDays,
    fallbackMinutes: rules.defaultSlotMinutes,
  });
  const timeState = time.state;
  const withTime = (r) => ({ ...r, timeState });

  if (!Object.values(ACTOR).includes(actorRole)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
  const isDoctor = actorRole === ACTOR.DOCTOR;
  const isPatient = actorRole === ACTOR.PATIENT;
  const isAdmin = actorRole === ACTOR.SUPER_ADMIN;
  const nowMs = new Date(now).getTime();
  const startMs = time.start?.getTime();
  const endMs = time.end?.getTime();
  const earlyMs = (rules.earlyStartWindowMinutes || 0) * 60000;
  const checkInMs = (rules.checkInEarlyWindowMinutes || 0) * 60000;
  const graceMs = (rules.noShowGraceMinutes || 0) * 60000;
  const hasTime = timeState !== T.UNKNOWN;
  const missedOrExpired = timeState === T.RECENTLY_MISSED || timeState === T.EXPIRED;
  // A closed-out unresolved appointment (system expiry) is always cancelled, so
  // EXPIRED here means "past the window but the job has not run yet".
  const pastWindowBlock = () => (timeState === T.EXPIRED ? no("APPOINTMENT_RESOLUTION_WINDOW_EXPIRED") : null);

  switch (action) {
    case ACTION.VIEW:
      return withTime(ok());

    case ACTION.APPROVE: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status !== S.PENDING) return withTime(no("INVALID_APPOINTMENT_TRANSITION"));
      if (hasTime && nowMs > endMs) return withTime(no("APPOINTMENT_NOT_FUTURE"));
      return withTime(ok());
    }

    case ACTION.REJECT:
    case ACTION.CANCEL: {
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (![S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED].includes(status)) {
        return withTime(no(status === S.CONSULTATION_STARTED ? "APPOINTMENT_ALREADY_STARTED" : "INVALID_APPOINTMENT_TRANSITION"));
      }
      if (visit === V.IN_CONSULTATION) return withTime(no("APPOINTMENT_ALREADY_STARTED"));
      // A patient may not cancel once the slot has started (that is a no-show
      // or a resolution matter, not a cancellation).
      if (isPatient && hasTime && nowMs >= startMs) return withTime(no("APPOINTMENT_NOT_FUTURE"));
      if (isPatient && action === ACTION.REJECT) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      return withTime(ok());
    }

    case ACTION.RESCHEDULE: {
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (![S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED].includes(status)) return withTime(no("APPOINTMENT_ALREADY_STARTED"));
      if (visit !== V.NOT_ARRIVED && !(visit === V.MISSED && (isDoctor || isAdmin))) return withTime(no("ACTION_NOT_ALLOWED"));
      if (hasTime && nowMs >= startMs && !isDoctor && !isAdmin) return withTime(no("APPOINTMENT_NOT_FUTURE"));
      if (hasTime && missedOrExpired && !(isDoctor || isAdmin)) return withTime(no("APPOINTMENT_RESOLUTION_REQUIRED"));
      return withTime(ok());
    }

    case ACTION.PAY: {
      if (!isPatient) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      if (status === S.CANCELLED) return withTime(no("APPOINTMENT_ALREADY_CANCELLED"));
      if (appointment.paymentStatus === PAYMENT_STATUS.PAID) return withTime(no("ACTION_NOT_ALLOWED"));
      if (![S.APPROVED, S.PAYMENT_PENDING].includes(status)) return withTime(no(status === S.PENDING ? "ACTION_NOT_ALLOWED" : "INVALID_APPOINTMENT_TRANSITION"));
      if (hasTime && nowMs > endMs) return withTime(no("APPOINTMENT_NOT_FUTURE"));
      return withTime(ok());
    }

    case ACTION.CHECK_IN: {
      if (!isPatient) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status !== S.PAYMENT_COMPLETED) return withTime(no(PRE_CONSULTATION.includes(status) ? "PAYMENT_REQUIRED" : "APPOINTMENT_NOT_ACTIVE"));
      if (visit !== V.NOT_ARRIVED) return withTime(no(visit === V.CHECKED_IN || visit === V.CALLED ? "CHECKIN_ALREADY_COMPLETED" : "APPOINTMENT_NOT_ACTIVE"));
      if (!hasTime) return withTime(no("CHECKIN_NOT_OPEN"));
      if (nowMs < startMs - checkInMs) return withTime(no("CHECKIN_NOT_OPEN"));
      if (nowMs > endMs) return withTime(no(timeState === T.EXPIRED ? "APPOINTMENT_ALREADY_EXPIRED" : "APPOINTMENT_RESOLUTION_REQUIRED"));
      return withTime(ok());
    }

    case ACTION.CALL_PATIENT: {
      if (!isDoctor) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status !== S.PAYMENT_COMPLETED) return withTime(no("APPOINTMENT_NOT_ACTIVE"));
      if (visit !== V.CHECKED_IN) return withTime(no(visit === V.CALLED ? "ACTION_NOT_ALLOWED" : "PATIENT_NOT_CHECKED_IN"));
      return withTime(ok());
    }

    case ACTION.START_CONSULTATION: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status === S.CONSULTATION_STARTED) return withTime(no("APPOINTMENT_ALREADY_STARTED"));
      if (status !== S.PAYMENT_COMPLETED) return withTime(no(PRE_CONSULTATION.includes(status) ? "PAYMENT_REQUIRED" : "INVALID_APPOINTMENT_TRANSITION"));
      if (!hasTime) return withTime(ok()); // legacy free-typed slot: no instant to enforce against
      if (timeState === T.EXPIRED) return withTime(no("APPOINTMENT_RESOLUTION_WINDOW_EXPIRED"));
      if (nowMs < startMs - earlyMs) return withTime(no("APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW", { opensAt: new Date(startMs - earlyMs).toISOString() }));
      if (nowMs > endMs) {
        // Doctor running late with the patient physically present on the SAME
        // hospital day is a real, common case — allowed. Anything else past
        // the slot must go through the explicit resolve-missed workflow.
        const patientPresent = visit === V.CHECKED_IN || visit === V.CALLED;
        const sameDay = calendarDateKey(appointment.date) === hospitalDateKey(now, tz);
        if (!(patientPresent && sameDay)) return withTime(no("APPOINTMENT_RESOLUTION_REQUIRED"));
      }
      return withTime(ok());
    }

    case ACTION.COMPLETE_CONSULTATION: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status !== S.CONSULTATION_STARTED) return withTime(no("CONSULTATION_NOT_STARTED"));
      if (hasTime && nowMs < startMs - earlyMs) return withTime(no("APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW"));
      return withTime(ok());
    }

    case ACTION.FINALIZE: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      if (status !== S.CONSULTATION_COMPLETED) return withTime(no(status === S.CANCELLED ? "APPOINTMENT_ALREADY_CANCELLED" : "INVALID_APPOINTMENT_TRANSITION"));
      return withTime(ok());
    }

    case ACTION.ADD_CLINICAL: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      if (status === S.CANCELLED) return withTime(no("APPOINTMENT_ALREADY_CANCELLED"));
      if (![S.CONSULTATION_STARTED, ...POST_CONSULTATION].includes(status)) return withTime(no("CONSULTATION_NOT_STARTED"));
      return withTime(ok());
    }

    case ACTION.MARK_PATIENT_NO_SHOW: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status !== S.PAYMENT_COMPLETED) return withTime(no("APPOINTMENT_NOT_ACTIVE"));
      if (visit !== V.NOT_ARRIVED && visit !== V.MISSED) return withTime(no(visit === V.CHECKED_IN || visit === V.CALLED ? "ACTION_NOT_ALLOWED" : "APPOINTMENT_NOT_ACTIVE"));
      if (!hasTime || nowMs < startMs + graceMs) return withTime(no("APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW", { opensAt: hasTime ? new Date(startMs + graceMs).toISOString() : undefined }));
      const p = pastWindowBlock();
      if (p) return withTime(p);
      return withTime(ok());
    }

    case ACTION.REPORT_DOCTOR_NO_SHOW: {
      if (!isPatient) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (status !== S.PAYMENT_COMPLETED) return withTime(no("APPOINTMENT_NOT_ACTIVE"));
      // Evidence: the patient really checked in, and the doctor never started.
      if (visit !== V.CHECKED_IN && visit !== V.CALLED) return withTime(no("PATIENT_NOT_CHECKED_IN"));
      if (!hasTime || nowMs < startMs + graceMs) return withTime(no("APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW"));
      const p = pastWindowBlock();
      if (p) return withTime(p);
      return withTime(ok());
    }

    case ACTION.RESOLVE_MISSED: {
      if (!(isDoctor || isAdmin)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (![...PRE_CONSULTATION, S.CONSULTATION_STARTED].includes(status)) return withTime(no("APPOINTMENT_RESOLUTION_NOT_REQUIRED"));
      if (!hasTime || timeState === T.UPCOMING || timeState === T.CURRENT) return withTime(no("APPOINTMENT_RESOLUTION_NOT_REQUIRED"));
      // A consultation that genuinely started was a real visit: it can always be
      // reconciled (as attended) — the window only governs never-started ones.
      if (status === S.CONSULTATION_STARTED) return withTime(ok());
      if (timeState === T.EXPIRED) return withTime(no("APPOINTMENT_RESOLUTION_WINDOW_EXPIRED"));
      return withTime(ok());
    }

    case ACTION.JOIN_ONLINE: {
      if (!(isPatient || isDoctor)) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      if (appointment.consultationMode !== "online") return withTime(no("INVALID_APPOINTMENT_MODE"));
      const t = terminalBlock(status);
      if (t) return withTime(t);
      if (![S.PAYMENT_COMPLETED, S.CONSULTATION_STARTED].includes(status)) return withTime(no("PAYMENT_REQUIRED"));
      if (!hasTime || nowMs < startMs - checkInMs || nowMs > endMs) return withTime(no("APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW"));
      return withTime(ok());
    }

    case ACTION.REVIEW: {
      if (!isPatient) return withTime(no("UNAUTHORIZED_APPOINTMENT_ACTION"));
      return withTime([S.COMPLETED, S.REVIEW_ELIGIBLE].includes(status) ? ok() : no("ACTION_NOT_ALLOWED"));
    }

    default:
      return withTime(no("ACTION_NOT_ALLOWED"));
  }
};

/** Throws the structured AppError for a denied action; returns the verdict otherwise. */
export const assertActionAllowed = async (args, makeError) => {
  const verdict = evaluateAppointmentAction(args);
  if (!verdict.allowed) throw makeError(verdict.code, { action: args.action, timeState: verdict.timeState, ...(verdict.opensAt ? { opensAt: verdict.opensAt } : {}) });
  return verdict;
};

/** Every action's verdict for one actor — the UI renders buttons from THIS, never from raw status. */
export const listAllowedActions = (args) => {
  const result = {};
  for (const action of Object.values(ACTION)) {
    const v = evaluateAppointmentAction({ ...args, action });
    result[action] = v.allowed ? { allowed: true } : { allowed: false, code: v.code, ...(v.opensAt ? { opensAt: v.opensAt } : {}) };
  }
  return result;
};

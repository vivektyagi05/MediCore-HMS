// Operational VISIT state — deliberately separate from Appointment.status
// (the payment/business lifecycle in constants/appointmentStatus.js).
// Status answers "where is this in the booking/payment/clinical lifecycle";
// visit state answers "what is physically/operationally happening on the day".
// "waiting" is NOT a separate state: a patient who is checked in and not yet
// called IS waiting (queue position derives from visit.checkedInAt).
export const VISIT_STATE = Object.freeze({
  NOT_ARRIVED: "not_arrived",
  CHECKED_IN: "checked_in",
  CALLED: "called",
  IN_CONSULTATION: "in_consultation",
  COMPLETED: "completed",
  NO_SHOW_PATIENT: "no_show_patient",
  NO_SHOW_DOCTOR: "no_show_doctor",
  MISSED: "missed", // time passed with no check-in and no resolution; awaiting doctor resolution
  EXPIRED: "expired", // system closed it after the resolution window
});
export const VISIT_STATE_VALUES = Object.freeze(Object.values(VISIT_STATE));

export const VISIT_TRANSITIONS = Object.freeze({
  [VISIT_STATE.NOT_ARRIVED]: [VISIT_STATE.CHECKED_IN, VISIT_STATE.IN_CONSULTATION, VISIT_STATE.NO_SHOW_PATIENT, VISIT_STATE.MISSED, VISIT_STATE.EXPIRED],
  [VISIT_STATE.CHECKED_IN]: [VISIT_STATE.CALLED, VISIT_STATE.IN_CONSULTATION, VISIT_STATE.NO_SHOW_DOCTOR, VISIT_STATE.MISSED, VISIT_STATE.EXPIRED],
  [VISIT_STATE.CALLED]: [VISIT_STATE.IN_CONSULTATION, VISIT_STATE.NO_SHOW_DOCTOR, VISIT_STATE.MISSED, VISIT_STATE.EXPIRED],
  [VISIT_STATE.IN_CONSULTATION]: [VISIT_STATE.COMPLETED],
  [VISIT_STATE.MISSED]: [VISIT_STATE.COMPLETED, VISIT_STATE.NO_SHOW_PATIENT, VISIT_STATE.NO_SHOW_DOCTOR, VISIT_STATE.EXPIRED],
  [VISIT_STATE.COMPLETED]: [],
  [VISIT_STATE.NO_SHOW_PATIENT]: [],
  [VISIT_STATE.NO_SHOW_DOCTOR]: [],
  [VISIT_STATE.EXPIRED]: [],
});

// Distinct business concepts (never collapsed into one generic "cancelled").
export const CANCELLATION_SOURCE = Object.freeze({
  PATIENT: "patient",
  DOCTOR: "doctor",
  SUPER_ADMIN: "super_admin",
  SYSTEM: "system",
});

export const REASON_CODE = Object.freeze({
  PATIENT_CANCELLED: "PATIENT_CANCELLED",
  DOCTOR_CANCELLED: "DOCTOR_CANCELLED",
  ADMIN_CANCELLED: "ADMIN_CANCELLED",
  PAYMENT_WINDOW_EXPIRED: "PAYMENT_WINDOW_EXPIRED",
  APPOINTMENT_EXPIRED: "APPOINTMENT_EXPIRED",
  MISSED_UNRESOLVED: "MISSED_UNRESOLVED",
  PATIENT_NO_SHOW: "PATIENT_NO_SHOW",
  DOCTOR_NO_SHOW: "DOCTOR_NO_SHOW",
  LEAVE_IMPACT: "LEAVE_IMPACT",
  SCHEDULE_IMPACT: "SCHEDULE_IMPACT",
  RESOLVED_ATTENDED: "RESOLVED_ATTENDED",
});

export const RESOLUTION_OUTCOME = Object.freeze({
  ATTENDED: "attended", // consultation really happened; doctor reconciles it
  PATIENT_NO_SHOW: "patient_no_show",
  DOCTOR_NO_SHOW: "doctor_no_show",
  CANCELLED: "cancelled",
});
export const RESOLUTION_OUTCOME_VALUES = Object.freeze(Object.values(RESOLUTION_OUTCOME));

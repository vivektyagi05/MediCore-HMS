export const APPOINTMENT_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  PAYMENT_PENDING: "payment_pending",
  PAYMENT_COMPLETED: "payment_completed",
  CONSULTATION_STARTED: "consultation_started",
  CONSULTATION_COMPLETED: "consultation_completed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REVIEW_ELIGIBLE: "review_eligible",
});

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
};

export const APPOINTMENT_STATUS_VALUES = Object.freeze(
  Object.values(APPOINTMENT_STATUS),
);

export const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUS));

// Full legal transition map — illegal transitions are absent
export const STATUS_TRANSITIONS = Object.freeze({
  [APPOINTMENT_STATUS.PENDING]: [
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.APPROVED]: [
    APPOINTMENT_STATUS.PAYMENT_PENDING,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.PAYMENT_PENDING]: [
    APPOINTMENT_STATUS.PAYMENT_COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.PAYMENT_COMPLETED]: [
    APPOINTMENT_STATUS.CONSULTATION_STARTED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.CONSULTATION_STARTED]: [
    APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
  ],
  [APPOINTMENT_STATUS.CONSULTATION_COMPLETED]: [
    APPOINTMENT_STATUS.COMPLETED,
  ],
  [APPOINTMENT_STATUS.COMPLETED]: [
    APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
  ],
  [APPOINTMENT_STATUS.REVIEW_ELIGIBLE]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
});

// Human-readable status labels for API responses
export const STATUS_LABELS = Object.freeze({
  [APPOINTMENT_STATUS.PENDING]: "Appointment Requested",
  [APPOINTMENT_STATUS.APPROVED]: "Doctor Approved",
  [APPOINTMENT_STATUS.PAYMENT_PENDING]: "Payment Pending",
  [APPOINTMENT_STATUS.PAYMENT_COMPLETED]: "Payment Completed",
  [APPOINTMENT_STATUS.CONSULTATION_STARTED]: "Consultation Started",
  [APPOINTMENT_STATUS.CONSULTATION_COMPLETED]: "Consultation Completed",
  [APPOINTMENT_STATUS.COMPLETED]: "Completed",
  [APPOINTMENT_STATUS.REVIEW_ELIGIBLE]: "Review Eligible",
  [APPOINTMENT_STATUS.CANCELLED]: "Cancelled",
});

// Which statuses are considered "active" for slot-blocking
export const ACTIVE_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.APPROVED,
  APPOINTMENT_STATUS.PAYMENT_PENDING,
  APPOINTMENT_STATUS.PAYMENT_COMPLETED,
  APPOINTMENT_STATUS.CONSULTATION_STARTED,
  APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
]);

// Statuses where the appointment is done (cannot be cancelled)
export const TERMINAL_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
  APPOINTMENT_STATUS.CANCELLED,
  APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
]);

// Statuses where doctor payout is eligible
export const PAYOUT_ELIGIBLE_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
]);

// BUGFIX (Phase UI-3 audit): cancelAppointment previously decided
// "cancellable" from TERMINAL_STATUSES alone (i.e. "not done yet" =
// cancellable), which is a SEPARATE rule from STATUS_TRANSITIONS above and
// had drifted out of sync with it. STATUS_TRANSITIONS never lists CANCELLED
// as a legal target from CONSULTATION_STARTED, but TERMINAL_STATUSES also
// never listed CONSULTATION_STARTED as terminal — so a consultation already
// in progress could still be unilaterally cancelled by the patient, an
// invalid-transition bug two independently-maintained lists let through.
// CANCELLABLE_STATUSES is now derived FROM STATUS_TRANSITIONS itself (one
// source of truth, cannot drift) and is what both the patient-facing and
// admin-facing cancellation paths use.
export const CANCELLABLE_STATUSES = Object.freeze(
  Object.entries(STATUS_TRANSITIONS)
    .filter(([, targets]) => targets.includes(APPOINTMENT_STATUS.CANCELLED))
    .map(([from]) => from),
);

// Maps stable backend error codes (error.response.data.details.code) to
// human-readable text. The backend message is always a safe fallback; stack
// traces/provider internals never reach the client.
const MESSAGES = {
  APPOINTMENT_NOT_FOUND: "We couldn't find this appointment.",
  APPOINTMENT_NOT_OWNED: "You don't have access to this appointment.",
  UNAUTHORIZED_APPOINTMENT_ACTION: "You aren't allowed to do that for this appointment.",
  APPOINTMENT_NOT_ACTIVE: "This appointment is no longer active.",
  APPOINTMENT_ALREADY_CANCELLED: "This appointment has already been cancelled.",
  APPOINTMENT_ALREADY_COMPLETED: "This appointment is already completed.",
  APPOINTMENT_ALREADY_STARTED: "The consultation has already started.",
  APPOINTMENT_ALREADY_EXPIRED: "This appointment has expired.",
  APPOINTMENT_NOT_FUTURE: "This appointment time has already started or passed.",
  APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW: "That isn't available at this time for this appointment.",
  APPOINTMENT_RESOLUTION_REQUIRED: "This appointment was missed and must be resolved first.",
  APPOINTMENT_RESOLUTION_WINDOW_EXPIRED: "The time to resolve this appointment has passed.",
  APPOINTMENT_RESOLUTION_NOT_REQUIRED: "This appointment doesn't need resolution.",
  APPOINTMENT_STATE_CHANGED: "This appointment was just updated. Please refresh and try again.",
  INVALID_APPOINTMENT_TRANSITION: "That change isn't allowed for this appointment's current status.",
  CHECKIN_NOT_OPEN: "Check-in isn't open yet.",
  CHECKIN_ALREADY_COMPLETED: "You're already checked in.",
  PATIENT_NOT_CHECKED_IN: "The patient hasn't checked in.",
  CONSULTATION_NOT_STARTED: "The consultation hasn't started.",
  PAYMENT_REQUIRED: "Payment is required first.",
  REFUND_NOT_ELIGIBLE: "This appointment isn't eligible for a refund.",
  REASON_REQUIRED: "Please add a short reason.",
  INVALID_APPOINTMENT_MODE: "This consultation type needs more information.",
  ACTION_NOT_ALLOWED: "That action isn't available right now.",
  SLOT_CONFLICT: "That time was just booked by someone else. Please pick another.",
  PATIENT_SLOT_CONFLICT: "You already have an appointment that overlaps this time.",
  DAILY_CAPACITY_REACHED: "The doctor is fully booked for that day. Please pick another date.",
  TRAVEL_BUFFER_CONFLICT: "That time leaves too little travel time for this doctor. Please pick another.",
};

export const getAppointmentErrorCode = (error) => error?.response?.data?.details?.code || null;

/** Human message for an axios error; null when the error carries no appointment code. */
export const getAppointmentErrorMessage = (error) => {
  const code = getAppointmentErrorCode(error);
  if (!code) return null;
  return MESSAGES[code] || error.response?.data?.message || null;
};

// Conflicts that mean "your screen is stale": callers should refetch.
export const isStaleStateError = (error) =>
  ["APPOINTMENT_STATE_CHANGED", "SLOT_CONFLICT", "APPOINTMENT_ALREADY_CANCELLED", "APPOINTMENT_ALREADY_COMPLETED", "APPOINTMENT_ALREADY_EXPIRED", "APPOINTMENT_NOT_ACTIVE"].includes(getAppointmentErrorCode(error));

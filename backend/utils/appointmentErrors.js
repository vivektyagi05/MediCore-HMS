// Stable, machine-readable appointment business errors. The frontend maps
// `details.code` to human text; messages here are safe to show and never
// contain stack traces or provider internals.
import { AppError } from "../middleware/errorMiddleware.js";

export const APPOINTMENT_ERROR = Object.freeze({
  APPOINTMENT_NOT_FOUND: { status: 404, message: "Appointment not found." },
  APPOINTMENT_NOT_OWNED: { status: 403, message: "You are not allowed to act on this appointment." },
  UNAUTHORIZED_APPOINTMENT_ACTION: { status: 403, message: "You are not allowed to perform this action." },
  APPOINTMENT_NOT_ACTIVE: { status: 409, message: "This appointment is no longer active." },
  APPOINTMENT_ALREADY_CANCELLED: { status: 409, message: "This appointment has already been cancelled." },
  APPOINTMENT_ALREADY_COMPLETED: { status: 409, message: "This appointment has already been completed." },
  APPOINTMENT_ALREADY_STARTED: { status: 409, message: "The consultation has already started." },
  APPOINTMENT_ALREADY_EXPIRED: { status: 409, message: "This appointment has expired." },
  APPOINTMENT_NOT_FUTURE: { status: 409, message: "This appointment is no longer in the future." },
  APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW: { status: 409, message: "This action is not available at this time for this appointment." },
  APPOINTMENT_RESOLUTION_REQUIRED: { status: 409, message: "This appointment was missed and must be resolved before any other action." },
  APPOINTMENT_RESOLUTION_WINDOW_EXPIRED: { status: 409, message: "The window to resolve this appointment has passed." },
  APPOINTMENT_RESOLUTION_NOT_REQUIRED: { status: 409, message: "This appointment does not need resolution." },
  APPOINTMENT_STATE_CHANGED: { status: 409, message: "This appointment was just updated by someone else. Please refresh and try again." },
  INVALID_APPOINTMENT_TRANSITION: { status: 400, message: "That change is not allowed for this appointment's current status." },
  CHECKIN_NOT_OPEN: { status: 409, message: "Check-in is not open yet for this appointment." },
  CHECKIN_ALREADY_COMPLETED: { status: 409, message: "You have already checked in." },
  PATIENT_NOT_CHECKED_IN: { status: 409, message: "The patient has not checked in." },
  CONSULTATION_NOT_STARTED: { status: 409, message: "The consultation has not started." },
  PAYMENT_REQUIRED: { status: 402, message: "Payment is required for this action." },
  PAYMENT_WINDOW_EXPIRED: { status: 409, message: "The payment window for this appointment has expired." },
  REFUND_NOT_ELIGIBLE: { status: 409, message: "This appointment is not eligible for a refund." },
  REASON_REQUIRED: { status: 400, message: "A reason is required for this action." },
  INVALID_APPOINTMENT_MODE: { status: 400, message: "This consultation mode is not valid for the appointment." },
  ACTION_NOT_ALLOWED: { status: 409, message: "This action is not allowed for this appointment right now." },
});

export const appointmentError = (code, extra = {}, messageOverride) => {
  const def = APPOINTMENT_ERROR[code] || { status: 409, message: "This action is not allowed." };
  return new AppError(messageOverride || def.message, def.status, { code, ...extra });
};

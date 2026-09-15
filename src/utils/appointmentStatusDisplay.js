// Reuses STATUS_LABELS (doctorAppointmentWorkflow.js) for text so the admin
// workspace and doctor workspace never show two different names for the
// same status — only the StatusBadge *tone* mapping is new here.
import { STATUS_LABELS } from "./doctorAppointmentWorkflow.js";

export const APPOINTMENT_STATUS_TONE = {
  pending: "warning",
  approved: "info",
  payment_pending: "warning",
  payment_completed: "sky",
  consultation_started: "violet",
  consultation_completed: "teal",
  completed: "success",
  review_eligible: "success",
  cancelled: "danger",
};

export function appointmentStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function appointmentStatusTone(status) {
  return APPOINTMENT_STATUS_TONE[status] || "neutral";
}

export const PAYMENT_STATUS_LABELS = {
  pending: "Payment Pending",
  paid: "Paid",
  failed: "Payment Failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_TONE = {
  pending: "warning",
  paid: "success",
  failed: "danger",
  refunded: "sky",
};

export function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status || "—";
}

export function paymentStatusTone(status) {
  return PAYMENT_STATUS_TONE[status] || "neutral";
}

export const CONSULTATION_MODE_LABELS = {
  in_person: "In Person",
  online: "Online",
  home_visit: "Home Visit",
};

export function consultationModeLabel(mode) {
  return CONSULTATION_MODE_LABELS[mode] || mode || "—";
}

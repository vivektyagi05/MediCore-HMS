// Mirrors backend/constants/appointmentStatus.js STATUS_TRANSITIONS exactly.
// Kept as a small standalone module (not imported from the backend, which the
// frontend cannot reach at build time) so every doctor-facing screen offers
// the SAME legal next action instead of each page inventing its own guess —
// the root cause of the "approved -> completed" illegal-transition bug found
// during the audit of this phase.

export const STATUS_LABELS = {
  pending: "Appointment Requested",
  approved: "Doctor Approved",
  payment_pending: "Payment Pending",
  payment_completed: "Payment Completed",
  consultation_started: "Consultation In Progress",
  consultation_completed: "Consultation Completed",
  completed: "Completed",
  review_eligible: "Review Eligible",
  cancelled: "Cancelled",
};

export const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  payment_pending: "bg-orange-100 text-orange-700",
  payment_completed: "bg-cyan-100 text-cyan-700",
  consultation_started: "bg-indigo-100 text-indigo-700",
  consultation_completed: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  review_eligible: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

// The single doctor-actionable next step for a given current status, or null
// if the doctor has nothing to do right now (e.g. waiting on patient payment).
export function getDoctorAction(appointment) {
  switch (appointment.status) {
    case "pending":
      return { label: "Approve", nextStatus: "approved", variant: "primary" };
    case "payment_completed":
      return { label: "Start Consultation", nextStatus: "consultation_started", variant: "primary" };
    case "consultation_started":
      return { label: "End Consultation", nextStatus: "consultation_completed", variant: "primary" };
    case "consultation_completed":
      return { label: "Mark Completed", nextStatus: "completed", variant: "primary" };
    default:
      return null;
  }
}

// Whether the doctor can still reject/cancel from this status.
export function canDoctorCancel(status) {
  return ["pending", "approved", "payment_pending", "payment_completed"].includes(status);
}

export function isAwaitingPatient(status) {
  return status === "approved" || status === "payment_pending";
}

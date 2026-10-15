// Presentation-only mapping from SERVER-provided fields to a friendly state.
// No clocks, no inference: if the backend didn't say it, the UI doesn't claim it.
// Inputs come from GET /appointments/:id/actions (and the appointment doc).
export const OPERATIONAL_TONE = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
};

export const describeOperationalState = ({ status, visitState, resolutionRequired, cancellation, timeState } = {}) => {
  if (status === "cancelled") {
    if (cancellation?.source === "system") return { label: "Automatically cancelled", tone: "danger", detail: "Automatically cancelled because the appointment was not completed or resolved within the allowed resolution window." };
    if (visitState === "no_show_patient") return { label: "Patient no-show", tone: "danger", detail: "The patient did not attend this appointment." };
    if (visitState === "no_show_doctor") return { label: "Doctor no-show", tone: "danger", detail: "The doctor did not start the consultation. A refund request was raised." };
    return { label: "Cancelled", tone: "danger", detail: null };
  }
  if (["completed", "review_eligible"].includes(status)) return { label: "Completed", tone: "success", detail: null };
  if (status === "consultation_completed") return { label: "Consultation done", tone: "success", detail: "Documentation is being finalized." };
  if (status === "consultation_started" || visitState === "in_consultation") {
    return resolutionRequired
      ? { label: "Needs resolution", tone: "warning", detail: "This consultation was started but never completed." }
      : { label: "In consultation", tone: "info", detail: null };
  }
  if (resolutionRequired || visitState === "missed") return { label: "Needs resolution", tone: "warning", detail: "This appointment was missed and is awaiting resolution." };
  if (visitState === "called") return { label: "Doctor is ready", tone: "success", detail: "Your doctor is ready to see you." };
  if (visitState === "checked_in") return { label: "Waiting", tone: "info", detail: "You're checked in. Your doctor will call you." };
  if (timeState === "CURRENT") return { label: "Today · now", tone: "info", detail: null };
  return { label: "Upcoming", tone: "neutral", detail: null };
};

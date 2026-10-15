// Appointment transactional emails → durable outbox. Content is deliberately
// minimal-PHI: reference, names, date/time, mode, status and the next action —
// never symptoms, notes, diagnoses or prescriptions.
import Appointment from "../models/Appointment.js";
import { enqueueEmail } from "./emailOutboxService.js";
import { getAppointmentRules } from "./hospitalSettingsService.js";
import { resolveAppointmentInstant } from "../utils/hospitalTime.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MODE = { online: "Online consultation", offline: "In-clinic visit", in_person: "In-clinic visit", home_visit: "Home visit" };
export const refOf = (id) => `APT-${String(id).slice(-8).toUpperCase()}`;

const whenText = (appt, tz) => {
  const instant = resolveAppointmentInstant(appt.date, appt.timeSlot, tz);
  const day = new Date(appt.date).toISOString().slice(0, 10);
  return instant ? `${day}, ${appt.timeSlot} (${tz})` : `${day}, ${appt.timeSlot}`;
};

const shell = ({ heading, lines, status, next }) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#0f766e">${esc(heading)}</h2>
${lines.map((l) => `<p style="margin:6px 0">${esc(l)}</p>`).join("")}
<p style="margin:12px 0"><strong>Status:</strong> ${esc(status)}</p>
${next ? `<p style="margin:6px 0"><strong>Next step:</strong> ${esc(next)}</p>` : ""}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
<p style="font-size:12px;color:#6b7280">${esc(env.hospital?.name || "Hospital")} · This is an automated message. For help, please contact hospital support.</p></div>`;

// Per-event content. `to` is "patient" | "doctor".
export const buildAppointmentEmail = ({ event, to, appointment, tz, extra = {} }) => {
  const ref = refOf(appointment._id);
  const mode = MODE[appointment.consultationMode] || "Consultation";
  const when = whenText(appointment, tz);
  const patient = appointment.patientId?.name || "Patient";
  const doctor = appointment.doctorId?.userId?.name ? `Dr. ${appointment.doctorId.userId.name}` : "your doctor";
  const base = [`Reference: ${ref}`, `${to === "patient" ? `Doctor: ${doctor}` : `Patient: ${patient}`}`, `When: ${when}`, `Type: ${mode}`];
  const T = {
    cancelled: { subject: `Appointment cancelled (${ref})`, heading: "Appointment cancelled", status: "Cancelled", lines: [...base, extra.reason ? `Reason: ${extra.reason}` : "This appointment was cancelled."], next: to === "patient" ? "You can book a new appointment at any time. If you paid, any refund follows the refund policy." : "No action is needed." },
    expired: { subject: `Appointment automatically cancelled (${ref})`, heading: "Appointment automatically cancelled", status: "Automatically cancelled", lines: [...base, "This appointment was automatically cancelled because it was not completed or resolved within the allowed resolution window."], next: to === "patient" ? "If you paid, a refund request has been raised for review. You may book a new appointment." : "No action is needed." },
    missed: { subject: `Appointment missed – awaiting resolution (${ref})`, heading: "Appointment missed", status: "Awaiting resolution", lines: [...base, "The appointment time has passed without a completed consultation."], next: to === "doctor" ? "Please resolve this appointment in Today's Clinic before the resolution window closes." : "Your doctor will resolve this appointment. You do not need to do anything yet." },
    no_show: { subject: `Appointment closed – patient did not attend (${ref})`, heading: "Appointment closed", status: "Patient no-show", lines: [...base, "The patient did not attend this appointment."], next: "You may book a new appointment if you still need care." },
    doctor_no_show: { subject: `Doctor did not attend (${ref})`, heading: "Doctor did not attend", status: "Closed – doctor no-show", lines: [...base, "The doctor did not start the consultation after you checked in. We are sorry for the inconvenience."], next: "A refund request has been raised for review." },
    rescheduled: { subject: `Appointment rescheduled (${ref})`, heading: "Appointment rescheduled", status: "Rescheduled", lines: [...base, extra.from ? `Previously: ${extra.from}` : ""].filter(Boolean), next: "Please check the new time. Reminders will be sent for the new time." },
  };
  const t = T[event];
  if (!t) return null;
  return { subject: t.subject, html: shell(t) };
};

/**
 * Queue emails for both parties of an appointment event. Never throws and
 * never blocks the business flow; idempotent via eventKey per recipient.
 * `skip` omits a recipient (e.g. the actor who performed the action).
 */
export const queueAppointmentEmails = async ({ appointmentId, event, version = "", extra = {}, skip = [] }) => {
  try {
    const appointment = await Appointment.findById(appointmentId)
      .populate("patientId", "name email")
      .populate({ path: "doctorId", select: "userId", populate: { path: "userId", select: "name email" } })
      .lean();
    if (!appointment) return;
    const { timezone: tz } = await getAppointmentRules();
    const recipients = [
      { to: "patient", user: appointment.patientId },
      { to: "doctor", user: appointment.doctorId?.userId },
    ];
    for (const r of recipients) {
      if (skip.includes(r.to) || !r.user?.email) continue;
      const mail = buildAppointmentEmail({ event, to: r.to, appointment, tz, extra });
      if (!mail) continue;
      await enqueueEmail({
        eventKey: `appointment:${appointment._id}:${event}${version ? `:${version}` : ""}:email:${r.to}`,
        to: r.user.email, subject: mail.subject, html: mail.html, recipientId: r.user._id, entityId: appointment._id,
      });
    }
  } catch (error) {
    logger.warn("queueAppointmentEmails failed (business flow unaffected)", { message: error?.message, appointmentId, event });
  }
};

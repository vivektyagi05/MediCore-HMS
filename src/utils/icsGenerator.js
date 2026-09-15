// Generates a downloadable .ics calendar file for a booked appointment.
// Pure client-side — the appointment's date/time/doctor are already known
// to the browser once booking succeeds, so no backend endpoint is needed.

const pad = (n) => String(n).padStart(2, "0");

// Appointment.timeSlot is stored as "HH:MM-HH:MM" (structured slots) or a
// legacy free-form string. We only have enough information to build a
// precise calendar event for the structured "HH:MM-HH:MM" shape; for legacy
// slots we fall back to a 30-minute placeholder starting at the top of the
// mentioned hour, which is clearly labelled as an estimate in the summary.
const parseSlotToRange = (dateValue, timeSlot) => {
  const date = new Date(dateValue);
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(timeSlot || "").trim());

  const start = new Date(date);
  const end = new Date(date);

  if (match) {
    const [, sh, sm, eh, em] = match;
    start.setHours(Number(sh), Number(sm), 0, 0);
    end.setHours(Number(eh), Number(em), 0, 0);
  } else {
    // Legacy fallback: unparseable slot label — default to a 30-min estimate.
    start.setHours(9, 0, 0, 0);
    end.setHours(9, 30, 0, 0);
  }

  return { start, end };
};

const toICSDate = (date) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;

const escapeICSText = (text = "") =>
  String(text).replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\n/g, "\\n");

/**
 * Builds an .ics file's text content for one appointment.
 * @param {Object} params
 * @param {string|Date} params.date - appointment date
 * @param {string} params.timeSlot - "HH:MM-HH:MM" or legacy label
 * @param {string} params.doctorName
 * @param {string} [params.specialization]
 * @param {string} [params.hospitalName]
 * @param {string} [params.consultationMode]
 * @param {string} [params.reason]
 */
export function buildAppointmentICS({
  date,
  timeSlot,
  doctorName,
  specialization = "",
  hospitalName = "",
  consultationMode = "",
  reason = "",
}) {
  const { start, end } = parseSlotToRange(date, timeSlot);
  const now = new Date();

  const locationText = consultationMode === "online"
    ? "Online consultation"
    : consultationMode === "home_visit"
      ? "Home visit — doctor will visit your address"
      : hospitalName || "Clinic visit";
  const descriptionParts = [
    specialization && `Specialization: ${specialization}`,
    reason && `Visit reason: ${reason}`,
    "Please arrive 10 minutes early to complete check-in.",
  ].filter(Boolean);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MediCore HMS//Appointment//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@medicore`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICSText(`Appointment with Dr. ${doctorName}`)}`,
    `DESCRIPTION:${escapeICSText(descriptionParts.join("\\n"))}`,
    `LOCATION:${escapeICSText(locationText)}`,
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

/** Triggers a browser download of the .ics file for the given appointment. */
export function downloadAppointmentICS(appointment) {
  const icsContent = buildAppointmentICS(appointment);
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "appointment.ics";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

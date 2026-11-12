// Client mirror of the rules in backend/utils/slotEngine.js (validateAndDeriveAvailability) for instant, per-day feedback.
// The server re-validates every save; these messages are deliberately the same ones the server would send.
const toMinutes = (hhmm) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const whole = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** @returns {string[]} human-readable problems for one enabled day (empty = fine). */
export const validateDayConfig = (day) => {
  if (!day) return [];
  const errors = [];
  const start = toMinutes(day.startTime); const end = toMinutes(day.endTime);
  if (start === null || end === null) errors.push("Enter valid start and end times.");
  else if (end <= start) errors.push("End time must be after start time.");
  if (!whole(Number(day.slotDurationMinutes), 5, 240) || day.slotDurationMinutes === "") errors.push("Appointment duration must be a whole number of minutes from 5 to 240.");
  const buffer = day.bufferMinutes === "" || day.bufferMinutes == null ? 0 : Number(day.bufferMinutes);
  if (!whole(buffer, 0, 120)) errors.push("Buffer must be a whole number of minutes from 0 to 120.");
  const emergency = day.emergencySlotsPerDay === "" || day.emergencySlotsPerDay == null ? 0 : Number(day.emergencySlotsPerDay);
  if (!whole(emergency, 0, 20)) errors.push("Emergency slots must be a whole number from 0 to 20.");
  for (const brk of (day.breaks || []).filter((b) => b && (b.start || b.end))) {
    const bs = toMinutes(brk.start); const be = toMinutes(brk.end);
    if (bs === null || be === null) errors.push("Enter both a break start and a break end, or clear them.");
    else if (be <= bs) errors.push("Break end must be after break start.");
    else if (start !== null && end !== null && (bs < start || be > end)) errors.push("The break must fall within working hours.");
  }
  return errors;
};

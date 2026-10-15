// ─────────────────────────────────────────────────────────────────────────
// CANONICAL HOSPITAL TIME — the ONE place appointment time is resolved.
//
// Storage convention (unchanged, so no data migration is needed):
//   Appointment.date     = UTC-midnight Date whose Y-M-D digits are the
//                          hospital-LOCAL calendar day (a calendar-day key,
//                          NOT an instant).
//   Appointment.timeSlot = "HH:MM-HH:MM" (or "HH:MM") wall-clock time in the
//                          HOSPITAL timezone (HospitalSetting.timezone,
//                          default Asia/Kolkata).
//
// The real instant of an appointment is therefore
//   (calendar day from `date`) + (slot start wall time) interpreted in the
//   hospital timezone  →  a UTC instant.
//
// Previously every module compared slot digits against UTC clock digits
// (an IST 09:00 slot was treated as 09:00Z = 14:30 IST). That convention is
// retired; every caller must use this module.
//
// Pure + dependency-free (Intl only) so it is trivially unit-testable.
// DST-safe: offsets are derived per-instant from Intl, never hardcoded.
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_HOSPITAL_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_SLOT_MINUTES = 30;

const formatterCache = new Map();

export const isValidTimezone = (tz) => {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const resolveTimezone = (tz) => (isValidTimezone(tz) ? tz : DEFAULT_HOSPITAL_TIMEZONE);

const getFormatter = (tz) => {
  const zone = resolveTimezone(tz);
  let fmt = formatterCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(zone, fmt);
  }
  return fmt;
};

/** Wall-clock parts of `instant` as seen in `tz`. */
export const zonedParts = (instant, tz) => {
  const out = {};
  for (const p of getFormatter(tz).formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
};

/** Offset (minutes, east positive) of `tz` at `instant`. */
export const tzOffsetMinutes = (instant, tz) => {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(new Date(instant).getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
};

/** Wall time (y/m/d + minutes since local midnight) in `tz` → UTC instant. */
export const zonedWallTimeToInstant = ({ year, month, day, minutes }, tz) => {
  const guess = Date.UTC(year, month - 1, day, 0, minutes, 0, 0);
  const first = guess - tzOffsetMinutes(guess, tz) * 60000;
  const second = guess - tzOffsetMinutes(first, tz) * 60000;
  return new Date(second);
};

const pad = (n) => String(n).padStart(2, "0");

/** Hospital-local calendar day key ("YYYY-MM-DD") for an instant. */
export const hospitalDateKey = (now, tz) => {
  const p = zonedParts(now, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** UTC-midnight calendar-day key Date (the Appointment.date convention) for hospital-local "today". */
export const hospitalToday = (now, tz) => new Date(`${hospitalDateKey(now, tz)}T00:00:00.000Z`);

/** Minutes since hospital-local midnight (fractional seconds included) at `now`. */
export const hospitalMinutesOfDay = (now, tz) => {
  const p = zonedParts(now, tz);
  return p.hour * 60 + p.minute + p.second / 60;
};

/** Calendar-day key ("YYYY-MM-DD") of an Appointment.date value. */
export const calendarDateKey = (date) => new Date(date).toISOString().slice(0, 10);

const SLOT_TIME = /^(\d{1,2}):(\d{2})$/;
const parseClock = (text) => {
  const m = SLOT_TIME.exec(String(text ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

/** Start minutes of "HH:MM" / "HH:MM-HH:MM"; null for anything malformed. */
export const resolveSlotStartMinutes = (timeSlot) => {
  if (typeof timeSlot !== "string" || !timeSlot.trim()) return null;
  return parseClock(timeSlot.split("-")[0]);
};

/** End minutes of "HH:MM-HH:MM"; null when absent/malformed/non-positive. */
export const resolveSlotEndMinutes = (timeSlot) => {
  if (typeof timeSlot !== "string" || !timeSlot.includes("-")) return null;
  const start = resolveSlotStartMinutes(timeSlot);
  const end = parseClock(timeSlot.split("-")[1]);
  if (start === null || end === null || end <= start) return null;
  return end;
};

const calendarParts = (date) => {
  const key = calendarDateKey(date);
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

/**
 * THE canonical resolver: Appointment.date + timeSlot + hospital timezone →
 * real UTC start instant. Returns null for an unparseable timeSlot (legacy
 * free-typed slots) — callers must then fall back to date-only logic.
 */
export const resolveAppointmentInstant = (date, timeSlot, tz) => {
  const startMinutes = resolveSlotStartMinutes(timeSlot);
  if (startMinutes === null || date === undefined || date === null) return null;
  if (Number.isNaN(new Date(date).getTime())) return null;
  return zonedWallTimeToInstant({ ...calendarParts(date), minutes: startMinutes }, tz);
};

/** End instant; falls back to start + `fallbackMinutes` when the slot has no explicit end. */
export const resolveAppointmentEndInstant = (date, timeSlot, tz, fallbackMinutes = DEFAULT_SLOT_MINUTES) => {
  const start = resolveAppointmentInstant(date, timeSlot, tz);
  if (!start) return null;
  const startMin = resolveSlotStartMinutes(timeSlot);
  const endMin = resolveSlotEndMinutes(timeSlot);
  const durationMs = (endMin !== null ? endMin - startMin : fallbackMinutes) * 60000;
  return new Date(start.getTime() + durationMs);
};

/** Slot duration in minutes (explicit end, else fallback). */
export const resolveSlotDurationMinutes = (timeSlot, fallbackMinutes = DEFAULT_SLOT_MINUTES) => {
  const s = resolveSlotStartMinutes(timeSlot);
  const e = resolveSlotEndMinutes(timeSlot);
  return s !== null && e !== null ? e - s : fallbackMinutes;
};

export const APPOINTMENT_TIME_STATE = Object.freeze({
  UPCOMING: "UPCOMING",
  CURRENT: "CURRENT",
  RECENTLY_MISSED: "RECENTLY_MISSED",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNKNOWN", // timeSlot unparseable → only date-level truth is available
});

/**
 * Pure time-state classification of an appointment's SCHEDULED window
 * (independent of lifecycle status — the caller combines the two).
 *
 *   now < start                                   → UPCOMING
 *   start ≤ now ≤ end                             → CURRENT
 *   end < now ≤ end + resolutionWindowDays        → RECENTLY_MISSED
 *   now > end + resolutionWindowDays              → EXPIRED
 *
 * Boundaries: start is inclusive CURRENT; end is inclusive CURRENT;
 * the resolution deadline is inclusive RECENTLY_MISSED (expiry only after it).
 */
export const classifyAppointmentTime = ({ date, timeSlot, now = new Date(), tz, resolutionWindowDays = 3, fallbackMinutes = DEFAULT_SLOT_MINUTES }) => {
  const start = resolveAppointmentInstant(date, timeSlot, tz);
  const end = resolveAppointmentEndInstant(date, timeSlot, tz, fallbackMinutes);
  if (!start || !end) return { state: APPOINTMENT_TIME_STATE.UNKNOWN, start: null, end: null, resolutionDeadline: null };
  const resolutionDeadline = new Date(end.getTime() + resolutionWindowDays * 86400000);
  const t = new Date(now).getTime();
  let state;
  if (t < start.getTime()) state = APPOINTMENT_TIME_STATE.UPCOMING;
  else if (t <= end.getTime()) state = APPOINTMENT_TIME_STATE.CURRENT;
  else if (t <= resolutionDeadline.getTime()) state = APPOINTMENT_TIME_STATE.RECENTLY_MISSED;
  else state = APPOINTMENT_TIME_STATE.EXPIRED;
  return { state, start, end, resolutionDeadline };
};

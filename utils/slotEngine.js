// Pure, dependency-free slot-generation engine.
// Used by:
//   - doctor/workflowController.updateSchedule  (to derive `timeSlots` for legacy consumers)
//   - appointmentController.getAvailableSlots   (to answer "what can a patient pick, right now")
//   - appointmentController.createAppointment   (to validate a booking against the SAME logic)
// Single source of truth: any change to booking rules only needs to happen here.

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

const toHHMM = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const isWithinBreak = (slotStart, slotEnd, breaks = []) =>
  breaks.some((b) => {
    const bStart = toMinutes(b.start);
    const bEnd = toMinutes(b.end);
    return slotStart < bEnd && slotEnd > bStart;
  });

/**
 * Generates the theoretical slot list for a single day's config.
 * dayConfig legacy shape: { dayOfWeek, timeSlots: [String] }              -> returned as-is (backward compatible)
 * dayConfig structured shape: {
 *   dayOfWeek, startTime: "09:00", endTime: "17:00",
 *   slotDurationMinutes: 30, bufferMinutes: 5,
 *   breaks: [{ start: "13:00", end: "14:00" }],
 *   maxPatientsPerSlot: 1, emergencySlotsPerDay: 0
 * } -> auto-generated list of "HH:MM-HH:MM" slot strings
 */
export const generateDaySlots = (dayConfig) => {
  if (!dayConfig) return [];

  const hasStructuredConfig =
    dayConfig.startTime && dayConfig.endTime && dayConfig.slotDurationMinutes;

  if (!hasStructuredConfig) {
    // Legacy manually-typed slots — respected as-is for backward compatibility.
    return Array.isArray(dayConfig.timeSlots) ? dayConfig.timeSlots : [];
  }

  const duration = Number(dayConfig.slotDurationMinutes) || 30;
  const buffer = Number(dayConfig.bufferMinutes) || 0;
  const step = duration + buffer;
  const start = toMinutes(dayConfig.startTime);
  const end = toMinutes(dayConfig.endTime);
  const breaks = Array.isArray(dayConfig.breaks) ? dayConfig.breaks : [];

  if (!(step > 0) || end <= start) return [];

  const slots = [];
  for (let cursor = start; cursor + duration <= end; cursor += step) {
    const slotEnd = cursor + duration;
    if (isWithinBreak(cursor, slotEnd, breaks)) continue;
    slots.push(`${toHHMM(cursor)}-${toHHMM(slotEnd)}`);
  }
  return slots;
};

/**
 * Computes the slots a patient may actually book for a specific doctor + date:
 * theoretical day slots MINUS already-taken slots (respecting maxPatientsPerSlot),
 * with past-date and blocked/leave filtering handled by the caller (needs DB access).
 */
export const computeAvailableSlots = ({ dayConfig, takenSlotCounts = {}, maxPatientsPerSlotDefault = 1 }) => {
  const theoretical = generateDaySlots(dayConfig);
  const maxPerSlot = Number(dayConfig?.maxPatientsPerSlot) || maxPatientsPerSlotDefault;
  return theoretical.filter((slot) => (takenSlotCounts[slot] || 0) < maxPerSlot);
};

export const isEmergencyCapacityAvailable = (dayConfig, existingEmergencyCount = 0) => {
  const cap = Number(dayConfig?.emergencySlotsPerDay) || 0;
  return existingEmergencyCount < cap;
};

class SlotEngineError extends Error {
  constructor(message) {
    super(message);
    this.name = "SlotEngineError";
    this.statusCode = 400;
  }
}

/**
 * SINGLE SOURCE OF TRUTH for validating + deriving Doctor.availability.
 * Every write path (doctor self-service schedule editor, admin create/update
 * doctor) MUST call this instead of re-implementing the same checks, so the
 * business rules can never drift between the two entry points.
 *
 * Throws SlotEngineError (statusCode 400) on invalid input. Callers that want
 * an AppError should catch and rethrow with their own error class if needed —
 * kept dependency-free here so this module has no Express/AppError coupling.
 */
export const validateAndDeriveAvailability = (availabilityInput) => {
  if (!Array.isArray(availabilityInput)) return [];

  const derived = availabilityInput.map((day) => {
    const hasStructured = day.startTime && day.endTime && day.slotDurationMinutes;
    if (!hasStructured) {
      if (!Array.isArray(day.timeSlots) || day.timeSlots.length === 0) {
        throw new SlotEngineError(
          `${day.dayOfWeek}: provide either startTime/endTime/slotDurationMinutes or at least one manual time slot`,
        );
      }
      return day;
    }

    if (toMinutes(day.endTime) <= toMinutes(day.startTime)) {
      throw new SlotEngineError(`${day.dayOfWeek}: end time must be after start time`);
    }
    for (const brk of day.breaks || []) {
      if (toMinutes(brk.end) <= toMinutes(brk.start)) {
        throw new SlotEngineError(`${day.dayOfWeek}: break end time must be after break start time`);
      }
      if (toMinutes(brk.start) < toMinutes(day.startTime) || toMinutes(brk.end) > toMinutes(day.endTime)) {
        throw new SlotEngineError(`${day.dayOfWeek}: break must fall within working hours`);
      }
    }

    const generatedSlots = generateDaySlots(day);
    if (generatedSlots.length === 0) {
      throw new SlotEngineError(
        `${day.dayOfWeek}: working hours/duration/buffer produce zero bookable slots`,
      );
    }
    return { ...day, timeSlots: generatedSlots };
  });

  const duplicateCheck = new Set();
  for (const day of derived) {
    for (const slot of day.timeSlots || []) {
      const key = `${day.dayOfWeek}:${slot}`;
      if (duplicateCheck.has(key)) {
        throw new SlotEngineError("Overlapping or duplicate slots are not allowed");
      }
      duplicateCheck.add(key);
    }
  }

  return derived;
};

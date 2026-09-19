// Phase DOC-07 — Schedule & Capacity Intelligence.
//
// Pure, dependency-free capacity engine. Reuses slotEngine.generateDaySlots
// (the existing single source of truth for "what slots exist on this day")
// and only adds the layer DOC-07 actually needs on top of it: annotating
// each theoretical slot with what's REALLY happening in it (booked / break /
// blocked / available), a capacity summary derived from that, and conflict
// detection. No new slot-generation logic is introduced here — that would
// duplicate slotEngine.js, which DOC-07 explicitly forbids.
//
// Kept DB-free/pure so it's unit-testable without MongoDB, matching the
// project's established pattern (doctorInboxAggregates.js, slotEngine.js).

import { generateDaySlots } from "./slotEngine.js";
import { APPOINTMENT_STATUS, ACTIVE_STATUSES } from "../constants/appointmentStatus.js";

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

const slotBounds = (slot) => {
  const [start, end] = slot.split("-");
  return { start, end, startMinutes: toMinutes(start), endMinutes: end ? toMinutes(end) : null };
};

/**
 * Builds the full picture of one doctor's one calendar day: every
 * theoretical slot annotated with what's real in it, plus a capacity
 * summary. This is the ONE place "booked vs available vs break vs blocked"
 * is decided — the Doctor Today view, the Conflict Center, and the
 * next-available search all read from this same function.
 *
 * @param {object} params
 * @param {object|null} params.dayConfig - doctor.availability entry for this dayOfWeek (or null/undefined if not a working day)
 * @param {Array} params.appointments - ALL appointments for this doctor on this exact date (any status) — each needs { timeSlot, status, patientName, appointmentId, consultationMode }
 * @param {string|null} params.blockedReason - reason string if this date is on doctor.blockedDates, else null
 * @param {string|null} params.leaveReason - reason string if this date falls in approved leave, else null
 * @param {boolean} params.isPastDate
 * @returns {object} day capacity breakdown
 */
export const buildDayCapacity = ({
  dayConfig = null,
  appointments = [],
  blockedReason = null,
  leaveReason = null,
  isPastDate = false,
  currentTimeMinutes = null,
}) => {
  const isWorkingDay = Boolean(dayConfig);
  const unavailableReason = !isWorkingDay
    ? "not_a_working_day"
    : blockedReason
      ? "blocked_date"
      : leaveReason
        ? "on_leave"
        : null;

  const theoreticalSlots = isWorkingDay ? generateDaySlots(dayConfig) : [];
  const breaks = Array.isArray(dayConfig?.breaks) ? dayConfig.breaks : [];

  // Group real appointments by slot — a slot could (incorrectly, in legacy
  // data) hold more than one active appointment, which is exactly the
  // "double booked" conflict this phase must surface rather than hide.
  const byTimeSlot = new Map();
  for (const appt of appointments) {
    const list = byTimeSlot.get(appt.timeSlot) || [];
    list.push(appt);
    byTimeSlot.set(appt.timeSlot, list);
  }

  const theoreticalSet = new Set(theoreticalSlots);

  const timeline = theoreticalSlots.map((slot) => {
    const { startMinutes, endMinutes } = slotBounds(slot);
    const inBreak = breaks.some((b) => {
      const bs = toMinutes(b.start);
      const be = toMinutes(b.end);
      return endMinutes !== null && startMinutes < be && endMinutes > bs;
    });

    const occupants = (byTimeSlot.get(slot) || []).filter((a) => ACTIVE_STATUSES.includes(a.status));
    const isDoubleBooked = occupants.length > 1;
    const primary = occupants[0] || null;

    const isPastTimeToday = Number.isFinite(currentTimeMinutes) && startMinutes < currentTimeMinutes;

    let status;
    if (unavailableReason) status = unavailableReason === "blocked_date" ? "blocked" : unavailableReason === "on_leave" ? "leave" : "unavailable";
    else if ((isPastDate || isPastTimeToday) && !primary) status = "past";
    else if (primary) status = "booked";
    else if (inBreak) status = "break";
    else status = "available";

    return {
      slot,
      startTime: slotBounds(slot).start,
      endTime: slotBounds(slot).end,
      status,
      isConflict: isDoubleBooked,
      appointment: primary
        ? {
            appointmentId: primary.appointmentId,
            patientName: primary.patientName || "Patient",
            status: primary.status,
            consultationMode: primary.consultationMode || "",
          }
        : null,
      overflowCount: isDoubleBooked ? occupants.length - 1 : 0,
    };
  });

  // Real appointments that landed OUTSIDE today's currently-configured slots
  // (e.g. the doctor shrank working hours, moved a break, or lowered the
  // slot duration AFTER this appointment was already booked). This is a
  // genuine data-integrity conflict, not a fabricated one — the appointment
  // itself is real, it just no longer matches the live schedule config.
  const outsideCurrentHours = appointments.filter(
    (a) => ACTIVE_STATUSES.includes(a.status) && !theoreticalSet.has(a.timeSlot),
  );

  const doubleBookedSlots = timeline.filter((t) => t.isConflict).map((t) => t.slot);

  const bookedCount = timeline.filter((t) => t.status === "booked").length;
  const availableCount = timeline.filter((t) => t.status === "available").length;
  const breakCount = timeline.filter((t) => t.status === "break").length;
  const totalSlots = theoreticalSlots.length;
  const utilizationPercent = totalSlots > 0 ? Math.round((bookedCount / totalSlots) * 100) : null;

  const completedCount = appointments.filter((a) =>
    [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE].includes(a.status),
  ).length;
  const cancelledCount = appointments.filter((a) => a.status === APPOINTMENT_STATUS.CANCELLED).length;

  return {
    isWorkingDay,
    unavailableReason,
    startTime: dayConfig?.startTime || null,
    endTime: dayConfig?.endTime || null,
    slotDurationMinutes: dayConfig?.slotDurationMinutes || null,
    breaks,
    timeline,
    capacity: {
      totalSlots,
      booked: bookedCount,
      available: availableCount,
      break: breakCount,
      completed: completedCount,
      cancelled: cancelledCount,
      utilizationPercent,
    },
    conflicts: {
      doubleBookedSlots,
      outsideCurrentHours: outsideCurrentHours.map((a) => ({
        appointmentId: a.appointmentId,
        timeSlot: a.timeSlot,
        patientName: a.patientName || "Patient",
        status: a.status,
      })),
    },
    nextFreeSlotToday: timeline.find((t) => t.status === "available")?.slot || null,
  };
};

/** True if a fully-computed day (from buildDayCapacity) has ANY bookable slot left. */
export const dayHasAvailability = (dayCapacity) => (dayCapacity?.capacity?.available || 0) > 0;

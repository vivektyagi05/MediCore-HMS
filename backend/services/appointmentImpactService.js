// ─────────────────────────────────────────────────────────────────────────
// LEAVE / SCHEDULE IMPACT.
//
// When a doctor's calendar changes AFTER patients booked, existing
// appointments can become invalid. This service FINDS them, FLAGS them
// (Appointment.impact), and NOTIFIES doctor + patients. It never cancels or
// moves anything: resolution goes through the existing reschedule / cancel
// flows (which re-run availability, capacity, policy, refund and audit).
// ─────────────────────────────────────────────────────────────────────────
import Appointment from "../models/Appointment.js";
import { APPOINTMENT_STATUS as S } from "../constants/appointmentStatus.js";
import { generateDaySlots } from "../utils/slotEngine.js";
import { getAppointmentRules } from "./hospitalSettingsService.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { hospitalToday, resolveAppointmentEndInstant } from "../utils/hospitalTime.js";
import { logger } from "../utils/logger.js";

const IMPACTABLE = [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const POP = [
  { path: "patientId", select: "name" },
  { path: "doctorId", select: "userId", populate: { path: "userId", select: "name" } },
];
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** PURE: is this appointment still valid against the doctor's (new) availability + blocked dates? */
export const appointmentFitsSchedule = ({ appointment, availability = [], blockedDates = [] }) => {
  const key = dayKey(appointment.date);
  if (blockedDates.some((b) => dayKey(b.date) === key)) return { fits: false, reason: "The doctor blocked this date." };
  const dow = DAYS[new Date(appointment.date).getUTCDay()];
  const dayConfig = availability.find((a) => a.dayOfWeek === dow);
  if (!dayConfig) return { fits: false, reason: "The doctor no longer works on this day." };
  const slots = generateDaySlots(dayConfig);
  if (!slots.includes(appointment.timeSlot)) return { fits: false, reason: "This time is outside the doctor's updated working hours." };
  return { fits: true, reason: null };
};

const notifyImpact = async ({ appointment, kind, referenceId }) => {
  const doctorUserId = appointment.doctorId?.userId?._id;
  const when = `${new Date(appointment.date).toDateString()} at ${appointment.timeSlot}`;
  const title = "Your appointment needs attention";
  try {
    await notificationEmitter.emitToUser(appointment.patientId._id, {
      type: "appointment", title,
      message: `Your appointment on ${when} is affected by a change to the doctor's ${kind === "leave" ? "availability" : "schedule"}. Please reschedule or cancel it from My Appointments.`,
      entityType: "appointment", entityId: appointment._id, severity: "warning",
      eventKey: `appointment:${appointment._id}:impact:${kind}:${referenceId}:patient`,
    });
  } catch (error) { logger.warn("impact patient notification failed", { message: error?.message, appointmentId: appointment._id }); }
  return doctorUserId;
};

/**
 * Flags + notifies. Idempotent: an appointment already flagged for the same
 * (kind, referenceId) is skipped, so replays/retries never re-notify.
 * @returns {{affected: Array, flaggedCount: number}}
 */
export const flagLeaveImpact = async ({ doctorId, leave, now = new Date() }) => {
  const rules = await getAppointmentRules();
  const from = new Date(Math.max(new Date(leave.startDate).getTime(), hospitalToday(now, rules.timezone).getTime()));
  const candidates = await Appointment.find({ doctorId, date: { $gte: from, $lte: leave.endDate }, status: { $in: IMPACTABLE } })
    .populate(POP).sort({ date: 1 }).limit(500);
  const referenceId = String(leave._id);
  const affected = [];
  let doctorUserId = null;
  for (const a of candidates) {
    const end = resolveAppointmentEndInstant(a.date, a.timeSlot, rules.timezone, rules.defaultSlotMinutes);
    if (end && end <= now) continue; // already over → the lifecycle sweep owns it
    const flagged = await Appointment.findOneAndUpdate(
      { _id: a._id, status: { $in: IMPACTABLE }, $or: [{ "impact.referenceId": { $ne: referenceId } }, { "impact.referenceId": { $exists: false } }] },
      { $set: { impact: { type: "leave", referenceId, reason: leave.reason || "Doctor leave approved", flaggedAt: now } } },
      { returnDocument: "after" },
    );
    affected.push({ appointmentId: a._id, date: a.date, timeSlot: a.timeSlot, status: a.status, patientName: a.patientId?.name || "Patient" });
    if (flagged) doctorUserId = (await notifyImpact({ appointment: a, kind: "leave", referenceId, reason: leave.reason })) || doctorUserId;
  }
  if (affected.length && (doctorUserId || candidates[0]?.doctorId?.userId?._id)) {
    try {
      await notificationEmitter.emitToUser(doctorUserId || candidates[0].doctorId.userId._id, {
        type: "appointment", title: "Leave affects booked appointments",
        message: `${affected.length} booked appointment(s) fall within your approved leave. Reschedule or cancel them from Today's Clinic.`,
        entityType: "leave", entityId: leave._id, severity: "warning",
        eventKey: `leave:${leave._id}:impact:doctor`,
      });
    } catch (error) { logger.warn("leave impact doctor notification failed", { message: error?.message }); }
  }
  return { affected, flaggedCount: affected.length };
};

/** Preview + flag after a schedule change. Also CLEARS stale schedule flags that no longer apply. */
export const flagScheduleImpact = async ({ doctor, now = new Date(), notify = true }) => {
  const rules = await getAppointmentRules();
  const today = hospitalToday(now, rules.timezone);
  const referenceId = `schedule:${new Date(now).toISOString()}`;
  const future = await Appointment.find({ doctorId: doctor._id, date: { $gte: today }, status: { $in: IMPACTABLE } })
    .populate(POP).sort({ date: 1 }).limit(1000);
  const affected = []; const recovered = [];
  for (const a of future) {
    const { fits, reason } = appointmentFitsSchedule({ appointment: a, availability: doctor.availability, blockedDates: doctor.blockedDates });
    if (fits) { if (a.impact?.type === "schedule") recovered.push(a._id); continue; }
    if (a.impact?.type === "leave") continue; // leave flag takes precedence
    affected.push({ appointmentId: a._id, date: a.date, timeSlot: a.timeSlot, status: a.status, patientName: a.patientId?.name || "Patient", reason });
    if (a.impact?.type === "schedule" && a.impact.reason === reason) continue; // already flagged for the same cause → no re-notify
    const flagged = await Appointment.findOneAndUpdate(
      { _id: a._id, status: { $in: IMPACTABLE } },
      { $set: { impact: { type: "schedule", referenceId, reason, flaggedAt: now } } },
      { returnDocument: "after" },
    );
    if (flagged && notify) await notifyImpact({ appointment: a, kind: "schedule", referenceId });
  }
  if (recovered.length) await Appointment.updateMany({ _id: { $in: recovered }, "impact.type": "schedule" }, { $unset: { impact: "" } });
  return { affected, recoveredCount: recovered.length };
};

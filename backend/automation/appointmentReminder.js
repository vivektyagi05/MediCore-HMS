import Appointment from "../models/Appointment.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { getAppointmentRules } from "../services/hospitalSettingsService.js";
import { resolveAppointmentInstant, hospitalToday } from "../utils/hospitalTime.js";
import { APPOINTMENT_STATUS as S } from "../constants/appointmentStatus.js";

// Statuses that are real, still-upcoming commitments. Cancelled/completed/
// started/unknown appointments are NEVER reminded.
export const REMINDABLE_STATUSES = [S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED];

/**
 * PURE. Which reminder (if any) is due for this appointment right now?
 *
 * Based on the canonical appointment INSTANT (date + timeSlot in the hospital
 * timezone), never on `date` alone. An interval I is "due" once
 * now >= instant - I and the appointment has not started. If several are due
 * at once (e.g. the scheduler was down) ONLY the smallest — the most
 * relevant — is sent, so a patient never gets a burst of stale reminders.
 *
 * The eventKey embeds the instant, so rescheduling yields a brand-new key
 * (fresh reminders for the new time) while old-time reminders can never fire
 * again: obsolescence needs no cleanup job.
 */
export const computeDueReminder = ({ appointment, now, rules }) => {
  if (!REMINDABLE_STATUSES.includes(appointment.status)) return null;
  const instant = resolveAppointmentInstant(appointment.date, appointment.timeSlot, rules.timezone);
  if (!instant) return null;
  const nowMs = new Date(now).getTime();
  if (nowMs >= instant.getTime()) return null; // already started — a reminder is meaningless
  const due = rules.reminderIntervalsMinutes.filter((i) => nowMs >= instant.getTime() - i * 60000);
  if (!due.length) return null;
  const interval = Math.min(...due);
  return {
    interval,
    instant,
    eventKey: `reminder:appointment:${appointment._id}:${instant.toISOString()}:${interval}m`,
  };
};

const humanLead = (minutes) => (minutes >= 1440 ? "tomorrow" : minutes >= 60 ? `in about ${Math.round(minutes / 60)} hours` : `in about ${minutes} minutes`);

export const appointmentReminder = {
  async run({ now = new Date(), batchSize = 500 } = {}) {
    const rules = await getAppointmentRules();
    const maxLeadDays = Math.ceil(Math.max(...rules.reminderIntervalsMinutes) / 1440) + 1;
    const from = hospitalToday(now, rules.timezone);
    const to = new Date(from.getTime() + maxLeadDays * 86400000);

    // Bounded by indexed (status,date) range — never a collection scan.
    const appointments = await Appointment.find({ date: { $gte: from, $lte: to }, status: { $in: REMINDABLE_STATUSES } })
      .select("patientId doctorId date timeSlot status consultationMode")
      .populate("patientId", "name email")
      .populate({ path: "doctorId", select: "userId", populate: { path: "userId", select: "name" } })
      .limit(batchSize)
      .lean();

    const results = [];
    for (const appointment of appointments) {
      const due = computeDueReminder({ appointment, now, rules });
      if (!due || !appointment.patientId?._id) continue;
      // Idempotent under concurrency: the unique eventKey index makes a second
      // creator fail with 11000 instead of sending a duplicate.
      let reminder;
      try {
        reminder = await ReminderLog.create({
          userId: appointment.patientId._id,
          entityType: "appointment",
          entityId: appointment._id,
          reminderType: "appointment_upcoming",
          scheduledFor: due.instant,
          status: "sent",
          sentAt: new Date(),
          eventKey: due.eventKey,
          metadata: { timeSlot: appointment.timeSlot, intervalMinutes: due.interval },
        });
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
      // Minimum necessary data — no clinical details in the reminder.
      await notificationEmitter.emitToUser(appointment.patientId._id, {
        type: "appointment",
        title: "Appointment reminder",
        message: `Your appointment with Dr. ${appointment.doctorId?.userId?.name || "your doctor"} is ${humanLead(due.interval)} (${appointment.timeSlot}${appointment.consultationMode ? `, ${String(appointment.consultationMode).replace("_", " ")}` : ""}).`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey: due.eventKey,
        severity: "info",
      });
      results.push(reminder);
    }
    return results;
  },
};

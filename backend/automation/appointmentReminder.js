import Appointment from "../models/Appointment.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

export const appointmentReminder = {
  async run({ now = new Date() } = {}) {
    const windowEnd = new Date(now);
    windowEnd.setUTCHours(windowEnd.getUTCHours() + 24);

    const appointments = await Appointment.find({
      date: { $gte: now, $lte: windowEnd },
      status: "approved",
    })
      .populate("patientId", "name email")
      .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
      .lean();

    const results = [];
    for (const appointment of appointments) {
      const eventKey = `reminder:appointment:${appointment._id}:${appointment.date.toISOString().slice(0, 10)}`;
      const existing = await ReminderLog.findOne({ eventKey }).lean();
      if (existing) continue;

      const reminder = await ReminderLog.create({
        userId: appointment.patientId._id,
        entityType: "appointment",
        entityId: appointment._id,
        reminderType: "appointment_upcoming",
        scheduledFor: appointment.date,
        status: "sent",
        sentAt: new Date(),
        eventKey,
        metadata: { timeSlot: appointment.timeSlot },
      });

      await notificationEmitter.emitToUser(appointment.patientId._id, {
        type: "appointment",
        title: "Appointment reminder",
        message: `Reminder: appointment with Dr. ${appointment.doctorId?.userId?.name || "Doctor"} at ${appointment.timeSlot}`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey,
        severity: "info",
      });
      results.push(reminder);
    }

    return results;
  },
};

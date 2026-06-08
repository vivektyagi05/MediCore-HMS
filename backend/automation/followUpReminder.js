import Prescription from "../models/Prescription.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

export const followUpReminder = {
  async run({ now = new Date() } = {}) {
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 3);

    const prescriptions = await Prescription.find({
      followUpDate: { $gte: now, $lte: windowEnd },
      status: "active",
    })
      .populate("patientId", "name email")
      .lean();

    const results = [];
    for (const prescription of prescriptions) {
      const eventKey = `reminder:follow-up:${prescription._id}`;
      const existing = await ReminderLog.findOne({ eventKey }).lean();
      if (existing) continue;

      const reminder = await ReminderLog.create({
        userId: prescription.patientId._id,
        entityType: "prescription",
        entityId: prescription._id,
        reminderType: "prescription_follow_up",
        scheduledFor: prescription.followUpDate,
        status: "sent",
        sentAt: new Date(),
        eventKey,
      });

      await notificationEmitter.emitToUser(prescription.patientId._id, {
        type: "prescription",
        title: "Follow-up reminder",
        message: "Your prescription follow-up date is approaching.",
        entityType: "prescription",
        entityId: prescription._id,
        eventKey,
        severity: "info",
      });
      results.push(reminder);
    }

    return results;
  },
};

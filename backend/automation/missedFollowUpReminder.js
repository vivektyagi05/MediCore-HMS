import Prescription from "../models/Prescription.js";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

// Phase D5, Step 4/5 — "Patient missed follow-up -> Reminder", the overdue
// counterpart to the existing followUpReminder.js (which reminds ahead of
// the date). Fires once, 1-7 days after followUpDate has passed, only if no
// new appointment with the same doctor was booked after that date.
export const missedFollowUpReminder = {
  async run({ now = new Date() } = {}) {
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - 7);
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() - 1);

    const prescriptions = await Prescription.find({
      status: "active",
      followUpDate: { $gte: windowStart, $lte: windowEnd },
    })
      .populate("patientId", "name")
      .select("doctorId patientId followUpDate diagnosis")
      .lean();

    const results = [];
    for (const prescription of prescriptions) {
      const eventKey = `reminder:missed-follow-up:${prescription._id}`;
      const existing = await ReminderLog.findOne({ eventKey }).lean();
      if (existing) continue;

      const rebooked = await Appointment.exists({
        doctorId: prescription.doctorId,
        patientId: prescription.patientId._id,
        date: { $gt: prescription.followUpDate },
        // A cancelled booking is not a follow-up that
        // actually happened; only a live booking counts as "rebooked".
        status: { $ne: "cancelled" },
      });
      if (rebooked) continue;

      const doctor = await Doctor.findById(prescription.doctorId).select("userId").lean();
      if (!doctor?.userId) continue;

      const reminder = await ReminderLog.create({
        userId: prescription.patientId._id,
        entityType: "follow_up",
        entityId: prescription._id,
        reminderType: "missed_follow_up",
        scheduledFor: prescription.followUpDate,
        status: "sent",
        sentAt: new Date(),
        eventKey,
      });

      await notificationEmitter.emitToUser(prescription.patientId._id, {
        type: "prescription",
        title: "Missed follow-up",
        message: "Your scheduled follow-up date has passed. Please book a visit if you still need one.",
        entityType: "prescription",
        entityId: prescription._id,
        severity: "warning",
        eventKey,
      });

      await notificationEmitter.emitToUser(doctor.userId, {
        type: "prescription",
        title: "Patient missed follow-up",
        message: `${prescription.patientId.name || "A patient"} did not rebook their follow-up for "${prescription.diagnosis || "a prior visit"}".`,
        entityType: "prescription",
        entityId: prescription._id,
        severity: "warning",
        eventKey: `${eventKey}:doctor`,
      });

      results.push(reminder);
    }

    return results;
  },
};

import Insurance from "../models/Insurance.js";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

// Phase D5, Step 4 — "Insurance expires -> Notify patient + doctor". Reuses
// the exact same ReminderLog/eventKey dedup pattern as followUpReminder.js
// and appointmentReminder.js so it plugs straight into the existing
// automationCronJobs.runAll without any new scheduling infrastructure.
export const insuranceExpiryReminder = {
  async run({ now = new Date() } = {}) {
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 30);

    const policies = await Insurance.find({
      validTill: { $gte: now, $lte: windowEnd },
    })
      .select("userId provider validTill")
      .lean();

    const results = [];
    for (const policy of policies) {
      const eventKey = `reminder:insurance-expiry:${policy._id}`;
      const existing = await ReminderLog.findOne({ eventKey }).lean();
      if (existing) continue;

      // Real doctors this patient has actually seen, not a fabricated list —
      // any doctor the patient has an appointment history with in the last
      // 6 months, so the notification only reaches someone with a genuine
      // treating relationship to the patient.
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
      const recentDoctorIds = await Appointment.distinct("doctorId", {
        patientId: policy.userId,
        date: { $gte: sixMonthsAgo },
      });
      const treatingDoctors = recentDoctorIds.length
        ? await Doctor.find({ _id: { $in: recentDoctorIds } }).select("userId").lean()
        : [];

      const reminder = await ReminderLog.create({
        userId: policy.userId,
        entityType: "insurance",
        entityId: policy._id,
        reminderType: "insurance_expiry",
        scheduledFor: policy.validTill,
        status: "sent",
        sentAt: new Date(),
        eventKey,
      });

      const daysLeft = Math.max(0, Math.round((new Date(policy.validTill) - now) / (1000 * 60 * 60 * 24)));
      await notificationEmitter.emitToUser(policy.userId, {
        type: "insurance",
        title: "Insurance policy expiring soon",
        message: `Your ${policy.provider} policy expires in ${daysLeft} day(s). Renew it to avoid a coverage gap.`,
        entityType: "insurance",
        entityId: policy._id,
        severity: daysLeft <= 7 ? "warning" : "info",
        eventKey,
      });

      await notificationEmitter.emitToUsers(
        treatingDoctors.map((doctor) => doctor.userId),
        {
          type: "insurance",
          title: "Patient insurance expiring soon",
          message: `A patient's ${policy.provider} policy expires in ${daysLeft} day(s).`,
          entityType: "insurance",
          entityId: policy._id,
          severity: "info",
          eventKey: `${eventKey}:doctor`,
        },
      );

      results.push(reminder);
    }

    return results;
  },
};

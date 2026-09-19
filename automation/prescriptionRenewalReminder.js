import Prescription from "../models/Prescription.js";
import Doctor from "../models/Doctor.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

// Duration text is free-form on the medicine record (e.g. "7 days", "2
// weeks") — this only ever reads that same text back for a coarse
// day-count, it is not a dosage calculator. Unparseable text is skipped
// rather than guessed.
const DURATION_TEXT = /(\d+)\s*(day|days|week|weeks|month|months|hour|hours)/i;
const UNIT_TO_DAYS = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, hour: 0, hours: 0 };

function longestCourseDays(medicines) {
  let maxDays = 0;
  for (const medicine of medicines || []) {
    const match = DURATION_TEXT.exec(medicine.duration || "");
    if (!match) continue;
    const days = Number(match[1]) * (UNIT_TO_DAYS[match[2].toLowerCase()] ?? 0);
    if (days > maxDays) maxDays = days;
  }
  return maxDays;
}

// Phase D5, Step 4 — "Prescription expires -> Notify doctor". Fires once,
// 0-3 days after the longest medicine course on the prescription has run
// its course, and only if this doctor hasn't already issued the patient a
// newer prescription since (i.e. renewal already happened).
export const prescriptionRenewalReminder = {
  async run({ now = new Date() } = {}) {
    const lookbackStart = new Date(now);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 45);

    const prescriptions = await Prescription.find({
      status: "active",
      createdAt: { $gte: lookbackStart },
    })
      .select("doctorId patientId medicines createdAt diagnosis")
      .lean();

    const results = [];
    for (const prescription of prescriptions) {
      const courseDays = longestCourseDays(prescription.medicines);
      if (!courseDays) continue;

      const expiresAt = new Date(prescription.createdAt);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + courseDays);
      const daysSinceExpiry = Math.floor((now - expiresAt) / (1000 * 60 * 60 * 24));
      if (daysSinceExpiry < 0 || daysSinceExpiry > 3) continue;

      const eventKey = `reminder:prescription-renewal:${prescription._id}`;
      const existing = await ReminderLog.findOne({ eventKey }).lean();
      if (existing) continue;

      const renewed = await Prescription.exists({
        doctorId: prescription.doctorId,
        patientId: prescription.patientId,
        status: "active",
        createdAt: { $gt: prescription.createdAt },
      });
      if (renewed) continue;

      const doctor = await Doctor.findById(prescription.doctorId).select("userId").lean();
      if (!doctor?.userId) continue;

      const reminder = await ReminderLog.create({
        userId: doctor.userId,
        entityType: "prescription",
        entityId: prescription._id,
        reminderType: "prescription_renewal",
        scheduledFor: expiresAt,
        status: "sent",
        sentAt: new Date(),
        eventKey,
      });

      await notificationEmitter.emitToUser(doctor.userId, {
        type: "prescription",
        title: "Prescription course completed — renewal check",
        message: `The course for "${prescription.diagnosis || "a prescription"}" has run out. Consider whether the patient needs a renewal.`,
        entityType: "prescription",
        entityId: prescription._id,
        severity: "info",
        eventKey,
      });

      results.push(reminder);
    }

    return results;
  },
};

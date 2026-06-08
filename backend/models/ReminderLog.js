import mongoose from "mongoose";

const reminderLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    entityType: {
      type: String,
      enum: ["appointment", "payment", "prescription", "subscription", "follow_up"],
      required: true,
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    channel: { type: String, enum: ["in_app", "email", "sms_ready"], default: "in_app", index: true },
    reminderType: {
      type: String,
      enum: ["appointment_upcoming", "payment_due", "prescription_follow_up", "subscription_renewal", "inactive_patient"],
      required: true,
      index: true,
    },
    status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending", index: true },
    scheduledFor: { type: Date, required: true, index: true },
    sentAt: Date,
    failureReason: String,
    eventKey: { type: String, unique: true, sparse: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

reminderLogSchema.index({ userId: 1, reminderType: 1, scheduledFor: -1 });

const ReminderLog = mongoose.model("ReminderLog", reminderLogSchema);

export default ReminderLog;

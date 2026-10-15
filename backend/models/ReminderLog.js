import mongoose from "mongoose";

const reminderLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    entityType: {
      type: String,
      enum: ["appointment", "payment", "prescription", "subscription", "follow_up", "insurance"],
      required: true,
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    channel: { type: String, enum: ["in_app", "email", "sms_ready"], default: "in_app", index: true },
    reminderType: {
      type: String,
      enum: [
        "appointment_upcoming",
        "payment_due",
        "prescription_follow_up",
        "subscription_renewal",
        "inactive_patient",
        // Phase D5 additions — additive only, existing values/behaviour unchanged
        "insurance_expiry",
        "prescription_renewal",
        "missed_follow_up",
      ],
      required: true,
      index: true,
    },
    status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending", index: true },
    scheduledFor: { type: Date, required: true, index: true },
    sentAt: Date,
    failureReason: String,
    eventKey: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

reminderLogSchema.index({ userId: 1, reminderType: 1, scheduledFor: -1 });
// N-024: was { unique: true, sparse: true }. sparse indexes still index explicit
// nulls, so a null/duplicate-null row breaks the build or collides later. The
// partial $type:"string" form indexes only real keys. Explicit name so it can
// be created additively beside a legacy sparse index (see migration 011).
reminderLogSchema.index(
  { eventKey: 1 },
  { unique: true, name: "uniq_reminderlog_event_key", partialFilterExpression: { eventKey: { $type: "string" } } },
);

const ReminderLog = mongoose.model("ReminderLog", reminderLogSchema);

export default ReminderLog;

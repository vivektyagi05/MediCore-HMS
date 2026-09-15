import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, index: true },
    provider: { type: String, default: "razorpay", index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    signature: { type: String, required: true },
    status: { type: String, enum: ["received", "processed", "failed", "duplicate"], default: "received", index: true },
    processedAt: Date,
    failureReason: String,
  },
  { timestamps: true },
);

const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);

export default WebhookEvent;

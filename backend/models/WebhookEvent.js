import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, index: true },
    provider: { type: String, default: "razorpay", index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    signature: { type: String, required: true },
    status: { type: String, enum: ["received", "processing", "processed", "failed", "duplicate"], default: "received", index: true },
    processedAt: Date,
    failureReason: String,
    // Phase 01 event lifecycle: lease + bounded retry so an event can never stay
    // stuck in received/processing after a crash, and a stale worker is fenced.
    attempts: { type: Number, default: 0 },
    leaseOwner: String,
    leaseExpiresAt: Date,
    nextAttemptAt: Date,
    retryable: { type: Boolean, default: true },
    outcome: String,
    failureCode: String,
  },
  { timestamps: true },
);

webhookEventSchema.index({ status: 1, nextAttemptAt: 1 });
webhookEventSchema.index({ status: 1, leaseExpiresAt: 1 });

const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);

export default WebhookEvent;

import mongoose from "mongoose";

// Durable transactional-email record. A socket emit or an API call attempt is
// NOT delivery: only status "sent" (provider accepted + returned a messageId)
// means the provider took it. Failures keep a coarse category only — provider
// bodies/keys are never stored or shown to users.
const emailDeliverySchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, trim: true, maxlength: 250 },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    to: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    subject: { type: String, required: true, maxlength: 250 },
    html: { type: String, required: true, maxlength: 20000 },
    entityType: { type: String, default: "appointment" },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    status: { type: String, enum: ["queued", "sending", "sent", "retrying", "failed"], default: "queued", index: true },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastErrorCategory: { type: String, maxlength: 60 },
    providerMessageId: { type: String, maxlength: 200 },
    sentAt: Date,
    claimedAt: Date,
  },
  { timestamps: true },
);

// Idempotency: one email per (event, recipient address), ever.
emailDeliverySchema.index({ eventKey: 1, to: 1 }, { unique: true });
emailDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

export default mongoose.model("EmailDelivery", emailDeliverySchema);

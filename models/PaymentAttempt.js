import mongoose from "mongoose";

const paymentAttemptSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
  attemptNumber: { type: Number, required: true, min: 1 },
  gateway: { type: String, required: true },
  gatewayOrderId: { type: String, required: true, index: true },
  gatewayPaymentId: { type: String, index: true, sparse: true },
  status: { type: String, enum: ["created", "checkout_started", "authorized", "captured", "failed", "cancelled", "expired", "verification_pending"], default: "created", index: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  failureReason: { type: String, maxlength: 500 },
  startedAt: Date,
  completedAt: Date,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

paymentAttemptSchema.index({ paymentId: 1, attemptNumber: 1 }, { unique: true });
paymentAttemptSchema.index({ gateway: 1, gatewayOrderId: 1 }, { unique: true });

export default mongoose.model("PaymentAttempt", paymentAttemptSchema);

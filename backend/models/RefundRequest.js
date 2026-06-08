import mongoose from "mongoose";

const refundRequestSchema = new mongoose.Schema(
  {
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["pending", "approved", "rejected", "processed", "failed"], default: "pending", index: true },
    razorpayRefundId: String,
    timeline: [{ status: String, note: String, at: { type: Date, default: Date.now }, actorId: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: true },
);

refundRequestSchema.index({ paymentId: 1, status: 1 });

const RefundRequest = mongoose.model("RefundRequest", refundRequestSchema);

export default RefundRequest;

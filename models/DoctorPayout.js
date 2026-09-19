import mongoose from "mongoose";

const doctorPayoutSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      unique: true, // prevent double payout per payment
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    grossAmount: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },
    doctorAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "paid", "cancelled"],
      default: "pending",
      index: true,
    },
    paidAt: Date,
    cancelReason: { type: String },
    settledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // P23 — refund/payout interaction (Section 14). A refund against a
    // payment whose payout was already "paid" (settled) cannot be undone by
    // silently flipping status; the difference must stay visible. These
    // fields record that a refund happened against this payout without
    // ever mutating grossAmount/doctorAmount/platformFee (preserved
    // financial history). No automated recovery-from-future-payouts engine
    // exists in this codebase — adjusted_pending is a deliberately visible,
    // honestly-disclosed manual-follow-up state, not a fabricated one.
    refundReference: { type: String },
    refundAdjustmentAmount: { type: Number, default: 0, min: 0 },
    liabilityStatus: {
      type: String,
      enum: ["none", "adjusted_pending", "adjusted_settled"],
      default: "none",
      index: true,
    },
    adjustedAt: Date,
  },
  { timestamps: true },
);

// Compound index for earnings queries
doctorPayoutSchema.index({ doctorId: 1, status: 1 });
doctorPayoutSchema.index({ doctorId: 1, createdAt: -1 });

export default mongoose.model("DoctorPayout", doctorPayoutSchema);

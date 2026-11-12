import mongoose from "mongoose";

// Phase 03 completion: a doctor's REQUEST that an admin review a refund that reduced their earning.
// It is a request for human review only: it never refunds, reverses, pays out or edits a payout, and it carries no patient
// identity. Admin resolution is audited. At most one ACTIVE (open/acknowledged) request exists per doctor+payment.
export const REFUND_REVIEW_STATUS = Object.freeze({ OPEN: "open", ACKNOWLEDGED: "acknowledged", RESOLVED: "resolved", DISMISSED: "dismissed" });
export const ACTIVE_REVIEW_STATUSES = Object.freeze(["open", "acknowledged"]);

const refundReviewSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    doctorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorPayout" },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
    status: { type: String, enum: Object.values(REFUND_REVIEW_STATUS), default: REFUND_REVIEW_STATUS.OPEN, index: true },
    // server-captured facts at request time (never client supplied)
    snapshot: { refundedAmount: Number, doctorAdjustment: Number, payoutStatus: String },
    adminNote: { type: String, trim: true, maxlength: 500 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
    timeline: [{ status: String, note: String, actorId: mongoose.Schema.Types.ObjectId, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true },
);

refundReviewSchema.index(
  { doctorId: 1, paymentId: 1 },
  { unique: true, name: "uniq_active_refund_review", partialFilterExpression: { status: { $in: ["open", "acknowledged"] } } },
);
refundReviewSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("RefundReview", refundReviewSchema);

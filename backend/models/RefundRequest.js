import mongoose from "mongoose";

const refundRequestSchema = new mongoose.Schema(
  {
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    // P23 — canonical reason category (Section 6). "reason" above is kept
    // for backward compatibility with existing timeline/email text; every
    // new request must also carry a real reasonCode validated against
    // refundPolicyEngine.js's REFUND_REASON_CATEGORIES — free text alone
    // (e.g. "test", "refund", "abc") is never sufficient on its own.
    reasonCode: { type: String, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    // Which of the four separated entry points (Section 7) created this
    // request — cancellation-refund, post-consultation problem report,
    // admin-initiated, or system-generated. Distinct from `reason`/
    // `reasonCode`, which describe WHY; this describes WHO/HOW.
    entryPoint: { type: String, enum: ["cancellation", "report_problem", "admin", "system"], default: "cancellation", index: true },
    // Funding-allocation snapshot (Sections 9/10/27/28), computed once by
    // refundPolicyEngine.computeFundingAllocation and persisted at
    // processing time so admins/support can see exactly how the refund was
    // routed without recomputing it from Payment's live counters.
    walletRefundAmount: { type: Number, default: 0, min: 0 },
    gatewayRefundAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["pending", "approved", "rejected", "processed", "failed"], default: "pending", index: true },
    refundState: { type: String, default: "requested", index: true },
    stateHistory: [{
      from: String,
      to: String,
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      source: String,
      reason: String,
      at: { type: Date, default: Date.now },
    }],
    attemptCount: { type: Number, default: 0, min: 0 },
    lastAttemptAt: Date,
    gatewayRefundId: { type: String, index: true, sparse: true },
    razorpayRefundId: String,
    // AUDIT FINDING (Phase UI-6): the schema already declared "failed" as a
    // valid status, but nothing in refundController.js ever set it or
    // recorded why — a gateway failure left the request stuck at "approved"
    // forever with no visible reason and no retry path. This field holds
    // the real error message surfaced by the gateway/system at the moment
    // of failure (never fabricated); cleared again on a successful retry.
    failureReason: { type: String, trim: true, maxlength: 500 },
    timeline: [{ status: String, note: String, at: { type: Date, default: Date.now }, actorId: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: true },
);

refundRequestSchema.index({ paymentId: 1, status: 1 });
refundRequestSchema.index(
  { paymentId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "approved"] } } },
);

const RefundRequest = mongoose.model("RefundRequest", refundRequestSchema);

export default RefundRequest;

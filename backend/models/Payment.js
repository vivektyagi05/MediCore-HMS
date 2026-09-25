import mongoose from "mongoose";

export const PAYMENT_STATUS = Object.freeze({
  CREATED: "created",
  ORDER_CREATED: "order_created",
  CHECKOUT_STARTED: "checkout_started",
  PENDING: "pending",
  AUTHORIZED: "authorized",
  CAPTURED: "captured",
  VERIFICATION_PENDING: "verification_pending",
  POST_PROCESSING: "post_processing",
  COMPLETED: "completed",
  POST_PROCESSING_FAILED: "post_processing_failed",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
});

// A payment is "collected" — money has actually reached the platform, even
// if some or all of it was later returned — in exactly these three states.
// This is the ONE canonical revenue-recognition group; every consumer
// (doctor earnings, admin finance, analytics, revenue funnels) must use it
// instead of redefining its own copy or comparing against the string
// "paid" (which is not a value of this enum at all -- Appointment.paymentStatus
// has its own, deliberately simpler PENDING/PAID/FAILED/REFUNDED vocabulary
// for booking-flow gating and must never be confused with Payment.status).
export const CAPTURED_LIKE_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.CAPTURED,
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
]);

export const REFUND_STATUS = Object.freeze({
  NONE: "none",
  PENDING: "pending",
  PARTIAL: "partial",
  FULL: "full",
  FAILED: "failed",
});

const paymentSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      index: true,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    gatewayAmount: {
      type: Number,
      min: 0,
    },
    walletAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
      uppercase: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.CREATED,
      index: true,
    },
    // P23 workflow state is separate from the legacy financial status so
    // existing reports/queries remain backward compatible while attempts,
    // verification and post-processing have explicit states.
    paymentState: { type: String, default: "created", index: true },
    gateway: {
      type: String,
      default: "razorpay",
      index: true,
    },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gatewayOrderId: { type: String, index: true },
    gatewayPaymentId: { type: String, index: true, sparse: true },
    paymentId: {
      type: String,
      index: true,
    },
    signature: {
      type: String,
      select: false,
    },
    refundStatus: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.NONE,
      index: true,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    processedGatewayRefundIds: { type: [String], default: [] },
    // P23 — funding-source refund tracking (Sections 9/27/28). refundedAmount
    // alone cannot answer "how much of the wallet-funded portion has been
    // refunded vs. the gateway-funded portion" — without this split, a
    // refund could (and previously did) send the FULL refund amount to the
    // gateway while ALSO crediting the wallet the full amount, silently
    // duplicating money. These two fields are the authoritative per-bucket
    // ledger the refund policy engine (refundPolicyEngine.js) reads and
    // writes; walletRefundedAmount + gatewayRefundedAmount must always sum
    // to refundedAmount.
    walletRefundedAmount: { type: Number, default: 0, min: 0 },
    gatewayRefundedAmount: { type: Number, default: 0, min: 0 },
    idempotencyKey: {
      type: String,
      index: true,
      sparse: true,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextRetryAt: Date,
    lockedAt: Date,
    // Phase A6.2.4 — Enterprise Monitoring Platform. Payments that have
    // exhausted paymentRetryService.js's MAX_RETRIES (3) with no further
    // retry scheduled are a genuine dead-letter set (see monitoringAggregates.js).
    // These two fields let an admin mark one reviewed from the Monitoring
    // Platform's Retry Queue without inventing a fake "replay" action this
    // codebase has no real gateway-retry path to back.
    retryResolvedAt: Date,
    retryResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // AUDIT FINDING (Phase UI-6 — refund concurrency hardening): the refund
    // flow had no mechanism preventing two concurrent admin actions (two
    // approvals, or approve+retry firing together) from both reaching the
    // Razorpay refund call for the same payment before either had persisted
    // its result — a genuine double-refund risk. This is a real pessimistic
    // lock, atomically acquired via a conditional findOneAndUpdate
    // (refundLockedAt: {$exists:false}) immediately before any gateway call
    // in refundController.js's processRefund(), and always released in a
    // finally block. Not decorative: nothing else in this schema serializes
    // access to a single payment's refund state.
    refundLockedAt: Date,
    paidAt: Date,
    failedAt: Date,
    stateHistory: [{
      from: String,
      to: String,
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      source: String,
      reason: String,
      at: { type: Date, default: Date.now },
    }],
    reconciliationState: {
      type: String,
      enum: ["not_required", "matched", "required", "resolved"],
      default: "not_required",
      index: true,
    },
    postProcessingState: {
      type: String,
      enum: ["pending", "complete", "failed"],
      default: "pending",
    },
    retryResolution: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.signature;
        delete ret.__v;
        return ret;
      },
    },
  },
);

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ appointmentId: 1, status: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;

import mongoose from "mongoose";

// F-001/F-023: a subscription is only `active` after a provider-confirmed
// payment. `created`/`past_due` are kept so legacy rows stay valid.
export const SUBSCRIPTION_STATUS = Object.freeze({
  CREATED: "created",
  PENDING_PAYMENT: "pending_payment",
  PAYMENT_PROCESSING: "payment_processing",
  ACTIVE: "active",
  PAYMENT_FAILED: "payment_failed",
  RENEWAL_PENDING: "renewal_pending",
  RENEWAL_FAILED: "renewal_failed",
  PAST_DUE: "past_due",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const paymentHistorySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["initial", "renewal"], required: true },
    gatewayOrderId: { type: String, required: true },
    gatewayPaymentId: String,
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["created", "captured", "failed", "expired"], default: "created" },
    createdAt: { type: Date, default: Date.now },
    settledAt: Date,
    failureReason: String,
  },
  { _id: false },
);

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", index: true },
    planCode: { type: String, required: true, index: true },
    planName: { type: String, required: true },
    interval: { type: String, enum: ["monthly", "yearly"], required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: Object.values(SUBSCRIPTION_STATUS), default: SUBSCRIPTION_STATUS.CREATED, index: true },
    // Snapshot of what the server priced at intent time (never taken from the client).
    pricingSnapshot: { planCode: String, planName: String, interval: String, amount: Number, currency: String, capturedAt: Date },
    gatewayOrderId: { type: String, index: true, sparse: true },
    gatewayPaymentId: { type: String, index: true, sparse: true },
    idempotencyKey: { type: String },
    paymentHistory: [paymentHistorySchema],
    activatedAt: Date,
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    // Posting after the activation claim (ledger, invoice) is a saga: failure here is
    // an explicit recoverable state, never silently ignored.
    postProcessingState: { type: String, enum: ["pending", "complete", "failed"], index: true, sparse: true },
    postProcessingError: String,
    razorpaySubscriptionId: { type: String, index: true },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    nextBillingAt: Date,
    autoRenew: { type: Boolean, default: true },
    failedRenewalCount: { type: Number, default: 0 },
    stateHistory: [{ from: String, to: String, source: String, reason: String, at: { type: Date, default: Date.now }, _id: false }],
  },
  { timestamps: true },
);


// N-024: was { unique: true, sparse: true }. sparse indexes still index explicit
// nulls, so a null/duplicate-null row breaks the build or collides later. The
// partial $type:"string" form indexes only real keys. Explicit name so it can
// be created additively beside a legacy sparse index (see migration 011).
subscriptionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_subscription_idempotency_key", partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

const Subscription = mongoose.model("Subscription", subscriptionSchema);

export default Subscription;

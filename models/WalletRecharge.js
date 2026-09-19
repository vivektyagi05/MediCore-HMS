import mongoose from "mongoose";

// P23 WALLET RECHARGE BUG FIX (Sections 2-16).
//
// AUDIT FINDING: wallet recharge had no real payment lifecycle at all. The
// old code created a bare TransactionLedger row (status: "pending"), then
// on the frontend's Razorpay `handler` callback (which only ever fires on
// checkout SUCCESS) called verifyWalletRecharge, which checked the
// signature and immediately credited the wallet. A valid signature only
// proves the checkout response wasn't tampered with — it does NOT prove
// the provider actually captured the payment, and it left every failure
// path (checkout dismissed, payment declined, network drop, browser
// refresh mid-checkout) with nothing to recover from and no wallet-side
// record of what happened.
//
// This model is the smallest dedicated wallet-recharge financial domain
// (Section 3) that can carry a real gateway-verified lifecycle without
// forcing unrelated appointment/doctor semantics onto Payment.
export const WALLET_RECHARGE_STATUS = Object.freeze({
  CREATED: "created",
  ORDER_CREATED: "order_created",
  CHECKOUT_STARTED: "checkout_started",
  PENDING: "pending",
  VERIFICATION_PENDING: "verification_pending",
  CAPTURED: "captured",
  POSTED: "posted",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  RECONCILIATION_REQUIRED: "reconciliation_required",
});

const walletRechargeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    gatewayOrderId: { type: String, required: true, index: true, unique: true },
    gatewayPaymentId: { type: String, index: true, sparse: true },
    signature: { type: String, select: false },
    status: {
      type: String,
      enum: Object.values(WALLET_RECHARGE_STATUS),
      default: WALLET_RECHARGE_STATUS.CREATED,
      index: true,
    },
    reconciliationState: { type: String, enum: ["not_required", "required", "matched"], default: "not_required" },
    failureReason: { type: String, trim: true, maxlength: 500 },
    walletTransactionId: { type: mongoose.Schema.Types.ObjectId },
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "TransactionLedger" },
    // Per-attempt history — a single recharge intent (one gateway order)
    // can be retried through checkout more than once (e.g. dismissed, then
    // re-opened) before either succeeding or being abandoned. Embedded
    // rather than a separate collection: this is deliberately the smallest
    // domain needed (Section 3), not a second PaymentAttempt system.
    attempts: [{
      startedAt: { type: Date, default: Date.now },
      completedAt: Date,
      outcome: { type: String, enum: ["captured", "failed", "cancelled", "unknown"] },
      gatewayPaymentId: String,
      failureReason: String,
    }],
    stateHistory: [{
      from: String,
      to: String,
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      source: String,
      reason: String,
      at: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true },
);

walletRechargeSchema.index({ userId: 1, status: 1 });
walletRechargeSchema.index({ userId: 1, createdAt: -1 });

const WalletRecharge = mongoose.model("WalletRecharge", walletRechargeSchema);

export default WalletRecharge;

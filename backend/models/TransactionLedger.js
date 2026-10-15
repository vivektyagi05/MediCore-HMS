import mongoose from "mongoose";

const transactionLedgerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", index: true, sparse: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", index: true },
    type: { type: String, enum: ["payment", "refund", "wallet_credit", "wallet_debit", "subscription", "coupon", "doctor_earning_reversal", "platform_fee_reversal", "doctor_earning", "platform_fee", "recharge", "subscription_payment", "withdrawal_reservation", "withdrawal_release", "withdrawal_settlement", "withdrawal_reversal", "adjustment"], required: true, index: true },
    direction: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["pending", "posted", "failed", "reversed"], default: "posted", index: true },
    referenceId: { type: String, index: true },
    idempotencyKey: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

transactionLedgerSchema.index({ createdAt: -1 });
// N-024: was { unique: true, sparse: true }. sparse indexes still index explicit
// nulls, so a null/duplicate-null row breaks the build or collides later. The
// partial $type:"string" form indexes only real keys. Explicit name so it can
// be created additively beside a legacy sparse index (see migration 011).
transactionLedgerSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_ledger_idempotency_key", partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

const TransactionLedger = mongoose.model("TransactionLedger", transactionLedgerSchema);

export default TransactionLedger;

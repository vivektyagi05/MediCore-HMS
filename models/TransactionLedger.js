import mongoose from "mongoose";

const transactionLedgerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", index: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", index: true },
    type: { type: String, enum: ["payment", "refund", "wallet_credit", "wallet_debit", "subscription", "coupon"], required: true, index: true },
    direction: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["pending", "posted", "failed", "reversed"], default: "posted", index: true },
    referenceId: { type: String, index: true },
    idempotencyKey: { type: String, unique: true, sparse: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

transactionLedgerSchema.index({ createdAt: -1 });

const TransactionLedger = mongoose.model("TransactionLedger", transactionLedgerSchema);

export default TransactionLedger;

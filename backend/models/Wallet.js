import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["credit", "debit", "refund", "payment"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    referenceType: {
      type: String,
      enum: ["payment", "refund", "manual", "subscription", "recharge"],
      default: "manual",
    },
    referenceId: String,
    description: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    transactions: {
      type: [walletTransactionSchema],
      default: [],
    },
    // Phase 02: ACTIVE funds holds only (a hold is removed atomically when it is
    // committed or released). Available balance = balance - sum(holds.amountPaise).
    // Embedded in the wallet document on purpose: placing, committing and
    // releasing a hold are each ONE single-document atomic update, which is the
    // only multi-statement guarantee MongoDB gives without transactions. The
    // durable lifecycle/recovery record lives in WalletReservation.
    holds: {
      type: [new mongoose.Schema({
        reservationId: { type: mongoose.Schema.Types.ObjectId, required: true },
        paymentId: { type: mongoose.Schema.Types.ObjectId, required: true },
        amountPaise: { type: Number, required: true, min: 1 },
        createdAt: { type: Date, default: Date.now },
      }, { _id: false })],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

const Wallet = mongoose.model("Wallet", walletSchema);

export default Wallet;

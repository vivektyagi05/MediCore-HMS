import mongoose from "mongoose";

// Phase 02 — durable lifecycle record of one wallet funds hold.
//
// The AUTHORITY on whether funds are held is the hold entry inside the Wallet
// document (single-document atomic). This record carries what a hold entry
// cannot: the business reference, the state machine, recovery leases and
// history, so a crash at ANY point can be diagnosed and finished safely.
//
//   holding           record inserted, hold not yet confirmed on the wallet
//   reserved          hold is active on the wallet (funds are not spendable)
//   committed         hold consumed: wallet balance debited exactly once
//   released          hold dropped, funds spendable again (releaseReason says why)
//   rejected          wallet could not cover it; nothing was ever held
//   recovery_required ambiguous/unsafe to resolve automatically; operator review
export const WALLET_RESERVATION_STATUS = Object.freeze({
  HOLDING: "holding",
  RESERVED: "reserved",
  COMMITTED: "committed",
  RELEASED: "released",
  REJECTED: "rejected",
  RECOVERY_REQUIRED: "recovery_required",
});

export const WALLET_RESERVATION_TRANSITIONS = Object.freeze({
  holding: ["reserved", "rejected", "released", "recovery_required"],
  reserved: ["committed", "released", "recovery_required"],
  recovery_required: ["committed", "released"],
  committed: [],
  released: [],
  rejected: [],
});

const walletReservationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet" },
    // The ONE business reference. Unique: a payment can own at most one reservation.
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: Object.values(WALLET_RESERVATION_STATUS), default: WALLET_RESERVATION_STATUS.HOLDING, index: true },
    releaseReason: { type: String, trim: true, maxlength: 300 },
    committedAt: Date,
    releasedAt: Date,
    // Recovery bookkeeping (fenced lease; bounded attempts).
    leaseOwner: String,
    leaseUntil: Date,
    recoveryAttempts: { type: Number, default: 0 },
    nextRecoveryAt: Date,
    lastRecoveryAt: Date,
    lastError: { type: String, maxlength: 300 },
    stateHistory: [{
      from: String,
      to: String,
      source: String,
      reason: String,
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true },
);

walletReservationSchema.index({ paymentId: 1 }, { unique: true, name: "uniq_wallet_reservation_payment" });
walletReservationSchema.index({ status: 1, updatedAt: 1 });

const WalletReservation = mongoose.model("WalletReservation", walletReservationSchema);
export default WalletReservation;

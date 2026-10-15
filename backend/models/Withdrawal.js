import mongoose from "mongoose";

// P23 Section 22 — the withdrawal domain this codebase never had.
// DoctorPayout records what the platform OWES a doctor for a specific
// consultation (earned/settled bookkeeping, Section 18). Withdrawal is a
// completely different concept: a doctor's own request to move money OUT
// of their available balance into their bank/beneficiary destination. The
// two must never be conflated — a "paid" DoctorPayout is not itself a
// withdrawal, and settling a payout does not create one.
export const WITHDRAWAL_STATUS = Object.freeze({
  REQUESTED: "requested",
  RESERVED: "reserved",
  PROCESSING: "processing",
  // F-002: no payout provider is integrated, so settlement is MANUAL. These two
  // states mean only "an authorized admin confirmed settlement happened outside
  // this system" — never "a bank transfer was confirmed". `completed` is legacy.
  MANUAL_PENDING: "manual_pending",
  MANUAL_COMPLETED: "manual_completed",
  COMPLETED: "completed",
  FAILED: "failed",
  RETRY_REQUIRED: "retry_required",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  CANCELLED: "cancelled",
});

const withdrawalSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    requestedAmount: { type: Number, required: true, min: 0 },
    // The balance actually available at the moment this request atomically
    // reserved it (Section 25/27) — a real snapshot, not a display estimate.
    availableBalanceAtRequest: { type: Number, required: true, min: 0 },
    approvedAmount: { type: Number, min: 0 },
    processedAmount: { type: Number, min: 0 },
    status: {
      type: String,
      enum: Object.values(WITHDRAWAL_STATUS),
      default: WITHDRAWAL_STATUS.REQUESTED,
      index: true,
    },
    // Ledger reference (Section 22) — no separate TransactionLedger entry
    // type exists for withdrawals yet, so this field is deliberately a
    // plain string reference rather than a fabricated relation; a future
    // phase can extend TransactionLedger and populate this from it.
    ledgerReference: { type: String },
    // Payout reference — set only if a specific DoctorPayout informed the
    // available-balance calculation; never a source of truth on its own.
    payoutReference: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorPayout" },
    // Beneficiary/bank reference. This codebase has no bank-account
    // management UI or model — deliberately kept as a free-text
    // destination label the doctor provides at request time rather than
    // inventing new banking infrastructure that doesn't otherwise exist.
    destinationLabel: { type: String, required: true, trim: true, maxlength: 200 },
    failureReason: { type: String, maxlength: 500 },
    // True while this withdrawal holds a claim on WithdrawalReservationGate.
    // Flipped inside the same conditional update as the status change, so a
    // release/claim happens exactly once.
    reservationHeld: { type: Boolean, default: false },
    settlementMode: { type: String, enum: ["manual", "provider"] },
    settlementReference: { type: String, trim: true, maxlength: 200 },
    settlementReason: { type: String, trim: true, maxlength: 500 },
    settledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    settledAt: Date,
    idempotencyKey: { type: String },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    completedAt: Date,
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

withdrawalSchema.index({ doctorId: 1, createdAt: -1 });
withdrawalSchema.index({ doctorId: 1, status: 1 });
// N-024: was { unique: true, sparse: true }. sparse indexes still index explicit
// nulls, so a null/duplicate-null row breaks the build or collides later. The
// partial $type:"string" form indexes only real keys. Explicit name so it can
// be created additively beside a legacy sparse index (see migration 011).
withdrawalSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_withdrawal_idempotency_key", partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);

export default Withdrawal;

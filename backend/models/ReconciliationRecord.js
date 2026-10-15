import mongoose from "mongoose";

// F-012: an explicit, durable record of a detected financial discrepancy. The
// reconciliation services only ever WRITE THESE; they never edit a balance.
// Correcting a balance is a separate, reasoned, audited action.
const reconciliationRecordSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["wallet_balance", "withdrawal_gate"], required: true, index: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    expectedPaise: { type: Number, required: true },
    actualPaise: { type: Number, required: true },
    driftPaise: { type: Number, required: true },
    status: { type: String, enum: ["open", "acknowledged", "resolved"], default: "open", index: true },
    detectedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolutionNote: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

// At most one OPEN record per subject and kind: repeated runs refresh it instead of piling up.
reconciliationRecordSchema.index(
  { kind: 1, subjectId: 1 },
  { unique: true, partialFilterExpression: { status: "open" }, name: "uniq_open_reconciliation_per_subject" },
);

export default mongoose.model("ReconciliationRecord", reconciliationRecordSchema);

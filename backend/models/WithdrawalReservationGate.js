import mongoose from "mongoose";

// F-014: one document per doctor that serializes balance claims. `committedPaise`
// is the total already claimed against the doctor's settled earnings by
// reserved/in-flight/completed withdrawals. A reservation is a single conditional
// $inc on this document (committedPaise <= net - amount), so two concurrent
// requests can never both claim the same funds. It is a materialized counter:
// reconcileWithdrawalGate() compares it with the Withdrawal rows and reports
// drift instead of silently repairing it.
const gateSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, unique: true },
    committedPaise: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("WithdrawalReservationGate", gateSchema);

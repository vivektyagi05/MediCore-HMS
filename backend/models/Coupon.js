import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: { type: String, trim: true, default: "" },
    type: { type: String, enum: ["percentage", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number, min: 0 },
    expiresAt: { type: Date, required: true, index: true },
    usageLimit: { type: Number, default: 1, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    isActive: { type: Boolean, default: true, index: true },
    // Phase 03 lifecycle. `usedCount` keeps its meaning (reserved + redeemed = slots consumed)
    // so every existing limit check stays correct. Each usedBy entry now says which it is:
    //   state "reserved"  - claimed at order creation; releasable
    //   state "redeemed"  - payment captured; permanent, never released
    //   state undefined   - legacy entry written before this lifecycle; left unclassified
    usedBy: [{
      userId: mongoose.Schema.Types.ObjectId,
      paymentId: mongoose.Schema.Types.ObjectId,
      usedAt: Date,
      state: { type: String, enum: ["reserved", "redeemed"] },
      reservedAt: Date,
      redeemedAt: Date,
    }],
    redeemedCount: { type: Number, default: 0, min: 0 },
    releasedCount: { type: Number, default: 0, min: 0 },
    rejectedCount: { type: Number, default: 0, min: 0 },
    lastRejectionCode: { type: String, maxlength: 60 },
  },
  { timestamps: true },
);

const Coupon = mongoose.model("Coupon", couponSchema);

export default Coupon;

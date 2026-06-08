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
    usedBy: [{ userId: mongoose.Schema.Types.ObjectId, paymentId: mongoose.Schema.Types.ObjectId, usedAt: Date }],
  },
  { timestamps: true },
);

const Coupon = mongoose.model("Coupon", couponSchema);

export default Coupon;

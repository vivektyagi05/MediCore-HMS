import mongoose from "mongoose";

const hospitalSettingSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: "global",
      unique: true,
      index: true,
    },
    hospitalName: {
      type: String,
      default: "HMS Pro Hospital",
      trim: true,
    },
    logoUrl: {
      type: String,
      default: "",
      trim: true,
    },
    supportEmail: {
      type: String,
      default: "support@hmspro.example",
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
      trim: true,
    },
    appointmentLimits: {
      dailyPerDoctor: { type: Number, default: 30, min: 1, max: 500 },
      bookingWindowDays: { type: Number, default: 30, min: 1, max: 365 },
    },
    paymentSettings: {
      currency: { type: String, default: "INR" },
      taxRate: { type: Number, default: 18, min: 0, max: 100 },
      refundsEnabled: { type: Boolean, default: true },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

const HospitalSetting = mongoose.model("HospitalSetting", hospitalSettingSchema);

export default HospitalSetting;

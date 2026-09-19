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
    // Phase A6.2.2 — Smart Assignment Engine. AUDIT FINDING: the brief asks
    // for real "Capacity"/"Utilization %"/"Never assign past 100%" rules,
    // but no per-admin or platform capacity concept existed anywhere in the
    // codebase. Rather than hardcode a magic number inside the scoring
    // engine (the brief's own "never hardcode values" rule), this is one
    // admin-editable setting reused by every workload/scoring calculation —
    // change it once here, every admin's utilization/overload math updates.
    operationsCapacity: {
      maxOpenItemsPerAdmin: { type: Number, default: 12, min: 1, max: 200 },
      overloadThresholdPct: { type: Number, default: 85, min: 1, max: 100 },
    },
    // Phase A6.3.5 — Process Governance. AUDIT FINDING: the brief's own
    // Section 8 risk-tier control table ("HIGH needs simulation+reviewer,
    // CRITICAL needs approval+segregation") is presented as an example,
    // not a hardcoded rule — and this codebase's own "never hardcode
    // values" discipline (see operationsCapacity above) applies just as
    // much here. One admin-editable policy block, read by
    // process-governance/governancePolicy.js, is the single source of
    // truth every governance decision derives from.
    governancePolicy: {
      approvalRequiredTiers: { type: [String], default: ["high", "critical"] },
      simulationRequiredTiers: { type: [String], default: ["high", "critical"] },
      documentationRequiredTiers: { type: [String], default: ["high", "critical"] },
      segregationOfDutiesTiers: { type: [String], default: ["critical"] },
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

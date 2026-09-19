import mongoose from "mongoose";

export const CONSENT_CATEGORIES = Object.freeze({
  ANALYTICS: "analytics",
  PERSONALIZATION: "personalization",
  COMMUNICATIONS: "communications",
});

const consentRecordSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  consentCategory: { type: String, enum: Object.values(CONSENT_CATEGORIES), required: true, index: true },
  granted: { type: Boolean, required: true },
  previousGranted: { type: Boolean },
  policyVersion: { type: String, required: true },
  consentVersion: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, immutable: true },
  source: { type: String, enum: ["privacy_preferences"], required: true },
  withdrawalTimestamp: Date,
}, { timestamps: false });

consentRecordSchema.index({ user: 1, consentCategory: 1, timestamp: -1 });

export default mongoose.model("ConsentRecord", consentRecordSchema);

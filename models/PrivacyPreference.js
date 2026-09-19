import mongoose from "mongoose";

const privacyPreferenceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  analytics: { type: Boolean, default: false },
  personalization: { type: Boolean, default: false },
  communications: { type: Boolean, default: false },
  policyVersion: { type: String, required: true },
  consentVersion: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model("PrivacyPreference", privacyPreferenceSchema);

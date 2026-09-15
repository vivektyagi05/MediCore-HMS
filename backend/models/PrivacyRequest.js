import mongoose from "mongoose";

export const PRIVACY_REQUEST_TYPES = Object.freeze({
  ACCESS: "access",
  CORRECTION: "correction",
  DELETION: "deletion",
  CONSENT_WITHDRAWAL: "consent_withdrawal",
  GRIEVANCE: "grievance",
  OTHER: "other",
});
export const PRIVACY_REQUEST_STATUSES = Object.freeze({
  PENDING: "pending",
  IN_REVIEW: "in_review",
  RESOLVED: "resolved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});

const privacyRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  requesterEmail: { type: String, trim: true, lowercase: true, maxlength: 120 },
  requestType: { type: String, enum: Object.values(PRIVACY_REQUEST_TYPES), required: true, index: true },
  status: { type: String, enum: Object.values(PRIVACY_REQUEST_STATUSES), default: PRIVACY_REQUEST_STATUSES.PENDING, index: true },
  description: { type: String, trim: true, maxlength: 4000, default: "" },
  requestedAt: { type: Date, default: Date.now, index: true },
  verifiedAt: Date,
  resolvedAt: Date,
  policyVersion: { type: String, required: true },
  consentVersion: { type: String },
  source: { type: String, enum: ["authenticated", "public_grievance"], required: true },
  resolutionNote: { type: String, trim: true, maxlength: 1000 },
  audit: {
    createdIp: { type: String, maxlength: 100 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
}, { timestamps: true });

privacyRequestSchema.index({ user: 1, requestType: 1, status: 1, createdAt: -1 });
privacyRequestSchema.index({ requesterEmail: 1, createdAt: -1 });

export default mongoose.model("PrivacyRequest", privacyRequestSchema);

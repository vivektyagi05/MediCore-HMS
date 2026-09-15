import mongoose from "mongoose";

export const LEAD_STATUSES = Object.freeze({
  NEW: "new",
  ACKNOWLEDGED: "acknowledged",
  IN_PROGRESS: "in_progress",
  WAITING_FOR_USER: "waiting_for_user",
  RESOLVED: "resolved",
  CLOSED: "closed",
});

export const LEAD_PRIORITIES = Object.freeze({ LOW: "low", MEDIUM: "medium", HIGH: "high", URGENT: "urgent" });
export const LEAD_INQUIRY_TYPES = Object.freeze({
  GENERAL: "general",
  PATIENT_SUPPORT: "patient_support",
  DOCTOR_SUPPORT: "doctor_support",
  HOSPITAL_PARTNERSHIP: "hospital_partnership",
  BUSINESS: "business",
  TECHNICAL: "technical",
  BILLING: "billing",
  PRIVACY: "privacy_data_rights",
  OTHER: "other",
});
export const LEAD_CONTACT_METHODS = Object.freeze({ EMAIL: "email", PHONE: "phone", EITHER: "either" });

const timelineSchema = new mongoose.Schema({
  type: { type: String, enum: ["created", "assigned", "priority_changed", "status_changed", "note_added", "updated", "resolved", "closed"], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  from: { type: String, maxlength: 120 },
  to: { type: String, maxlength: 120 },
  note: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const noteSchema = new mongoose.Schema({
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const leadSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, index: true },
  phone: { type: String, trim: true, maxlength: 30 },
  inquiryType: { type: String, enum: Object.values(LEAD_INQUIRY_TYPES), required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 180 },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  preferredContactMethod: { type: String, enum: Object.values(LEAD_CONTACT_METHODS), default: LEAD_CONTACT_METHODS.EITHER },
  source: { type: String, enum: ["CONTACT_FORM", "PUBLIC_CONTACT"], default: "CONTACT_FORM", index: true },
  status: { type: String, enum: Object.values(LEAD_STATUSES), default: LEAD_STATUSES.NEW, index: true },
  priority: { type: String, enum: Object.values(LEAD_PRIORITIES), default: LEAD_PRIORITIES.MEDIUM, index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  assignedAt: Date,
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  tags: { type: [String], default: [] },
  notes: { type: [noteSchema], default: [] },
  timeline: { type: [timelineSchema], default: [] },
  firstResponseAt: Date,
  resolvedAt: Date,
  closedAt: Date,
  privacyPolicyVersion: { type: String, required: true },
  termsVersion: { type: String, required: true },
  consentedAt: { type: Date, required: true },
  submissionFingerprint: { type: String, index: true, select: false },
  notification: {
    attemptedAt: Date,
    deliveredAt: Date,
    messageId: String,
    status: { type: String, enum: ["not_attempted", "delivered", "failed", "skipped"], default: "not_attempted" },
  },
}, { timestamps: true });

leadSchema.index({ status: 1, priority: 1, createdAt: -1 });
leadSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
leadSchema.index({ inquiryType: 1, createdAt: -1 });
leadSchema.index({ submissionFingerprint: 1, createdAt: -1 });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;

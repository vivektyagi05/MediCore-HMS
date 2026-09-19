// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
//
// AUDIT FINDING: AdminActivityLog (pre-existing) records action/resourceType/
// resourceId/severity/metadata — enough for a generic audit trail, but the
// brief's Step 5 requires each healing action to carry structured
// trigger/eligibility/safetyPolicy/rollbackPossible/approvalRequired
// fields specific to self-healing, which would have to live inside a loose
// `metadata` blob if shoehorned into AdminActivityLog. This is a genuinely
// new, additive model — writeAdminLog() is still called alongside it (see
// selfHealingEngine.js) so the existing Activity Log / Executive Action
// Center timeline keeps seeing every action too, nothing is duplicated
// away from it.
// ─────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const intelligenceActionLogSchema = new mongoose.Schema(
  {
    actionKey: { type: String, required: true, index: true }, // matches selfHealingEngine.ALLOWED_ACTIONS key
    trigger: { type: String, required: true }, // what surfaced this action: a prediction id, anomaly id, or "manual"
    eligibility: { type: String, required: true }, // plain-language reason this action was allowed to run
    safetyPolicy: { type: String, required: true }, // which guard/allowlist rule covers this action
    rollbackPossible: { type: Boolean, required: true },
    rollbackNote: { type: String, default: "" },
    approvalRequired: { type: Boolean, required: true, default: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["pending_approval", "executed", "failed", "rejected"], default: "pending_approval", index: true },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: "" },
    executedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

intelligenceActionLogSchema.index({ status: 1, createdAt: -1 });

const IntelligenceActionLog = mongoose.model("IntelligenceActionLog", intelligenceActionLogSchema);

export default IntelligenceActionLog;

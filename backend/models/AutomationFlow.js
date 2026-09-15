import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
//
// AUDIT FINDING: nothing in this codebase lets an admin AUTHOR a new
// automation. workflowRegistry.js/workflowStateMachine.js/workflowEngine.js
// (A6.2.1) execute a FIXED lifecycle (claim/assign/escalate/resolve/cancel)
// for the 10 hard-coded operation types, and assignmentEngine.js (A6.2.2)
// scores candidates for that same fixed lifecycle. Neither has a concept of
// "when real event X happens, if real condition Y, do real action Z" — that
// is a genuinely new capability, not a duplicate of either. This model is
// the definition record for it. It never re-implements the lifecycle state
// machine, the assignment scorer, or the notification/AI/feature-toggle
// services it drives — see backend/automation-studio/actionExecutor.js,
// which calls every one of those existing services directly.
//
// A flow is versioned by snapshotting itself into `versionHistory` on every
// publish (Clone/Compare/Rollback all read that array — no separate
// AutomationFlowVersion collection, since a flow document is already small
// and a second collection would only add join complexity for the same
// data).
// ─────────────────────────────────────────────────────────────────────────

// A condition GROUP is either a leaf rule ({field, operator, value,
// valueTo?}) or a nested AND/OR group of rules and/or groups — this
// recursive shape is what "Nested Groups" in the brief means. Kept as
// Mixed + validated at the application layer (conditionEvaluator.js)
// rather than a self-referencing Mongoose subschema, since Mongoose cannot
// express recursive subdocument schemas cleanly.
const conditionGroupSchema = new mongoose.Schema({}, { _id: false, strict: false });

const actionStepSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        "notify_user",
        "notify_role",
        "notify_admins",
        "activity_log",
        "feature_toggle",
        "webhook",
        "ai_insight",
        "assignment_recommend",
        "workflow_escalate",
        "reminder_note",
      ],
    },
    label: { type: String, trim: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const versionSnapshotSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    trigger: mongoose.Schema.Types.Mixed,
    conditions: mongoose.Schema.Types.Mixed,
    actions: [actionStepSchema],
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date, default: Date.now },
    changeNote: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const automationFlowSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    category: {
      type: String,
      // Mirrors the real trigger departments in triggerRegistry.js rather
      // than a freehand string, so Studio Home's category filter is always
      // a real, bounded set.
      enum: ["onboarding", "finance", "clinical", "infrastructure", "operations", "identity", "general"],
      default: "general",
    },
    tags: [{ type: String, trim: true }],
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },

    triggerType: { type: String, required: true, index: true }, // must be a key in triggerRegistry.js
    conditions: { type: conditionGroupSchema, default: null }, // null/empty = always matches
    actions: { type: [actionStepSchema], default: [] },

    version: { type: Number, default: 1 },
    versionHistory: { type: [versionSnapshotSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedAt: Date,
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    archivedAt: Date,

    isPinned: { type: Boolean, default: false },
    isFavorite: { type: Boolean, default: false },
    sourceTemplateKey: { type: String, default: null }, // set when created from a real template

    stats: {
      totalRuns: { type: Number, default: 0 },
      successCount: { type: Number, default: 0 },
      failureCount: { type: Number, default: 0 },
      skippedCount: { type: Number, default: 0 },
      lastRunAt: Date,
      lastRunStatus: { type: String, enum: ["success", "failed", "skipped", null], default: null },
      avgDurationMs: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

automationFlowSchema.index({ status: 1, triggerType: 1 });
automationFlowSchema.index({ name: "text", description: "text", tags: "text" });

const AutomationFlow = mongoose.model("AutomationFlow", automationFlowSchema);

export default AutomationFlow;

import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
//
// AUDIT FINDING: this codebase already has two "definition" concepts that
// look similar but are NOT the same thing, and this model must not
// duplicate either:
//   - AutomationFlow (A6.2.3) is a FLAT trigger -> conditions -> actions[]
//     list. Every action in the list runs unconditionally once the shared
//     condition tree matches — there is no per-step branching, no
//     approval/assignment node distinct from an "action", and no way for
//     one part of the definition to take a different path than another.
//   - processRegistry.js (A6.3.1) is a STATIC, read-only catalog of the
//     processes that already exist in the codebase (metadata only, no
//     persistence, admins cannot author new entries).
//
// What A6.3.3 asks for is a genuine GRAPH: nodes of different kinds
// (trigger/condition/decision/action/approval/assignment/notification/
// integration/end) connected by edges, where a CONDITION/DECISION node can
// route execution down different edges. That is a real, new capability —
// not a re-skin of AutomationFlow, and not a second workflow/automation
// engine, because every node that actually DOES something (action/
// approval/assignment/notification/integration) delegates to the exact
// same primitives AutomationFlow's own runtime already uses:
// automation-studio/actionExecutor.js#runActionStep and
// automation-studio/conditionEvaluator.js#evaluateConditionNode. See
// backend/process-designer/graphWalker.js.
//
// Versioning follows the same convention AutomationFlow already
// established (a `versionHistory` snapshot array on this same document,
// no separate ProcessDefinitionVersion collection) rather than inventing a
// new pattern for what is fundamentally the same problem.
// ─────────────────────────────────────────────────────────────────────────

const NODE_TYPES = Object.freeze([
  "trigger",
  "condition",
  "decision",
  "action",
  "approval",
  "assignment",
  "notification",
  "integration",
  "delay",
  "end",
]);

const nodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true, enum: NODE_TYPES },
    label: { type: String, trim: true, default: "" },
    // For trigger nodes: a key from automation-studio/triggerRegistry.js.
    // For condition/decision nodes: a condition tree (see conditionEvaluator.js).
    // For action/approval/assignment/notification/integration nodes: the
    // real actionExecutor.js action `type` this node maps to (see
    // process-designer/nodeRegistry.js) plus its config.
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const edgeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    // Only meaningful when `source` is a condition/decision node — which
    // branch this edge represents. evaluateConditionNode returns a single
    // boolean, so a decision node has at most a "true" and a "false" edge.
    branch: { type: String, enum: ["true", "false", null], default: null },
    label: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const versionSnapshotSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date, default: Date.now },
    changeNote: { type: String, trim: true, default: "" },
    riskLevel: { type: String, enum: ["low", "medium", "high", "critical", null], default: null },
  },
  { _id: false },
);

const processDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, index: true }, // stable across versions/clones
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    category: {
      type: String,
      enum: ["onboarding", "finance", "clinical", "infrastructure", "operations", "identity", "general"],
      default: "general",
    },

    // Real lifecycle per the brief's Section 2. VALIDATING is a transient
    // client-visible state used only while a validate/simulate call is
    // in flight — persisted here so a page refresh mid-validation still
    // shows the right state, but it always resolves to VALID or DRAFT
    // (with errors attached) by the time the request completes.
    //
    // Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
    // Intelligence. AUDIT FINDING: publishProcess/activateProcess had no
    // gate at all — any admin with manage_settings could publish/activate
    // any process regardless of risk. "pending_approval" is the ONE new
    // status this phase adds (governance/processGovernanceEngine.js decides
    // when a process must pass through it before publish); low/medium-risk
    // processes are entirely unaffected and keep going valid -> published
    // exactly as before (Section 3: "Preserve existing behavior"). There is
    // no separate "rejected" status — rejecting/requesting changes on a
    // pending_approval process returns it to "draft" (already editable),
    // which avoids adding a state that would just duplicate draft's
    // behavior (Section 5: extend the existing lifecycle, don't invent an
    // unrelated second one).
    status: {
      type: String,
      enum: ["draft", "validating", "valid", "pending_approval", "published", "active", "paused", "archived"],
      default: "draft",
      index: true,
    },

    version: { type: Number, default: 1 },
    versionHistory: { type: [versionSnapshotSchema], default: [] },
    // Set when this document is a new draft created by editing a
    // published/active version — never null for a version > 1 draft.
    parentVersion: { type: Number, default: null },

    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },

    // Last computed validation/risk/impact result, cached so the Process
    // Library list view never has to re-run the engines for every row.
    // Always recomputed (never trusted stale) before publish.
    lastValidation: {
      valid: { type: Boolean, default: null },
      errors: { type: [String], default: [] },
      warnings: { type: [String], default: [] },
      info: { type: [String], default: [] },
      computedAt: Date,
    },
    lastRisk: {
      level: { type: String, enum: ["low", "medium", "high", "critical", null], default: null },
      factors: { type: [String], default: [] },
      computedAt: Date,
    },

    owner: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedAt: Date,
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    activatedAt: Date,
    pausedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pausedAt: Date,
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    archivedAt: Date,

    // Phase A6.3.4 — Process Analytics & Optimization Intelligence.
    // AUDIT FINDING: no per-process SLA target existed anywhere in this
    // codebase (only the fixed Operation Registry SLA_TARGET_MS, which
    // has nothing to do with a process-graph run's own duration). Smallest
    // justified additive field per the brief's own Section 6/9 — optional,
    // admin-set, never a fabricated default. See process-analytics/
    // processAnalyticsAggregates.js#buildSlaIntelligence.
    slaTargetMs: { type: Number, default: null },

    stats: {
      totalRuns: { type: Number, default: 0 },
      successCount: { type: Number, default: 0 },
      failureCount: { type: Number, default: 0 },
      blockedCount: { type: Number, default: 0 },
      lastRunAt: Date,
      lastRunStatus: { type: String, enum: ["success", "failed", "blocked", null], default: null },
    },

    // ─── Phase A6.3.5 — Process Governance ─────────────────────────────
    // AUDIT FINDING (Section 2A/B): no ownership or classification concept
    // existed anywhere on this model. These are the ONLY fields the audit
    // justified — every value here is either admin-entered or left null
    // ("Not configured"), never a fabricated default. See
    // process-governance/processGovernanceEngine.js, the single place that
    // reads these to decide approval/simulation/documentation/segregation
    // requirements — never duplicated in a controller or the frontend.
    governance: {
      ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      criticality: { type: String, enum: [null, "low", "medium", "high", "critical"], default: null },
      dataSensitivity: { type: String, enum: [null, "low", "medium", "high"], default: null },
      patientImpact: { type: Boolean, default: false },
      financialImpact: { type: Boolean, default: false },
      documentationRequired: { type: Boolean, default: false },
      // Explicit, audited admin override of the computed approval
      // requirement — null means "let the policy engine decide" (the
      // normal case for every process). Never a silent bypass: setting
      // either value goes through updateGovernanceClassification, which
      // writes a normal admin audit log entry.
      governanceOverride: { type: String, enum: [null, "force_required", "force_not_required"], default: null },
      nextReviewDue: { type: Date, default: null },
    },

    // AUDIT FINDING (Section 6): no approval concept existed. This is the
    // CURRENT approval state for THIS version/document — because a
    // published/active version is immutable and editing forks a new
    // document (existing versioning convention), each version's own
    // approval decision is naturally preserved in its own document, no
    // separate approval-history collection needed.
    approval: {
      status: {
        type: String,
        enum: ["not_required", "pending", "approved", "rejected", "changes_requested"],
        default: "not_required",
      },
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      submittedAt: { type: Date, default: null },
      submittedReason: { type: String, trim: true, default: "" },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      decidedAt: { type: Date, default: null },
      decisionNote: { type: String, trim: true, default: "" },
    },

    // AUDIT FINDING (Section 2I/11): governance exceptions (emergency
    // overrides) must be visible and auditable, never a silent bypass.
    // Kept on the same document rather than a new collection — there is
    // exactly one kind of real exception this codebase can support
    // (emergency publish, gated to super_admin — see
    // processGovernanceController.js#emergencyPublish), so a small
    // append-only array here is proportionate; each entry is also written
    // to the existing AdminActivityLog so it appears in the one real Admin
    // Audit system too, never a second one.
    governanceExceptions: {
      type: [
        {
          type: { type: String, enum: ["emergency_override"], required: true },
          reason: { type: String, trim: true, required: true },
          actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          createdAt: { type: Date, default: Date.now },
          reviewRequired: { type: Boolean, default: true },
          reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          reviewedAt: { type: Date, default: null },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

// Only one ACTIVE version per key at a time — activating a new version must
// go through the controller's explicit pause-then-activate path rather than
// two versions silently both being live (brief Section 11: "duplicate
// active version" is itself a validation error).
processDefinitionSchema.index({ key: 1, version: 1 }, { unique: true });
processDefinitionSchema.index({ key: 1, status: 1 });
processDefinitionSchema.index({ name: "text", description: "text" });

export const PROCESS_NODE_TYPES = NODE_TYPES;

const ProcessDefinition = mongoose.model("ProcessDefinition", processDefinitionSchema);

export default ProcessDefinition;

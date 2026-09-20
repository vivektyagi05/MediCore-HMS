import mongoose from "mongoose";

// Phase A6.2.3 — Enterprise Automation Studio.
// Execution history for AutomationFlow runs — the "Execution Timeline" the
// Studio Home dashboard and the Execution Simulator both read from. Every
// run (real or dry-run/simulated) writes exactly one row here, same
// best-effort-never-breaks-the-caller pattern as cronRunTracker.js.

const stepResultSchema = new mongoose.Schema(
  {
    actionId: String,
    actionType: String,
    ok: Boolean,
    skipped: Boolean,
    message: String,
    durationMs: Number,
  },
  { _id: false },
);

// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// AUDIT FINDING: the brief's Section 14 ("Monitoring Integration") requires
// every process-graph run to become visible to this SAME execution log —
// "do NOT create a second monitoring system." flowId was required+ref
// AutomationFlow only, which cannot represent a ProcessDefinition run. Same
// fix pattern already used for Invoice in Phase D4 (relaxed a required
// either/or ref pair + a pre-validate hook) rather than inventing a new
// collection for what is the same "one run of one definition" concept.
const nodeResultSchema = new mongoose.Schema(
  {
    nodeId: String,
    nodeType: String,
    status: { type: String, enum: ["pass", "skipped", "blocked", "warning", "fail", "unsupported"] },
    message: String,
    durationMs: Number,
  },
  { _id: false },
);

const automationRunLogSchema = new mongoose.Schema(
  {
    sourceKind: { type: String, enum: ["automation_flow", "process_definition"], default: "automation_flow", index: true },
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationFlow", index: true },
    flowVersion: { type: Number },
    // Process Designer run identity — sourceKind: "process_definition" only.
    processDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: "ProcessDefinition", index: true },
    processKey: { type: String, index: true },
    processVersion: { type: Number },
    // Ordered node-by-node walk for a process-graph run (brief Section 7's
    // PASS/SKIPPED/BLOCKED/WARNING/FAIL/UNSUPPORTED states). Left empty for
    // ordinary AutomationFlow runs, which already have stepResults.
    nodeTrace: { type: [nodeResultSchema], default: [] },
    triggerType: { type: String, required: true, index: true },
    triggerPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    dryRun: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ["success", "failed", "skipped", "blocked"], required: true, index: true },
    conditionsMatched: { type: Boolean, default: true },
    stepResults: { type: [stepResultSchema], default: [] },
    error: String,
    startedAt: { type: Date, required: true },
    durationMs: Number,
    triggeredBy: { type: String, enum: ["event", "simulator", "manual"], default: "event" },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // set only for simulator/manual runs
  },
  { timestamps: true },
);

automationRunLogSchema.pre("validate", function enforceExactlyOneSource() {
  // Mongoose 9: no `next` callback; throw to fail validation.
  const hasFlow = Boolean(this.flowId);
  const hasProcess = Boolean(this.processDefinitionId);
  if (hasFlow === hasProcess) {
    throw new Error("AutomationRunLog requires exactly one of flowId or processDefinitionId.");
  }
  if (hasFlow) this.sourceKind = "automation_flow";
  if (hasProcess) this.sourceKind = "process_definition";
});

automationRunLogSchema.index({ flowId: 1, createdAt: -1 });
automationRunLogSchema.index({ processDefinitionId: 1, createdAt: -1 });
// Phase A6.2.4 — Enterprise Monitoring Platform. The Execution Explorer
// queries across ALL flows (previously every read here was scoped to one
// flowId), so a global status+recency index is a real additive need, not
// speculative.
automationRunLogSchema.index({ status: 1, createdAt: -1 });

const AutomationRunLog = mongoose.model("AutomationRunLog", automationRunLogSchema);

export default AutomationRunLog;

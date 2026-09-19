import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.4 — Process Analytics & Optimization Intelligence.
//
// AUDIT FINDING (Section 19): the brief requires real, persisted
// Optimization Center statuses ("no fake status transitions") — nothing
// in this codebase already models "a detected issue with a lifecycle."
// This is the smallest additive model that does: it never stores computed
// metrics itself (those are always recomputed live from
// process-analytics/processAnalyticsAggregates.js — one source of truth,
// Section 4), only the recommendation's own identity, evidence snapshot,
// and lifecycle state. Optimization NEVER mutates a live ProcessDefinition
// directly (Section 13) — `proposedDefinitionId` only ever points to a
// normal DRAFT version created through the existing Process Designer
// fork-on-edit path (processDesignerController.js#updateProcess), so
// validation/simulation/publish/activation are never bypassed.
// ─────────────────────────────────────────────────────────────────────────

const STATUSES = Object.freeze(["detected", "reviewed", "simulation_ready", "approved", "rejected", "implemented"]);
export const OPTIMIZATION_STATUSES = STATUSES;

const recommendationSchema = new mongoose.Schema(
  {
    processKey: { type: String, required: true, index: true },
    processVersion: { type: Number, required: true },
    issueType: {
      type: String,
      required: true,
      enum: ["slow_node", "failing_node", "high_skip_node", "sla_breach", "version_regression", "process_degradation"],
      index: true,
    },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], required: true },
    confidence: { type: String, enum: ["insufficient", "moderate", "high"], required: true },
    affectedNodeIds: { type: [String], default: [] },
    // Snapshot of the real computed evidence at detection time (node
    // stats, rates, sample size, data period) — never a hidden number the
    // UI can't trace back to process-analytics builders.
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    dataPeriodDays: { type: Number, required: true },
    issue: { type: String, required: true }, // one-line human summary
    recommendedChange: { type: String, required: true },
    why: { type: String, required: true },
    expectedBenefit: { type: String, required: true }, // always evidence-phrased, never a fabricated %

    status: { type: String, enum: STATUSES, default: "detected", index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    proposedDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: "ProcessDefinition" },
    simulationRunId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationRunLog" },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    decisionNote: { type: String, trim: true, default: "" },
    implementedAt: Date,

    // Dedup key so re-running detection doesn't spam duplicate open
    // recommendations for the same real issue on the same version.
    dedupeKey: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

recommendationSchema.index({ processKey: 1, status: 1 });
recommendationSchema.index({ dedupeKey: 1, status: 1 });

const ProcessOptimizationRecommendation = mongoose.model("ProcessOptimizationRecommendation", recommendationSchema);

export default ProcessOptimizationRecommendation;

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Intelligence Registry (brief Step 2's "one responsibility per module,
// no duplicated calculations" — this is the read-only catalog of what
// exists, mirroring workflowRegistry.js (A6.2.1) and triggerRegistry.js
// (A6.2.3)'s own registry pattern rather than inventing a new shape).
// ─────────────────────────────────────────────────────────────────────────

import { ALLOWED_ACTIONS } from "./selfHealingEngine.js";

export const CAPABILITIES = Object.freeze({
  predictions: {
    label: "Prediction Engine",
    description: "SLA breach, queue pressure, refund backlog, verification delay, payment retry exhaustion, cron failure trend, notification congestion, assignment overload.",
    module: "predictionEngine.js",
  },
  anomalies: {
    label: "Anomaly Detector",
    description: "Statistical (z-score) deviation checks: revenue drop, refund spike, assignment imbalance, execution slowdown, automation/cron/webhook failure spikes, queue growth.",
    module: "anomalyDetector.js",
  },
  capacityForecast: {
    label: "Capacity Forecast",
    description: "1h/24h/7d/30d volume projections for operations, automation executions, cron runs, and assignment load; reuses the pre-existing appointment/revenue forecast.",
    module: "capacityForecast.js",
  },
  optimization: {
    label: "Workflow Optimization Engine",
    description: "Unused/duplicate-trigger/expensive automation flow detection with merge/disable/split/optimize suggestions.",
    module: "optimizationEngine.js + bottleneckAnalyzer.js",
  },
  selfHealing: {
    label: "Self-Healing Engine",
    description: "Policy-driven, approval-gated healing actions. Nothing executes without an explicit admin approval.",
    module: "selfHealingEngine.js",
    allowedActions: Object.entries(ALLOWED_ACTIONS).map(([key, def]) => ({ key, label: def.label, rollbackPossible: def.rollbackPossible })),
  },
  decisionEngine: {
    label: "Decision Engine",
    description: "Deterministic priority/risk/urgency classification wrapping every prediction, anomaly, and healing suggestion.",
    module: "decisionEngine.js",
  },
  confidenceEngine: {
    label: "Confidence Engine",
    description: "Shared 0-100 confidence score from five disclosed factors (historical success, sample size, data freshness, matching conditions, system health).",
    module: "confidenceEngine.js",
  },
});

export function listCapabilities() {
  return Object.entries(CAPABILITIES).map(([key, value]) => ({ key, ...value }));
}

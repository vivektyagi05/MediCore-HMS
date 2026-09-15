// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Decision Engine (brief Step 6).
//
// "Nothing executes without Decision Engine" (brief). In practice: every
// prediction, anomaly, and self-healing suggestion this phase produces is
// passed through decideOn() before it reaches the dashboard or the
// self-healing executor. The decision itself never executes anything — it
// only classifies. selfHealingEngine.js is the only module with write
// access, and it re-checks its own eligibility rules independently (never
// trusts a decision object as sufficient authorization by itself).
// ─────────────────────────────────────────────────────────────────────────

const SEVERITY_RISK = Object.freeze({ critical: 90, high: 65, medium: 35, low: 15 });
const SEVERITY_URGENCY = Object.freeze({ critical: "immediate", high: "same_day", medium: "this_week", low: "monitor" });

// Deterministic priority: severity is the primary driver, confidence acts
// as a modest tiebreaker only (never overrides a critical severity).
function derivePriority(severity, confidenceScore) {
  const base = SEVERITY_RISK[severity] ?? 35;
  if (base >= 90) return "critical";
  if (base >= 65) return confidenceScore >= 60 ? "high" : "medium";
  if (base >= 35) return confidenceScore >= 70 ? "medium" : "low";
  return "low";
}

/**
 * decideOn — wraps a single prediction OR anomaly object (both share
 * severity + confidence fields) into a Decision. `kind` is "prediction" |
 * "anomaly" | "healing_suggestion" purely for labeling; the math is
 * identical, since brief Step 6 asks for one shared engine, not three.
 */
export function decideOn(signal, { kind = "prediction", dependencies = [], blockingConditions = [], alternatives = [] } = {}) {
  const severity = signal.severity || "medium";
  const confidenceScore = signal.confidence ?? 50;
  const priority = derivePriority(severity, confidenceScore);
  const riskScore = SEVERITY_RISK[severity] ?? 35;

  return {
    signalId: signal.id,
    kind,
    priority,
    confidence: confidenceScore,
    businessImpact: signal.impact || signal.businessImpact || signal.reason || "Not disclosed by the source signal.",
    riskScore,
    urgency: SEVERITY_URGENCY[severity] || "monitor",
    dependencies,
    blockingConditions,
    suggestedExecutor: kind === "healing_suggestion" ? "self_healing_engine" : "admin_review",
    expectedOutcome: signal.recommendedAction || signal.recommendation || "Manual review required — no automated action defined for this signal.",
    alternativeActions: alternatives,
  };
}

/**
 * decideOnBatch — convenience wrapper used by the controller so predictions
 * and anomalies both flow through the same function call.
 */
export function decideOnBatch(signals, kind) {
  return (signals || []).map((signal) => ({ ...decideOn(signal, { kind }), signal }));
}

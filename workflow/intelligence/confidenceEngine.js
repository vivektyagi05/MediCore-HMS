// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Confidence Engine (brief Step 7).
//
// AUDIT FINDING: the pre-existing rule engine (backend/ai/aiInsights.js)
// hardcoded a fixed confidence number per insight type (0.82, 0.76, 0.68 —
// see generateAdminInsights()), and predictiveAnalytics.forecast() derived
// its own confidence inline (appointments.length > 20 ? 0.78 : 0.52) with
// no shared, explainable formula. Every new module in this phase (and, on
// a call-by-call basis, the two legacy ones above are left untouched since
// changing their stored/emitted values would be a behavior change outside
// this phase's scope) computes confidence through this ONE function so the
// "why" is always the same five factors, not a per-call guess.
//
// Deterministic only. No AI model call, no randomness. 0-100 integer score
// plus a plain-language breakdown of exactly which factors moved it.
// ─────────────────────────────────────────────────────────────────────────

const WEIGHTS = Object.freeze({
  historicalSuccess: 0.25,
  sampleSize: 0.2,
  dataFreshness: 0.2,
  matchingConditions: 0.2,
  systemHealth: 0.15,
});

function clamp01(n) {
  if (Number.isNaN(n) || n === null || n === undefined) return 0;
  return Math.max(0, Math.min(1, n));
}

// sampleSize: how many real data points back this signal (more = higher).
// Saturates at 30 samples — matches the "appointments.length > 20" style
// thresholds already used elsewhere in this codebase's rule engine.
function scoreSampleSize(sampleSize = 0) {
  return clamp01(sampleSize / 30);
}

// dataFreshnessMs: age of the newest data point used. Fresh (<1h) = 1.0,
// decaying linearly to 0 at 7 days old — an explicit, disclosed decay
// curve, never a hidden one.
function scoreDataFreshness(dataFreshnessMs = 0) {
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  return clamp01(1 - dataFreshnessMs / SEVEN_DAYS);
}

// historicalSuccess: 0-1 rate of how often this exact signal type has
// previously matched reality (e.g. a past "SLA breach" prediction that did
// go on to breach). Callers that have no such track record yet (a brand
// new signal type) should pass 0.5 (neutral) rather than fabricate a rate.
function scoreHistoricalSuccess(historicalSuccessRate = 0.5) {
  return clamp01(historicalSuccessRate);
}

// matchingConditions: 0-1 fraction of the defining conditions for this
// signal that are actually present in the data (e.g. 3 of 4 threshold
// checks tripped = 0.75). Missing-information is penalized here, not
// hidden.
function scoreMatchingConditions(matchingConditionsRatio = 1) {
  return clamp01(matchingConditionsRatio);
}

// systemHealth: 0-1 — how reliable the underlying subsystem itself has
// been recently (e.g. cron/automation success rate feeding this signal).
// A prediction built on a flaky data pipeline is honestly less confident
// even if the numbers themselves look decisive.
function scoreSystemHealth(systemHealthRatio = 1) {
  return clamp01(systemHealthRatio);
}

/**
 * computeConfidence — the single confidence formula for the whole
 * Intelligence Engine. Every input is a real, named factor; every caller
 * must pass real data or an explicitly-neutral default, never an invented
 * number tuned to "look right".
 */
export function computeConfidence({
  sampleSize = 0,
  dataFreshnessMs = 0,
  historicalSuccessRate = 0.5,
  matchingConditionsRatio = 1,
  systemHealthRatio = 1,
} = {}) {
  const factors = {
    sampleSize: scoreSampleSize(sampleSize),
    dataFreshness: scoreDataFreshness(dataFreshnessMs),
    historicalSuccess: scoreHistoricalSuccess(historicalSuccessRate),
    matchingConditions: scoreMatchingConditions(matchingConditionsRatio),
    systemHealth: scoreSystemHealth(systemHealthRatio),
  };

  const weighted =
    factors.historicalSuccess * WEIGHTS.historicalSuccess +
    factors.sampleSize * WEIGHTS.sampleSize +
    factors.dataFreshness * WEIGHTS.dataFreshness +
    factors.matchingConditions * WEIGHTS.matchingConditions +
    factors.systemHealth * WEIGHTS.systemHealth;

  const score = Math.round(clamp01(weighted) * 100);

  const explanation = [
    `Historical accuracy of this signal type: ${Math.round(factors.historicalSuccess * 100)}%`,
    `Sample size strength: ${Math.round(factors.sampleSize * 100)}% (${sampleSize} data points)`,
    `Data freshness: ${Math.round(factors.dataFreshness * 100)}%`,
    `Matching conditions present: ${Math.round(factors.matchingConditions * 100)}%`,
    `Underlying system health: ${Math.round(factors.systemHealth * 100)}%`,
  ];

  return { score, level: score >= 75 ? "high" : score >= 45 ? "medium" : "low", factors, explanation };
}

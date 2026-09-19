// Phase A6.2.2 — Smart Assignment Engine.
// Dependency-free tests for the pure-function scoring/capacity math, same
// style as slotEngine.test.mjs — no database, no mongoose models.

import assert from "node:assert/strict";
import { scoreCandidate, SCORE_WEIGHTS } from "../workflow/assignment/assignmentScoring.js";
import { computeUtilization, isAssignable } from "../workflow/assignment/assignmentPolicy.js";

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("assignmentScoring.test.mjs");

test("weights sum to 1", () => {
  const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights should sum to 1, got ${total}`);
});

test("computeUtilization flags at_capacity at 100%+", () => {
  const capacity = { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 85 };
  const util = computeUtilization(10, capacity);
  assert.equal(util.pct, 100);
  assert.equal(util.state, "at_capacity");
  assert.equal(isAssignable(util), false);
});

test("computeUtilization flags near_capacity at overload threshold", () => {
  const capacity = { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 85 };
  const util = computeUtilization(9, capacity);
  assert.equal(util.pct, 90);
  assert.equal(util.state, "near_capacity");
  assert.equal(isAssignable(util), true);
});

test("computeUtilization reports available below threshold", () => {
  const capacity = { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 85 };
  const util = computeUtilization(3, capacity);
  assert.equal(util.state, "available");
});

test("scoreCandidate rewards lower workload with a higher workload sub-score", () => {
  const item = { type: "refund_request", priority: "high" };
  const capacity = { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 85 };
  const busy = {
    item,
    workload: { utilization: computeUtilization(9, capacity), overdue: 0, openCount: 9 },
    history: { resolvedCountByType: {}, slaSuccessRate: null, recentEscalationsReceived: 0 },
    isOnline: true,
    maxExperienceInPool: 0,
  };
  const free = {
    ...busy,
    workload: { utilization: computeUtilization(1, capacity), overdue: 0, openCount: 1 },
  };
  const busyScore = scoreCandidate(busy);
  const freeScore = scoreCandidate(free);
  assert.ok(freeScore.total > busyScore.total, "candidate with lower workload should score higher");
});

test("scoreCandidate never fabricates a positive SLA score for a brand-new admin", () => {
  const item = { type: "refund_request", priority: "high" };
  const capacity = { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 85 };
  const brandNew = scoreCandidate({
    item,
    workload: { utilization: computeUtilization(0, capacity), overdue: 0, openCount: 0 },
    history: { resolvedCountByType: {}, slaSuccessRate: null, recentEscalationsReceived: 0 },
    isOnline: true,
    maxExperienceInPool: 5,
  });
  // Neutral, not a fabricated high/low value.
  assert.equal(brandNew.breakdown.slaHistory.score, 60);
  assert.equal(brandNew.breakdown.experience.score, 0);
});

test("scoreCandidate penalizes recent escalations received", () => {
  const item = { type: "refund_request", priority: "high" };
  const capacity = { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 85 };
  const base = {
    item,
    workload: { utilization: computeUtilization(2, capacity), overdue: 0, openCount: 2 },
    history: { resolvedCountByType: {}, slaSuccessRate: null, recentEscalationsReceived: 0 },
    isOnline: true,
    maxExperienceInPool: 0,
  };
  const escalated = { ...base, history: { ...base.history, recentEscalationsReceived: 3 } };
  assert.ok(scoreCandidate(base).total > scoreCandidate(escalated).total);
});

console.log("assignmentScoring.test.mjs done\n");

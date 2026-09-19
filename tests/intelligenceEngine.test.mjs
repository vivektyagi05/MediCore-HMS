// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Dependency-free tests for the pure-function math (no database, no
// mongoose models), same style as assignmentScoring.test.mjs/slotEngine.test.mjs.

import assert from "node:assert/strict";
import { computeConfidence } from "../workflow/intelligence/confidenceEngine.js";
import { decideOn } from "../workflow/intelligence/decisionEngine.js";
import { buildDailySeries, linearTrend, projectForward, latestPointZScore } from "../workflow/intelligence/trendAnalyzer.js";
import { ALLOWED_ACTIONS, isActionAllowed } from "../workflow/intelligence/selfHealingEngine.js";

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

console.log("intelligenceEngine.test.mjs");

test("computeConfidence returns 0-100 and higher sample size raises score", () => {
  const low = computeConfidence({ sampleSize: 1, historicalSuccessRate: 0.5 });
  const high = computeConfidence({ sampleSize: 30, historicalSuccessRate: 0.5, dataFreshnessMs: 0, matchingConditionsRatio: 1, systemHealthRatio: 1 });
  assert.ok(low.score >= 0 && low.score <= 100);
  assert.ok(high.score >= 0 && high.score <= 100);
  assert.ok(high.score > low.score, `expected high (${high.score}) > low (${low.score})`);
});

test("computeConfidence is deterministic for identical input", () => {
  const input = { sampleSize: 10, historicalSuccessRate: 0.7, dataFreshnessMs: 3600000, matchingConditionsRatio: 0.8, systemHealthRatio: 0.9 };
  const a = computeConfidence(input);
  const b = computeConfidence(input);
  assert.deepEqual(a, b);
});

test("decideOn never lets a low-confidence critical signal drop below high priority", () => {
  const decision = decideOn({ id: "x", severity: "critical", confidence: 10 }, { kind: "prediction" });
  assert.equal(decision.priority, "critical");
});

test("decideOn raises priority with confidence at the same severity tier", () => {
  const lowConf = decideOn({ id: "x", severity: "high", confidence: 20 });
  const highConf = decideOn({ id: "x", severity: "high", confidence: 80 });
  assert.equal(lowConf.priority, "medium");
  assert.equal(highConf.priority, "high");
});

test("buildDailySeries produces dense (no-gap) daily buckets", () => {
  const since = new Date("2026-01-01T00:00:00Z");
  const until = new Date("2026-01-05T00:00:00Z");
  const docs = [{ createdAt: new Date("2026-01-02T10:00:00Z") }, { createdAt: new Date("2026-01-02T14:00:00Z") }];
  const series = buildDailySeries(docs, "createdAt", since, until);
  assert.equal(series.length, 5);
  assert.equal(series.find((s) => s.date === "2026-01-02").count, 2);
  assert.equal(series.find((s) => s.date === "2026-01-03").count, 0);
});

test("linearTrend detects a positive slope on a rising series", () => {
  const series = [0, 1, 2, 3, 4].map((count, i) => ({ date: String(i), count }));
  const { slope, r2 } = linearTrend(series);
  assert.ok(slope > 0);
  assert.ok(r2 > 0.9);
});

test("projectForward never returns a negative count", () => {
  const series = [5, 4, 3, 2, 1, 0].map((count, i) => ({ date: String(i), count }));
  const projected = projectForward(series, 10);
  assert.ok(projected >= 0);
});

test("latestPointZScore flags an obvious spike", () => {
  const series = [1, 1, 1, 1, 1, 1, 20].map((count, i) => ({ date: String(i), count }));
  const { zScore } = latestPointZScore(series);
  assert.ok(zScore > 2, `expected zScore > 2, got ${zScore}`);
});

test("self-healing allowlist rejects any action not explicitly listed", () => {
  assert.equal(isActionAllowed("refund_money"), false);
  assert.equal(isActionAllowed("approve_doctor"), false);
  assert.equal(isActionAllowed("delete_patient_record"), false);
  assert.equal(isActionAllowed("modify_appointment"), false);
  assert.equal(isActionAllowed("send_prescription"), false);
});

test("self-healing allowlist only contains the 5 real, audited actions", () => {
  const keys = Object.keys(ALLOWED_ACTIONS).sort();
  assert.deepEqual(keys, [
    "recalculate_ai_insights",
    "refresh_assignment_sweep",
    "rerun_automation_cron",
    "retry_due_payments",
    "retry_failed_webhook",
  ]);
});

test("every allowed action discloses rollbackPossible and a safetyPolicy string", () => {
  for (const [key, def] of Object.entries(ALLOWED_ACTIONS)) {
    assert.equal(typeof def.rollbackPossible, "boolean", `${key} missing rollbackPossible`);
    assert.ok(def.safetyPolicy && def.safetyPolicy.length > 10, `${key} missing a real safetyPolicy`);
  }
});

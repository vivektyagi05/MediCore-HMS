// Phase A6.3.4 — Process Analytics & Optimization Intelligence.
// Dependency-free tests for the pure-function pieces of the analytics and
// optimization engines — no database, no mongoose models, no live server.
// Same style as monitoringAggregates.test.mjs / processDesignerValidation.test.mjs.
// The DB-backed aggregation builders (buildProcessPerformance, etc.) are
// exercised only via server boot + manual verification, same precedent
// every prior phase's aggregate builders already established (documented
// in the changelog as "not live-verified — no MongoDB in this sandbox").

import assert from "node:assert/strict";
import {
  durationStatsFrom,
  categorizeFailureMessage,
  round1,
  diffNodeSets,
  gradeForScore,
  MIN_SAMPLE_SIZE,
} from "../process-analytics/processAnalyticsAggregates.js";
import { severityFromRate, dedupeKeyFor } from "../process-analytics/processOptimizationEngine.js";

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

console.log("processAnalyticsEngine.test.mjs");

// ── durationStatsFrom ──────────────────────────────────────────────────

test("durationStatsFrom returns nulls for empty input", () => {
  const stats = durationStatsFrom([]);
  assert.equal(stats.avgDurationMs, null);
  assert.equal(stats.p95DurationMs, null);
});

test("durationStatsFrom computes avg/median/fastest/slowest for one value", () => {
  const stats = durationStatsFrom([500]);
  assert.equal(stats.avgDurationMs, 500);
  assert.equal(stats.fastestMs, 500);
  assert.equal(stats.slowestMs, 500);
});

test("durationStatsFrom computes correct avg and bounds for a spread of values", () => {
  const stats = durationStatsFrom([100, 200, 300, 400, 500]);
  assert.equal(stats.avgDurationMs, 300);
  assert.equal(stats.fastestMs, 100);
  assert.equal(stats.slowestMs, 500);
  assert.ok(stats.p95DurationMs >= stats.medianDurationMs);
});

// ── categorizeFailureMessage ────────────────────────────────────────────

test("categorizeFailureMessage detects timeout", () => {
  assert.equal(categorizeFailureMessage("Request timed out after 30s"), "timeout");
});

test("categorizeFailureMessage detects authorization", () => {
  assert.equal(categorizeFailureMessage("403 Forbidden - unauthorized"), "authorization");
});

test("categorizeFailureMessage falls back to unknown for empty message", () => {
  assert.equal(categorizeFailureMessage(""), "unknown");
  assert.equal(categorizeFailureMessage(null), "unknown");
});

test("categorizeFailureMessage falls back to other for unrecognized text", () => {
  assert.equal(categorizeFailureMessage("something completely unrelated happened"), "other");
});

// ── round1 ──────────────────────────────────────────────────────────────

test("round1 rounds to one decimal place", () => {
  assert.equal(round1(12.345), 12.3);
  assert.equal(round1(null), null);
});

// ── diffNodeSets ─────────────────────────────────────────────────────────

test("diffNodeSets detects added and removed nodes", () => {
  const from = [{ id: "a" }, { id: "b" }];
  const to = [{ id: "b" }, { id: "c" }];
  const diff = diffNodeSets(from, to);
  assert.deepEqual(diff.added, ["c"]);
  assert.deepEqual(diff.removed, ["a"]);
});

test("diffNodeSets reports no changes for identical node sets", () => {
  const nodes = [{ id: "a" }, { id: "b" }];
  const diff = diffNodeSets(nodes, nodes);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
});

// ── gradeForScore (Process Health Score) ─────────────────────────────────

test("gradeForScore labels 85+ as Healthy", () => {
  assert.equal(gradeForScore(90), "Healthy");
  assert.equal(gradeForScore(85), "Healthy");
});

test("gradeForScore labels 65-84 as Needs Attention", () => {
  assert.equal(gradeForScore(70), "Needs Attention");
  assert.equal(gradeForScore(65), "Needs Attention");
});

test("gradeForScore labels below 65 as Degraded", () => {
  assert.equal(gradeForScore(40), "Degraded");
  assert.equal(gradeForScore(0), "Degraded");
});

test("gradeForScore reports insufficient history for null score", () => {
  assert.equal(gradeForScore(null), "Insufficient execution history");
});

// ── severityFromRate (Optimization Engine) ───────────────────────────────

test("severityFromRate escalates to critical above the high threshold", () => {
  assert.equal(severityFromRate(45), "critical");
});

test("severityFromRate returns high between medium and high thresholds", () => {
  assert.equal(severityFromRate(25), "high");
});

test("severityFromRate returns medium below the medium threshold", () => {
  assert.equal(severityFromRate(5), "medium");
});

test("severityFromRate respects custom thresholds", () => {
  assert.equal(severityFromRate(35, { high: 30, medium: 10 }), "critical");
  assert.equal(severityFromRate(15, { high: 30, medium: 10 }), "high");
});

// ── dedupeKeyFor (Optimization Engine — recommendation dedup) ────────────

test("dedupeKeyFor produces a stable key regardless of node ID order", () => {
  const a = dedupeKeyFor("refund_flow", 3, "failing_node", ["n2", "n1"]);
  const b = dedupeKeyFor("refund_flow", 3, "failing_node", ["n1", "n2"]);
  assert.equal(a, b);
});

test("dedupeKeyFor differs across issue types for the same node", () => {
  const a = dedupeKeyFor("refund_flow", 3, "failing_node", ["n1"]);
  const b = dedupeKeyFor("refund_flow", 3, "slow_node", ["n1"]);
  assert.notEqual(a, b);
});

test("dedupeKeyFor differs across versions", () => {
  const a = dedupeKeyFor("refund_flow", 3, "failing_node", ["n1"]);
  const b = dedupeKeyFor("refund_flow", 4, "failing_node", ["n1"]);
  assert.notEqual(a, b);
});

// ── Minimum sample threshold constant (Section 7/9 discipline) ───────────

test("MIN_SAMPLE_SIZE is a sane positive threshold, not zero", () => {
  assert.ok(MIN_SAMPLE_SIZE >= 3);
});

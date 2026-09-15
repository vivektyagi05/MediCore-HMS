// Phase A6.2.4 — Enterprise Monitoring Platform.
// Dependency-free tests for the pure-function helpers, same style as
// automationConditionEvaluator.test.mjs / assignmentScoring.test.mjs — no
// database, no mongoose models.

import assert from "node:assert/strict";
import { percentile, buildTimelineFromRun } from "../monitoring/monitoringAggregates.js";

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

console.log("monitoringAggregates.test.mjs");

test("percentile returns 0 for empty input", () => {
  assert.equal(percentile([], 95), 0);
});

test("percentile p50 on an odd-length sorted array", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
});

test("percentile p95 picks a value near the top", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(values, 95), 95);
});

test("percentile is monotonic (p95 >= p50)", () => {
  const values = [5, 12, 40, 41, 42, 43, 900];
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  assert.ok(p95 >= p50);
});

test("buildTimelineFromRun: skipped run stops after the skip step", () => {
  const run = { startedAt: new Date(), conditionsMatched: false, stepResults: [], status: "skipped" };
  const timeline = buildTimelineFromRun(run);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].label, "Triggered");
  assert.equal(timeline[1].status, "skipped");
});

test("buildTimelineFromRun: successful run lists every step in order", () => {
  const run = {
    startedAt: new Date(),
    conditionsMatched: true,
    status: "success",
    durationMs: 120,
    stepResults: [
      { actionType: "notify_user", ok: true, skipped: false, durationMs: 40 },
      { actionType: "activity_log", ok: true, skipped: false, durationMs: 10 },
    ],
  };
  const timeline = buildTimelineFromRun(run);
  // Triggered, Conditions matched, notify_user, activity_log, Run completed
  assert.equal(timeline.length, 5);
  assert.equal(timeline[2].label, "notify_user");
  assert.equal(timeline[2].status, "success");
  assert.equal(timeline[3].label, "activity_log");
  assert.equal(timeline[4].label, "Run completed");
});

test("buildTimelineFromRun: a failed step is marked failed, not skipped", () => {
  const run = {
    startedAt: new Date(),
    conditionsMatched: true,
    status: "failed",
    durationMs: 55,
    stepResults: [{ actionType: "webhook", ok: false, skipped: false, message: "timeout" }],
  };
  const timeline = buildTimelineFromRun(run);
  const failedStep = timeline.find((s) => s.label === "webhook");
  assert.equal(failedStep.status, "failed");
  assert.equal(failedStep.message, "timeout");
  assert.equal(timeline.at(-1).label, "Run failed");
});

// Regression test for the AutomationHealthTab crash:
//   Uncaught TypeError: (state.flows || []) is not iterable
//
// Root cause: buildFlowHealthRanking()/buildCronHealthRanking() have
// always returned a plain OBJECT ({ flows, topFailing, ... } /
// { jobs, healthyCount, ... }), never a bare array — confirmed against
// AdminMonitoringPlatform.jsx's FlowCronHealthTab, an existing consumer of
// the exact same two endpoints that has always destructured them
// correctly (flowHealth.flows, flowHealth.publishedFlows,
// cronHealth.healthyCount). AutomationHealthTab
// (AdminOperationsCommandWorkspace.jsx) was the one consumer written on
// the wrong assumption that the endpoint returned an array directly.
//
// This test does not re-exercise the live DB aggregation (no Mongo in
// this sandbox — see repo-wide pattern) — it locks the STRUCTURAL shape
// of what the builders return by stubbing the Mongoose model calls, so
// this exact class of contract mismatch (array vs paginated/wrapped
// object) cannot silently reappear without a test failing.

import assert from "node:assert/strict";
import AutomationFlow from "../models/AutomationFlow.js";
import CronRunLog from "../models/CronRunLog.js";
import { buildFlowHealthRanking, buildCronHealthRanking } from "../monitoring/monitoringAggregates.js";

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("flowCronHealthShapeContract.test.mjs");

const originalFlowFind = AutomationFlow.find;
const originalCronAggregate = CronRunLog.aggregate;

await asyncTest("buildFlowHealthRanking returns an object with a `flows` array property, never a bare array itself", async () => {
  AutomationFlow.find = () => ({
    select: () => ({
      lean: async () => [
        { _id: "f1", name: "Flow One", status: "published", triggerType: "manual", stats: { totalRuns: 10, successCount: 8, failureCount: 2, avgDurationMs: 100 } },
        { _id: "f2", name: "Flow Two", status: "published", triggerType: "manual", stats: { totalRuns: 5, successCount: 1, failureCount: 4, avgDurationMs: 50 } },
      ],
    }),
  });

  const result = await buildFlowHealthRanking();

  // The historical bug: `[...(state.flows || [])]` on the frontend assumed
  // `result` itself was spreadable/iterable. It is not — it's a plain object.
  assert.equal(Array.isArray(result), false, "buildFlowHealthRanking must return an object, not a bare array");
  assert.ok(Array.isArray(result.flows), "result.flows must be an array");
  assert.ok(Array.isArray(result.topFailing), "result.topFailing must be an array");
  assert.equal(typeof result.totalFlows, "number");
  assert.equal(typeof result.publishedFlows, "number");
  // topFailing is already sorted worst-success-rate-first — the exact
  // ranking AutomationHealthTab needs, so it should be consumed directly
  // rather than re-derived client-side.
  assert.equal(result.topFailing[0].id, "f2");
});

await asyncTest("buildCronHealthRanking returns an object with a `jobs` array property, never a bare array itself", async () => {
  let call = 0;
  CronRunLog.aggregate = async () => {
    call += 1;
    if (call === 1) {
      return [{ _id: "reminderJob", totalRuns: 4, successCount: 3, failureCount: 1, avgDurationMs: 200, lastStartedAt: new Date() }];
    }
    return [{ _id: "reminderJob", latestStatus: "failed" }];
  };

  const result = await buildCronHealthRanking();

  assert.equal(Array.isArray(result), false, "buildCronHealthRanking must return an object, not a bare array");
  assert.ok(Array.isArray(result.jobs), "result.jobs must be an array");
  assert.equal(typeof result.healthyCount, "number");
  assert.equal(typeof result.totalCount, "number");
  assert.equal(result.jobs[0].latestStatus, "failed");
});

AutomationFlow.find = originalFlowFind;
CronRunLog.aggregate = originalCronAggregate;

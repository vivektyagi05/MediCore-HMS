// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Dependency-free tests for walkProcessGraph(). Uses only dryRun:true
// against SIDE_EFFECTING action types (notify_*, feature_toggle, webhook),
// which actionExecutor.js's runActionStep short-circuits BEFORE touching
// the database — see actionExecutor.js's own SIDE_EFFECTING set. This lets
// the Simulation Engine's real branching/graph logic be exercised with no
// live MongoDB, same sandbox constraint documented for every AI-pipeline
// test in this project (see run-all.mjs's own notes).

import assert from "node:assert/strict";
import { walkProcessGraph, buildProcessContext } from "../process-designer/graphWalker.js";

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("processDesignerGraphWalker.test.mjs");

const definition = {
  _id: "sim-def-1",
  name: "Test Refund Escalation",
  nodes: [
    { id: "t1", type: "trigger", config: { triggerType: "refund_requested" } },
    { id: "c1", type: "condition", config: { conditionTree: { field: "amount", operator: "greater_than", value: 1000 } } },
    { id: "n1", type: "notification", config: { actionType: "notify_admins", title: "Big refund", message: "Review" } },
    { id: "e1", type: "end" },
  ],
  edges: [
    { id: "e-t1-c1", source: "t1", target: "c1" },
    { id: "e-c1-n1", source: "c1", target: "n1", branch: "true" },
    { id: "e-c1-e1", source: "c1", target: "e1", branch: "false" },
    { id: "e-n1-e1", source: "n1", target: "e1" },
  ],
};

await test("condition matched -> notification node visited, dry-run never touches DB (skipped, not failed)", async () => {
  const context = buildProcessContext(definition, { amount: 5000, triggerType: "refund_requested" });
  const result = await walkProcessGraph(definition, context, { dryRun: true, startNodeId: "t1" });
  assert.equal(result.status, "success");
  const notifyNode = result.nodeTrace.find((n) => n.nodeId === "n1");
  assert.equal(notifyNode.status, "skipped"); // dry-run short-circuit — no notification actually sent
  const endNode = result.nodeTrace.find((n) => n.nodeId === "e1");
  assert.ok(endNode, "end node should be reached when condition matches");
});

await test("condition not matched -> takes false branch straight to end, notification node never visited", async () => {
  const context = buildProcessContext(definition, { amount: 10, triggerType: "refund_requested" });
  const result = await walkProcessGraph(definition, context, { dryRun: true, startNodeId: "t1" });
  const notifyNode = result.nodeTrace.find((n) => n.nodeId === "n1");
  assert.equal(notifyNode, undefined, "notification node must not be visited down the false branch");
  const endNode = result.nodeTrace.find((n) => n.nodeId === "e1");
  assert.ok(endNode, "end node should still be reached via the false branch");
});

const blockedDefinition = {
  _id: "sim-def-2",
  name: "Test Blocked Gate",
  nodes: [
    { id: "t1", type: "trigger", config: { triggerType: "role_changed" } },
    { id: "c1", type: "condition", config: { conditionTree: { field: "role", operator: "equals", value: "admin" } } },
    { id: "e1", type: "end" },
  ],
  // c1 has only ONE outgoing edge and no branch label — it is the implicit
  // "true" path. If the condition does not match, there is no false edge,
  // so the walk must report BLOCKED rather than silently succeeding.
  edges: [
    { id: "e-t1-c1", source: "t1", target: "c1" },
    { id: "e-c1-e1", source: "c1", target: "e1" },
  ],
};

await test("a condition gate with no false edge reports BLOCKED when it does not match", async () => {
  const context = buildProcessContext(blockedDefinition, { role: "patient", triggerType: "role_changed" });
  const result = await walkProcessGraph(blockedDefinition, context, { dryRun: true, startNodeId: "t1" });
  assert.equal(result.status, "blocked");
  const conditionNode = result.nodeTrace.find((n) => n.nodeId === "c1");
  assert.equal(conditionNode.status, "blocked");
});

const delayDefinition = {
  _id: "sim-def-3",
  name: "Test Delay Passthrough",
  nodes: [
    { id: "t1", type: "trigger", config: { triggerType: "role_changed" } },
    { id: "d1", type: "delay", config: {} },
    { id: "e1", type: "end" },
  ],
  edges: [
    { id: "e-t1-d1", source: "t1", target: "d1" },
    { id: "e-d1-e1", source: "d1", target: "e1" },
  ],
};

await test("delay node is honestly reported UNSUPPORTED but does not break the walk", async () => {
  const context = buildProcessContext(delayDefinition, { triggerType: "role_changed" });
  const result = await walkProcessGraph(delayDefinition, context, { dryRun: true, startNodeId: "t1" });
  const delayNode = result.nodeTrace.find((n) => n.nodeId === "d1");
  assert.equal(delayNode.status, "unsupported");
  const endNode = result.nodeTrace.find((n) => n.nodeId === "e1");
  assert.ok(endNode, "walk should still reach End past the unsupported node");
});

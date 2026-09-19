// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Dependency-free tests for the pure-function validation/risk engines, same
// style as automationConditionEvaluator.test.mjs / intelligenceEngine.test.mjs
// — no database, no mongoose models, no live server.

import assert from "node:assert/strict";
import { validateProcessGraph } from "../process-designer/graphValidator.js";
import { assessProcessRisk } from "../process-designer/riskEngine.js";
import { checkNodeActionType, getNodeRegistry } from "../process-designer/nodeRegistry.js";

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

console.log("processDesignerValidation.test.mjs");

function validGraph() {
  return {
    nodes: [
      { id: "t1", type: "trigger", config: { triggerType: "refund_requested" } },
      { id: "c1", type: "condition", config: { conditionTree: { field: "amount", operator: "greater_than", value: 1000 } } },
      { id: "a1", type: "notification", config: { actionType: "notify_admins", title: "High refund", message: "Review needed" } },
      { id: "e1", type: "end" },
    ],
    edges: [
      { id: "e-t1-c1", source: "t1", target: "c1" },
      { id: "e-c1-a1", source: "c1", target: "a1", branch: "true" },
      { id: "e-c1-e1", source: "c1", target: "e1", branch: "false" },
      { id: "e-a1-e1", source: "a1", target: "e1" },
    ],
  };
}

test("a well-formed graph is valid with no errors", () => {
  const result = validateProcessGraph(validGraph());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("empty graph is invalid — missing trigger and end", () => {
  const result = validateProcessGraph({ nodes: [], edges: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("no nodes")));
});

test("missing trigger is a hard error", () => {
  const g = validGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "trigger");
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing trigger")));
});

test("missing end node is a hard error", () => {
  const g = validGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "end");
  g.edges = g.edges.filter((e) => e.target !== "e1");
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing end node")));
});

test("orphan node (no incoming edge, not a trigger) is a hard error", () => {
  const g = validGraph();
  g.nodes.push({ id: "orphan1", type: "action", config: { actionType: "activity_log" } });
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Orphan node "orphan1"')));
});

test("unreachable node (edge exists but not reachable from any trigger) is a hard error", () => {
  const g = validGraph();
  // Two nodes pointing at each other, disconnected from the real graph.
  g.nodes.push({ id: "x1", type: "action", config: { actionType: "activity_log" } });
  g.nodes.push({ id: "x2", type: "end" });
  g.edges.push({ id: "e-x1-x2", source: "x1", target: "x2" });
  g.edges.push({ id: "e-x2-x1", source: "x2", target: "x1" }); // gives x1 an incoming edge so it isn't flagged as an orphan too
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Unreachable node "x1"')));
});

test("duplicate node IDs are a hard error", () => {
  const g = validGraph();
  g.nodes.push({ id: "t1", type: "end" });
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Duplicate node ID")));
});

test("edge referencing an unknown node is a hard error", () => {
  const g = validGraph();
  g.edges.push({ id: "e-bad", source: "t1", target: "does_not_exist" });
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("unknown target node")));
});

test("decision node without both true/false edges is a hard error", () => {
  const g = validGraph();
  g.nodes[1].type = "decision"; // c1 becomes a decision but only has both edges already... remove the false edge
  g.edges = g.edges.filter((e) => e.id !== "e-c1-e1");
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Decision node "c1" must have exactly one')));
});

test("unsupported node type (delay) is flagged, not silently allowed", () => {
  const g = validGraph();
  g.nodes.push({ id: "d1", type: "delay", config: {} });
  g.edges.push({ id: "e-a1-d1", source: "a1", target: "d1" });
  g.edges.push({ id: "e-d1-e1", source: "d1", target: "e1" });
  const result = validateProcessGraph(g);
  // delay is a warning (exposed, not faked), never silently valid-with-no-signal
  assert.ok(result.warnings.some((w) => w.includes("unsupported Delay/Wait")));
});

test("unrecognized action type on a real node type is a hard error", () => {
  const g = validGraph();
  g.nodes[2].config.actionType = "send_carrier_pigeon"; // not a real actionExecutor.js type
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("not a real capability")));
});

test("action type used on the wrong node type is a hard error (webhook is integration-only)", () => {
  const g = validGraph();
  g.nodes[2].config.actionType = "webhook"; // webhook only allowed on 'integration' nodes, not 'notification'
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("not a real capability")));
});

test("a real cycle with no trigger/end escape is a hard error", () => {
  const g = { nodes: [
    { id: "t1", type: "trigger", config: { triggerType: "payment_failed" } },
    { id: "a1", type: "action", config: { actionType: "activity_log" } },
    { id: "a2", type: "action", config: { actionType: "activity_log" } },
  ], edges: [
    { id: "e1", source: "t1", target: "a1" },
    { id: "e2", source: "a1", target: "a2" },
    { id: "e3", source: "a2", target: "a1" }, // cycle back
  ] };
  const result = validateProcessGraph(g);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Circular dependency detected")));
});

test("checkNodeActionType accepts a real trigger and rejects an unknown one", () => {
  assert.equal(checkNodeActionType({ id: "t1", type: "trigger", config: { triggerType: "payment_failed" } }), null);
  assert.ok(checkNodeActionType({ id: "t1", type: "trigger", config: { triggerType: "not_a_real_trigger" } }));
});

test("node registry exposes delay as unsupported and never fakes a working option", () => {
  const registry = getNodeRegistry();
  const delayEntry = registry.nodeTypes.find((n) => n.type === "delay");
  assert.equal(delayEntry.unsupported, true);
  assert.ok(delayEntry.unsupportedReason.includes("No background scheduler"));
});

test("node registry never lets the same real action type serve two different node types", () => {
  const registry = getNodeRegistry();
  const seen = new Map();
  for (const nodeType of registry.nodeTypes) {
    if (nodeType.type === "trigger") continue; // trigger options are keyed by `.key`, not `.type` — a different namespace entirely
    for (const option of nodeType.options || []) {
      if (seen.has(option.type)) {
        assert.fail(`action type "${option.type}" is reachable from both "${seen.get(option.type)}" and "${nodeType.type}"`);
      }
      seen.set(option.type, nodeType.type);
    }
  }
});

// ── Risk Engine ────────────────────────────────────────────────────────

test("a minimal notification-only process is LOW risk", () => {
  const g = validGraph();
  g.nodes = g.nodes.filter((n) => n.id !== "c1");
  g.edges = [{ id: "e1", source: "t1", target: "a1" }, { id: "e2", source: "a1", target: "e1" }];
  g.nodes[0].config.triggerType = "role_changed"; // not a financial/clinical trigger
  const risk = assessProcessRisk(g);
  assert.equal(risk.level, "low");
});

test("a financial-trigger + integration + approval process is HIGH or CRITICAL risk, with named reasons", () => {
  const g = {
    nodes: [
      { id: "t1", type: "trigger", config: { triggerType: "payment_failed" } },
      { id: "i1", type: "integration", config: { actionType: "webhook", url: "https://example.com" } },
      { id: "ap1", type: "approval", config: { actionType: "workflow_resolve" } },
      { id: "e1", type: "end" },
    ],
    edges: [
      { id: "e1a", source: "t1", target: "i1" },
      { id: "e2a", source: "i1", target: "ap1" },
      { id: "e3a", source: "ap1", target: "e1" },
    ],
  };
  const risk = assessProcessRisk(g);
  assert.ok(["high", "critical"].includes(risk.level));
  assert.ok(risk.factors.length > 0);
  assert.ok(risk.factors.some((f) => f.includes("financial event")));
});

test("a process using the unsupported delay node is penalized as a risk factor", () => {
  const g = validGraph();
  g.nodes.push({ id: "d1", type: "delay", config: {} });
  const risk = assessProcessRisk(g);
  assert.ok(risk.factors.some((f) => f.includes("unsupported")));
});

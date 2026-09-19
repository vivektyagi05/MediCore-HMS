// Phase A6.2.3 — Enterprise Automation Studio.
// Dependency-free tests for the pure-function condition evaluator, same
// style as assignmentScoring.test.mjs / slotEngine.test.mjs — no database,
// no mongoose models.

import assert from "node:assert/strict";
import { evaluateConditionNode, evaluateConditions } from "../automation-studio/conditionEvaluator.js";

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

console.log("automationConditionEvaluator.test.mjs");

test("null/empty condition tree always matches", () => {
  assert.equal(evaluateConditionNode(null, { any: "thing" }), true);
  assert.equal(evaluateConditionNode({ logic: "AND", rules: [] }, {}), true);
});

test("leaf equals operator", () => {
  const node = { field: "severity", operator: "equals", value: "critical" };
  assert.equal(evaluateConditionNode(node, { severity: "critical" }), true);
  assert.equal(evaluateConditionNode(node, { severity: "normal" }), false);
});

test("contains / starts_with / ends_with are case-insensitive", () => {
  assert.equal(evaluateConditionNode({ field: "reason", operator: "contains", value: "REFUND" }, { reason: "requesting a refund please" }), true);
  assert.equal(evaluateConditionNode({ field: "name", operator: "starts_with", value: "dr" }, { name: "Dr. Rao" }), true);
  assert.equal(evaluateConditionNode({ field: "email", operator: "ends_with", value: ".COM" }, { email: "a@b.com" }), true);
});

test("greater_than / less_than / between operate numerically", () => {
  assert.equal(evaluateConditionNode({ field: "amount", operator: "greater_than", value: 100 }, { amount: 500 }), true);
  assert.equal(evaluateConditionNode({ field: "amount", operator: "less_than", value: 100 }, { amount: 500 }), false);
  assert.equal(evaluateConditionNode({ field: "amount", operator: "between", value: 100, valueTo: 600 }, { amount: 500 }), true);
});

test("empty / not_empty", () => {
  assert.equal(evaluateConditionNode({ field: "notes", operator: "empty" }, { notes: "" }), true);
  assert.equal(evaluateConditionNode({ field: "notes", operator: "not_empty" }, { notes: "hi" }), true);
  assert.equal(evaluateConditionNode({ field: "missing", operator: "empty" }, {}), true);
});

test("nested AND group — all must pass", () => {
  const node = {
    logic: "AND",
    rules: [
      { field: "severity", operator: "equals", value: "critical" },
      { field: "amount", operator: "greater_than", value: 1000 },
    ],
  };
  assert.equal(evaluateConditionNode(node, { severity: "critical", amount: 2000 }), true);
  assert.equal(evaluateConditionNode(node, { severity: "critical", amount: 500 }), false);
});

test("nested OR group — any may pass", () => {
  const node = {
    logic: "OR",
    rules: [
      { field: "role", operator: "equals", value: "doctor" },
      { field: "role", operator: "equals", value: "admin" },
    ],
  };
  assert.equal(evaluateConditionNode(node, { role: "patient" }), false);
  assert.equal(evaluateConditionNode(node, { role: "admin" }), true);
});

test("deeply nested groups (AND of ORs)", () => {
  const node = {
    logic: "AND",
    rules: [
      { logic: "OR", rules: [{ field: "role", operator: "equals", value: "admin" }, { field: "role", operator: "equals", value: "doctor" }] },
      { field: "isActive", operator: "equals", value: true },
    ],
  };
  assert.equal(evaluateConditionNode(node, { role: "doctor", isActive: true }), true);
  assert.equal(evaluateConditionNode(node, { role: "patient", isActive: true }), false);
});

test("dot-path field access", () => {
  const node = { field: "payment.status", operator: "equals", value: "failed" };
  assert.equal(evaluateConditionNode(node, { payment: { status: "failed" } }), true);
});

test("malformed leaf (missing operator) never blocks a flow", () => {
  assert.equal(evaluateConditionNode({ field: "x" }, {}), true);
});

test("evaluateConditions returns a trace matching the leaves actually evaluated", () => {
  const node = {
    logic: "AND",
    rules: [
      { field: "severity", operator: "equals", value: "critical" },
      { field: "amount", operator: "greater_than", value: 100 },
    ],
  };
  const { matched, trace } = evaluateConditions(node, { severity: "critical", amount: 50 });
  assert.equal(matched, false);
  assert.equal(trace.length, 2);
  assert.equal(trace[0].result, true);
  assert.equal(trace[1].result, false);
});

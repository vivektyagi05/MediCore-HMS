// Phase A6.3.1/A6.3.2 — Enterprise Process Registry & Orchestration Core +
// Cross-System Integration Hub. Dependency-free tests for the pure-function
// registry/graph logic (no database), same style as
// assignmentScoring.test.mjs/intelligenceEngine.test.mjs.

import assert from "node:assert/strict";
import { listProcessDefinitions, getProcessDefinition, isKnownProcess, PROCESS_DEFINITIONS } from "../process/processRegistry.js";
import { discoverIntegrationEdges } from "../process/integrationHub.js";
import { buildProcessDependencyGraph, buildImpactGraph } from "../process/processGraph.js";
import { deriveSourceId } from "../process/eventOrchestration.js";

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

console.log("processRegistry.test.mjs");

test("every process id in the registry is unique and matches its own .id field", () => {
  const ids = Object.keys(PROCESS_DEFINITIONS);
  assert.equal(ids.length, new Set(ids).size, "duplicate process ids found");
  for (const id of ids) {
    assert.equal(PROCESS_DEFINITIONS[id].id, id, `entry keyed "${id}" has mismatched .id`);
  }
});

test("every dependency reference resolves to a real registry entry (no dangling edges)", () => {
  const all = listProcessDefinitions();
  const knownIds = new Set(all.map((p) => p.id));
  for (const proc of all) {
    for (const depId of proc.dependencies || []) {
      assert.ok(knownIds.has(depId), `${proc.id} depends on unknown process "${depId}"`);
    }
  }
});

test("the 10 existing Operation Registry types are present verbatim (never duplicated, never dropped)", () => {
  const expected = [
    "doctor_verification", "refund_request", "insurance_claim", "critical_report",
    "payment_failure", "webhook_failure", "automation_failure", "delayed_appointment",
    "emergency_patient", "unread_executive_alert",
  ];
  for (const key of expected) {
    assert.ok(isKnownProcess(key), `missing workflow-registry process "${key}"`);
    assert.equal(PROCESS_DEFINITIONS[key]._fromWorkflowRegistry, true, `${key} should be adapted from workflowRegistry, not hand-authored`);
  }
});

test("getProcessDefinition computes childProcesses as the inverse of dependencies", () => {
  const parent = listProcessDefinitions().find((p) => (p.dependencies || []).length > 0);
  assert.ok(parent, "expected at least one process with a dependency");
  const dep = getProcessDefinition(parent.dependencies[0]);
  assert.ok(dep.childProcesses.includes(parent.id), "child link not found on its declared dependency");
});

test("composite entries (admin_approval) are never marked executable by the orchestration layer inputs", () => {
  const composite = getProcessDefinition("admin_approval");
  assert.equal(composite.status, "composite");
  assert.equal(composite.entryPoints.length, 0, "composite entries must not declare their own entry points");
});

test("discoverIntegrationEdges produces one edge per dependency, with no static duplication", () => {
  const edges = discoverIntegrationEdges();
  const graph = buildProcessDependencyGraph();
  assert.equal(edges.length, graph.edges.length, "integration edges must mirror the registry's own dependency graph 1:1");
});

test("buildImpactGraph finds real downstream processes for a known upstream dependency", () => {
  const impact = buildImpactGraph("appointment_journey");
  assert.ok(impact.downstream.includes("prescription_lifecycle"), "prescription_lifecycle should be downstream of appointment_journey");
});

test("buildImpactGraph returns null for an unknown process id", () => {
  assert.equal(buildImpactGraph("not_a_real_process"), null);
});

test("deriveSourceId matches the same field-precedence convention automationEventBus.js uses", () => {
  assert.equal(deriveSourceId({ sourceId: "a" }), "a");
  assert.equal(deriveSourceId({ appointmentId: "b" }), "b");
  assert.equal(deriveSourceId({ userId: "c" }), "c");
  assert.equal(deriveSourceId({}), null);
});

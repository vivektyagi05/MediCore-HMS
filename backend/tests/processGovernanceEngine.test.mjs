// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence. Dependency-free tests, same style as
// processDesignerValidation.test.mjs / assignmentScoring.test.mjs — no
// database. governanceEngine.js accepts an injected `policy` (mirroring
// assignmentPolicy.js's computeUtilization(openCount, capacity) pattern)
// so evaluateGovernance() never has to reach HospitalSetting/Mongo here.

import assert from "node:assert/strict";
import { evaluateGovernance, computeGovernanceHealth, _internal } from "../process-governance/processGovernanceEngine.js";
import { escalateTier, tierAtLeast } from "../process-governance/governancePolicy.js";

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

console.log("processGovernanceEngine.test.mjs");

const POLICY = {
  approvalRequiredTiers: ["high", "critical"],
  simulationRequiredTiers: ["high", "critical"],
  documentationRequiredTiers: ["high", "critical"],
  segregationOfDutiesTiers: ["critical"],
};

function baseDoc(overrides = {}) {
  return {
    _id: "proc1",
    key: "proc1",
    name: "Test Process",
    description: "A real description.",
    status: "valid",
    nodes: [],
    edges: [],
    createdBy: "user_a",
    governance: {},
    approval: { status: "not_required" },
    lastValidation: { valid: true },
    ...overrides,
  };
}

// ── Tier escalation ──────────────────────────────────────────────────────

await test("escalateTier never downgrades", () => {
  assert.equal(escalateTier("high", "low"), "high");
  assert.equal(escalateTier("low", "critical"), "critical");
  assert.equal(escalateTier(null, "medium"), "medium");
});

await test("tierAtLeast compares tiers correctly", () => {
  assert.equal(tierAtLeast("high", "medium"), true);
  assert.equal(tierAtLeast("low", "medium"), false);
  assert.equal(tierAtLeast("critical", "critical"), true);
});

await test("classification alone can escalate a structurally low-risk process", () => {
  const tier = _internal.deriveClassificationTier({ patientImpact: true });
  assert.equal(tier, "high");
});

await test("classification never has to escalate when nothing is set", () => {
  const tier = _internal.deriveClassificationTier({});
  assert.equal(tier, "low");
});

// ── Policy-driven requirements ───────────────────────────────────────────

await test("a low-risk process requires nothing extra and is allowed", async () => {
  const doc = baseDoc();
  const result = await evaluateGovernance(doc, { risk: { level: "low", factors: [] }, policy: POLICY, hasSimulationEvidence: null, openCriticalFindings: 0 });
  assert.equal(result.approvalRequired, false);
  assert.equal(result.simulationRequired, false);
  assert.equal(result.allowed, true);
  assert.equal(result.status, "clear");
});

await test("a high-risk process requires approval, simulation, and documentation", async () => {
  const doc = baseDoc();
  const result = await evaluateGovernance(doc, { risk: { level: "high", factors: [] }, policy: POLICY, hasSimulationEvidence: false, openCriticalFindings: 0 });
  assert.equal(result.approvalRequired, true);
  assert.equal(result.simulationRequired, true);
  assert.equal(result.documentationRequired, true);
  assert.equal(result.segregationRequired, false);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((b) => b.includes("Simulation is required")));
  assert.ok(result.blockers.some((b) => b.includes("Governance approval is required")));
});

await test("a high-risk process with simulation evidence and a real description clears those two controls", async () => {
  const doc = baseDoc();
  const result = await evaluateGovernance(doc, { risk: { level: "high", factors: [] }, policy: POLICY, hasSimulationEvidence: true, openCriticalFindings: 0 });
  const simControl = result.controls.find((c) => c.control === "Simulation completed");
  const docControl = result.controls.find((c) => c.control === "Documentation present");
  assert.equal(simControl.status, "PASS");
  assert.equal(docControl.status, "PASS");
  // Approval is still outstanding, so still blocked overall.
  assert.equal(result.allowed, false);
});

await test("an approved high-risk process is allowed", async () => {
  const doc = baseDoc({ approval: { status: "approved", decidedBy: "user_b" }, governance: { ownerUserId: "owner1" } });
  const result = await evaluateGovernance(doc, { risk: { level: "high", factors: [] }, policy: POLICY, hasSimulationEvidence: true, openCriticalFindings: 0 });
  assert.equal(result.allowed, true);
  assert.equal(result.status, "clear");
});

await test("governanceOverride force_required escalates even a low-risk process", async () => {
  const doc = baseDoc({ governance: { governanceOverride: "force_required" } });
  const result = await evaluateGovernance(doc, { risk: { level: "low", factors: [] }, policy: POLICY, hasSimulationEvidence: null, openCriticalFindings: 0 });
  assert.equal(result.approvalRequired, true);
});

await test("governanceOverride force_not_required waives approval even at critical tier", async () => {
  const doc = baseDoc({ governance: { governanceOverride: "force_not_required" } });
  const result = await evaluateGovernance(doc, { risk: { level: "critical", factors: [] }, policy: POLICY, hasSimulationEvidence: true, openCriticalFindings: 0 });
  assert.equal(result.approvalRequired, false);
});

// ── Segregation of duties ────────────────────────────────────────────────

await test("segregation of duties fails when approver equals creator on a critical process", async () => {
  const doc = baseDoc({ createdBy: "user_a", approval: { status: "approved", decidedBy: "user_a" } });
  const result = await evaluateGovernance(doc, { risk: { level: "critical", factors: [] }, policy: POLICY, hasSimulationEvidence: true, openCriticalFindings: 0 });
  const segControl = result.controls.find((c) => c.control === "Segregation of duties");
  assert.equal(segControl.status, "FAIL");
  assert.ok(result.warnings.some((w) => w.includes("Segregation of duties")));
});

await test("segregation of duties passes when approver differs from creator on a critical process", async () => {
  const doc = baseDoc({ createdBy: "user_a", approval: { status: "approved", decidedBy: "user_b" } });
  const result = await evaluateGovernance(doc, { risk: { level: "critical", factors: [] }, policy: POLICY, hasSimulationEvidence: true, openCriticalFindings: 0 });
  const segControl = result.controls.find((c) => c.control === "Segregation of duties");
  assert.equal(segControl.status, "PASS");
});

await test("segregation of duties is NOT_APPLICABLE below its configured tier", async () => {
  const doc = baseDoc({ createdBy: "user_a", approval: { status: "approved", decidedBy: "user_a" } });
  const result = await evaluateGovernance(doc, { risk: { level: "high", factors: [] }, policy: POLICY, hasSimulationEvidence: true, openCriticalFindings: 0 });
  const segControl = result.controls.find((c) => c.control === "Segregation of duties");
  assert.equal(segControl.status, "NOT_APPLICABLE");
});

// ── Owner / findings controls ────────────────────────────────────────────

await test("an active process with no owner fails the owner control", async () => {
  const doc = baseDoc({ status: "active" });
  const result = await evaluateGovernance(doc, { risk: { level: "low", factors: [] }, policy: POLICY, hasSimulationEvidence: null, openCriticalFindings: 0 });
  const ownerControl = result.controls.find((c) => c.control === "Owner assigned");
  assert.equal(ownerControl.status, "FAIL");
  assert.ok(result.blockers.some((b) => b.includes("No owner")));
});

await test("a draft process with no owner only gets a warning, not a blocker", async () => {
  const doc = baseDoc({ status: "draft" });
  const result = await evaluateGovernance(doc, { risk: { level: "low", factors: [] }, policy: POLICY, hasSimulationEvidence: null, openCriticalFindings: 0 });
  const ownerControl = result.controls.find((c) => c.control === "Owner assigned");
  assert.equal(ownerControl.status, "WARNING");
  assert.equal(result.blockers.length, 0);
});

await test("open critical findings never block, only warn — never a fabricated hard-fail", async () => {
  const doc = baseDoc();
  const result = await evaluateGovernance(doc, { risk: { level: "low", factors: [] }, policy: POLICY, hasSimulationEvidence: null, openCriticalFindings: 3 });
  const findingsControl = result.controls.find((c) => c.control === "No unresolved critical findings");
  assert.equal(findingsControl.status, "WARNING");
  assert.equal(result.allowed, true);
});

await test("unchecked evidence (null) is reported as NOT_CONFIGURED, never fabricated as PASS or FAIL", async () => {
  const doc = baseDoc();
  const result = await evaluateGovernance(doc, { risk: { level: "high", factors: [] }, policy: POLICY, hasSimulationEvidence: null, openCriticalFindings: null });
  const simControl = result.controls.find((c) => c.control === "Simulation completed");
  const findingsControl = result.controls.find((c) => c.control === "No unresolved critical findings");
  assert.equal(simControl.status, "NOT_CONFIGURED");
  assert.equal(findingsControl.status, "NOT_CONFIGURED");
});

// ── Governance health mapping ────────────────────────────────────────────

await test("computeGovernanceHealth: no blockers/warnings is Healthy", () => {
  assert.equal(computeGovernanceHealth({ blockers: [], warnings: [], approvalRequired: false, approvalStatus: "not_required" }), "Healthy");
});

await test("computeGovernanceHealth: warnings only is Attention", () => {
  assert.equal(computeGovernanceHealth({ blockers: [], warnings: ["x"], approvalRequired: false, approvalStatus: "not_required" }), "Attention");
});

await test("computeGovernanceHealth: blockers is At Risk", () => {
  assert.equal(computeGovernanceHealth({ blockers: ["x"], warnings: [], approvalRequired: true, approvalStatus: "pending" }), "At Risk");
});

await test("computeGovernanceHealth: a rejected required approval is Critical", () => {
  assert.equal(computeGovernanceHealth({ blockers: [], warnings: [], approvalRequired: true, approvalStatus: "rejected" }), "Critical");
});

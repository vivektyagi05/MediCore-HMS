// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence.
//
// Section 4: "This must become the single source of truth. Do NOT
// duplicate these checks in controllers/React components/buttons." Every
// governance decision in this phase (submit-for-review, approve, reject,
// publish, activate, the compliance matrix, the governance dashboard KPIs)
// calls into evaluateGovernance() below — nothing re-implements a check.
//
// AUDIT FINDING (Section 4H — segregation of duties): the real Permission
// model is role-level only (super_admin/admin), not creator/reviewer/
// approver/publisher/operator — see models/Permission.js and
// constants/roles.js. It genuinely cannot support role-based separation.
// Per the brief's own instruction ("do NOT create new roles if existing
// permissions can handle this" — they cannot), segregation of duties here
// is enforced by comparing ACTOR IDENTITY (creator vs approver), not role.
// ─────────────────────────────────────────────────────────────────────────

import { assessProcessRisk } from "../process-designer/riskEngine.js";
import { getGovernancePolicy, escalateTier } from "./governancePolicy.js";

function deriveClassificationTier(governance = {}) {
  let tier = governance.criticality || null;
  if (governance.dataSensitivity === "high") tier = escalateTier(tier, "high");
  if (governance.patientImpact) tier = escalateTier(tier, "high");
  if (governance.financialImpact) tier = escalateTier(tier, "medium");
  return tier || "low";
}

function controlRow(control, status, evidence, owner, nextAction = null) {
  return { control, status, evidence, owner: owner || "Unassigned", lastChecked: new Date().toISOString(), nextAction };
}

/**
 * @param {object} doc - a ProcessDefinition (lean or hydrated)
 * @param {object} [opts]
 * @param {{level:string,factors:string[]}} [opts.risk] - reuse an
 *   already-computed risk result (e.g. from publishProcess) instead of
 *   recomputing; if omitted, computed fresh from doc.nodes/edges.
 * @param {boolean|null} [opts.hasSimulationEvidence] - real AutomationRunLog
 *   evidence, looked up by the caller (avoids N+1 queries when evaluating
 *   many processes at once via governanceAggregates.js). null = not checked.
 * @param {number} [opts.openCriticalFindings] - count of real, unresolved
 *   critical ProcessOptimizationRecommendation rows for this process.
 * @param {object} [opts.policy] - inject an already-fetched governance
 *   policy (same precedent as workflow/assignment/assignmentPolicy.js's
 *   computeUtilization(openCount, capacity) taking capacity as a plain
 *   argument) so this function stays callable with zero DB dependency in
 *   dependency-free tests; falls back to getGovernancePolicy() otherwise.
 */
export async function evaluateGovernance(doc, opts = {}) {
  const risk = opts.risk || assessProcessRisk({ nodes: doc.nodes || [], edges: doc.edges || [] });
  const governance = doc.governance || {};
  const classificationTier = deriveClassificationTier(governance);
  const riskLevel = escalateTier(risk.level, classificationTier);

  const policy = opts.policy || (await getGovernancePolicy());
  const overrideForced = governance.governanceOverride === "force_required";
  const overrideWaived = governance.governanceOverride === "force_not_required";

  const approvalRequired = overrideForced || (!overrideWaived && policy.approvalRequiredTiers.includes(riskLevel));
  const simulationRequired = policy.simulationRequiredTiers.includes(riskLevel);
  const documentationRequired = policy.documentationRequiredTiers.includes(riskLevel) || Boolean(governance.documentationRequired);
  const segregationRequired = policy.segregationOfDutiesTiers.includes(riskLevel);

  const ownerPresent = Boolean(governance.ownerUserId);
  const documentationPresent = Boolean((doc.description || "").trim());
  const hasSimulationEvidence = opts.hasSimulationEvidence ?? null;
  const openCriticalFindings = opts.openCriticalFindings ?? null;

  const blockers = [];
  const warnings = [];
  const requiredActions = [];
  const controls = [];

  // Owner assigned
  const ownerControlRequired = approvalRequired || doc.status === "active";
  controls.push(
    controlRow(
      "Owner assigned",
      ownerPresent ? "PASS" : ownerControlRequired ? "FAIL" : "WARNING",
      ownerPresent ? "A process owner is on file." : "No owner assigned.",
      ownerPresent ? String(governance.ownerUserId) : null,
      ownerPresent ? null : "Assign a process owner",
    ),
  );
  if (!ownerPresent && ownerControlRequired) {
    blockers.push("No owner is assigned to this process.");
    requiredActions.push("Assign a process owner");
  }

  // Risk classified
  controls.push(controlRow("Risk classified", "PASS", `Structural risk: ${risk.level}. Effective governance tier: ${riskLevel}.`, null));

  // Process validated (evidence: lastValidation on the document)
  const validated = doc.lastValidation?.valid === true;
  controls.push(
    controlRow(
      "Process validated",
      validated ? "PASS" : doc.status === "draft" ? "NOT_CONFIGURED" : "FAIL",
      validated ? "Last validation passed." : "No passing validation on record.",
      null,
      validated ? null : "Run validation",
    ),
  );

  // Simulation completed
  if (simulationRequired) {
    let status = "NOT_CONFIGURED";
    let evidence = "Simulation evidence was not checked in this context.";
    if (hasSimulationEvidence === true) {
      status = "PASS";
      evidence = "A simulation run exists for this process.";
    } else if (hasSimulationEvidence === false) {
      status = "FAIL";
      evidence = "No simulation run exists for this process yet.";
      blockers.push("Simulation is required for this risk tier but has not been run.");
      requiredActions.push("Run a simulation");
    }
    controls.push(controlRow("Simulation completed", status, evidence, null, status === "FAIL" ? "Run a simulation" : null));
  } else {
    controls.push(controlRow("Simulation completed", "NOT_APPLICABLE", `Not required at ${riskLevel} tier.`, null));
  }

  // Documentation present
  if (documentationRequired) {
    controls.push(
      controlRow(
        "Documentation present",
        documentationPresent ? "PASS" : "FAIL",
        documentationPresent ? "Process has a written description." : "Process description is empty.",
        null,
        documentationPresent ? null : "Write a process description",
      ),
    );
    if (!documentationPresent) {
      blockers.push("Documentation is required for this risk tier but the process description is empty.");
      requiredActions.push("Write a process description");
    }
  } else {
    controls.push(controlRow("Documentation present", "NOT_APPLICABLE", `Not required at ${riskLevel} tier.`, null));
  }

  // Approval completed
  if (approvalRequired) {
    const approval = doc.approval || {};
    let status = "FAIL";
    let evidence = "Approval has not been requested.";
    if (approval.status === "approved") {
      status = "PASS";
      evidence = `Approved by ${approval.decidedBy || "an admin"}.`;
    } else if (approval.status === "pending") {
      status = "WARNING";
      evidence = "Approval is pending.";
      warnings.push("This process is awaiting governance approval.");
    } else if (["rejected", "changes_requested"].includes(approval.status)) {
      status = "FAIL";
      evidence = `Governance decision: ${approval.status.replace("_", " ")}.`;
    }
    controls.push(controlRow("Approval completed", status, evidence, approval.decidedBy ? String(approval.decidedBy) : null, status === "PASS" ? null : "Submit for governance review"));
    if (status !== "PASS") {
      blockers.push("Governance approval is required for this risk tier and has not been granted.");
      if (approval.status === "not_required" || !approval.status) requiredActions.push("Submit for governance review");
    }
  } else {
    controls.push(controlRow("Approval completed", "NOT_APPLICABLE", `Not required at ${riskLevel} tier.`, null));
  }

  // Segregation of duties
  if (segregationRequired) {
    const decidedBy = doc.approval?.decidedBy;
    if (!decidedBy) {
      controls.push(controlRow("Segregation of duties", "NOT_CONFIGURED", "No approval decision recorded yet.", null));
    } else {
      const same = String(decidedBy) === String(doc.createdBy);
      controls.push(
        controlRow(
          "Segregation of duties",
          same ? "FAIL" : "PASS",
          same ? "The approver is also the creator of this critical-risk process." : "Approver is distinct from the creator.",
          String(decidedBy),
        ),
      );
      if (same) warnings.push("Segregation of duties: the approver is also the creator of this critical-risk process.");
    }
  } else {
    controls.push(controlRow("Segregation of duties", "NOT_APPLICABLE", `Not required at ${riskLevel} tier.`, null));
  }

  // No unresolved critical findings
  if (openCriticalFindings === null) {
    controls.push(controlRow("No unresolved critical findings", "NOT_CONFIGURED", "Optimization findings were not checked in this context.", null));
  } else {
    controls.push(
      controlRow(
        "No unresolved critical findings",
        openCriticalFindings > 0 ? "WARNING" : "PASS",
        openCriticalFindings > 0 ? `${openCriticalFindings} unresolved critical optimization finding(s).` : "No unresolved critical findings.",
        null,
        openCriticalFindings > 0 ? "Review optimization findings" : null,
      ),
    );
    if (openCriticalFindings > 0) warnings.push(`${openCriticalFindings} unresolved critical optimization finding(s) on this process.`);
  }

  // Audit trail complete (evidence-based, not fabricated)
  const auditComplete =
    (doc.status !== "published" && doc.status !== "active") ||
    (doc.status === "published" ? Boolean(doc.publishedBy && doc.publishedAt) : Boolean(doc.activatedBy && doc.activatedAt));
  controls.push(controlRow("Audit trail complete", auditComplete ? "PASS" : "FAIL", auditComplete ? "Lifecycle actor/timestamp fields are populated." : "Missing actor/timestamp for current lifecycle state.", null));

  const governanceSatisfied = !approvalRequired || doc.approval?.status === "approved";
  const allowed = blockers.length === 0 && governanceSatisfied;
  const status = blockers.length > 0 ? "blocked" : !governanceSatisfied ? "approval_pending" : warnings.length > 0 ? "attention" : "clear";

  return {
    allowed,
    status,
    blockers,
    warnings,
    requiredActions: [...new Set(requiredActions)],
    riskLevel,
    structuralRiskLevel: risk.level,
    approvalRequired,
    simulationRequired,
    documentationRequired,
    segregationRequired,
    controls,
  };
}

/** Deterministic dashboard health label (Section 12.2 — "no arbitrary percentage scores"). */
export function computeGovernanceHealth({ blockers = [], warnings = [], approvalRequired, approvalStatus }) {
  const criticalBlocker = approvalRequired && ["rejected"].includes(approvalStatus);
  if (criticalBlocker) return "Critical";
  if (blockers.length > 0) return "At Risk";
  if (warnings.length > 0) return "Attention";
  return "Healthy";
}

export const _internal = { deriveClassificationTier, controlRow };

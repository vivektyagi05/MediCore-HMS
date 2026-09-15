// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Risk Engine (brief Section 10): "Do not use AI to determine the primary
// risk score. AI can explain it later." This is a pure, deterministic
// function over real structural factors — see promptLibrary.js's
// processRiskExplain, which only ever explains this output, never
// computes its own score.
// ─────────────────────────────────────────────────────────────────────────

const DESTRUCTIVE_ACTION_TYPES = new Set(["feature_toggle", "workflow_resolve", "workflow_escalate"]);
const FINANCIAL_TRIGGER_TYPES = new Set(["payment_failed", "payment_success", "refund_requested", "refund_approved"]);
const PATIENT_DATA_TRIGGER_TYPES = new Set(["critical_report_uploaded", "insurance_submitted"]);

/**
 * Each factor is { code, weight, reason } — weight sums determine the
 * level. Every reason string names the real node/config that caused it,
 * so "explain WHY" (brief Section 10) never has to be a separate lookup.
 */
export function assessProcessRisk({ nodes = [], edges = [] } = {}) {
  const factors = [];
  let score = 0;

  const nodeTypes = new Set(nodes.map((n) => n.type));
  const triggerTypes = nodes.filter((n) => n.type === "trigger").map((n) => n.config?.triggerType).filter(Boolean);

  for (const node of nodes) {
    const actionType = node.config?.actionType;
    if (actionType && DESTRUCTIVE_ACTION_TYPES.has(actionType)) {
      score += 2;
      factors.push({ code: "destructive_action", weight: 2, reason: `Node "${node.id}" performs a destructive/state-changing action (${actionType}).` });
    }
    if (node.type === "integration") {
      score += 2;
      factors.push({ code: "external_integration", weight: 2, reason: `Node "${node.id}" calls an external system (outbound webhook).` });
    }
  }

  for (const triggerType of triggerTypes) {
    if (FINANCIAL_TRIGGER_TYPES.has(triggerType)) {
      score += 3;
      factors.push({ code: "financial_action", weight: 3, reason: `Process triggers on a financial event ("${triggerType}").` });
    }
    if (PATIENT_DATA_TRIGGER_TYPES.has(triggerType)) {
      score += 2;
      factors.push({ code: "patient_data_mutation", weight: 2, reason: `Process triggers on a clinical/patient-data event ("${triggerType}").` });
    }
  }

  const touchesMultipleRoles = nodeTypes.has("notification") && (nodeTypes.has("assignment") || nodeTypes.has("approval"));
  if (touchesMultipleRoles) {
    score += 1;
    factors.push({ code: "cross_role_workflow", weight: 1, reason: "Process both notifies users and assigns/approves work — it crosses more than one role boundary." });
  }

  const hasApprovalOrIntegration = nodes.some((n) => n.type === "approval" || n.type === "integration");
  const singleOutcomeRiskyNodes = nodes.filter((n) => (n.type === "approval" || n.type === "integration") && (edgesOut(edges, n.id).length <= 1));
  if (hasApprovalOrIntegration && singleOutcomeRiskyNodes.length) {
    score += 2;
    factors.push({ code: "missing_failure_handling", weight: 2, reason: `${singleOutcomeRiskyNodes.length} approval/integration node(s) have no distinct failure branch.` });
  }

  const unsupportedNodes = nodes.filter((n) => n.type === "delay");
  if (unsupportedNodes.length) {
    score += 3;
    factors.push({ code: "unsupported_dependency", weight: 3, reason: `${unsupportedNodes.length} node(s) use the unsupported Delay/Wait type — this process cannot fully execute until that dependency is added.` });
  }

  let level = "low";
  if (score >= 9) level = "critical";
  else if (score >= 6) level = "high";
  else if (score >= 3) level = "medium";

  return { level, score, factors: factors.map((f) => f.reason) };
}

function edgesOut(edges, nodeId) {
  return edges.filter((e) => e.source === nodeId);
}

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Impact / Dependency Analysis (brief Section 6 + 9).
//
// AUDIT FINDING: processGraph.js#buildImpactGraph(processId) (A6.3.1/2)
// only works for a processId already in the STATIC processRegistry.js
// catalog — it cannot analyze a brand-new, admin-authored ProcessDefinition
// that has no registry entry. Rather than duplicating that graph-building
// logic, this module reuses the registry's own real cross-reference data
// (triggerEvents, assignmentUsage, monitoringUsage) to answer the same
// question ("what does this new process touch?") for a definition that
// only exists as nodes/edges. Nothing here invents a percentage, a count,
// or an affected-user number the brief's Section 9 explicitly forbids —
// where a number can't be derived from real data it says so.
// ─────────────────────────────────────────────────────────────────────────

import { listProcessDefinitions } from "../process/processRegistry.js";
import { listActionDefinitions } from "../automation-studio/actionLibrary.js";

const ROLE_BY_ACTION_TYPE = Object.freeze({
  notify_role: "config-specified role",
  notify_admins: "admin, super_admin",
  notify_user: "the specific user in the trigger payload",
  reminder_note: "the specific user in the trigger payload",
});

export function analyzeProcessImpact({ nodes = [] } = {}) {
  const triggerTypes = nodes.filter((n) => n.type === "trigger").map((n) => n.config?.triggerType).filter(Boolean);
  const actionTypes = nodes.map((n) => n.config?.actionType).filter(Boolean);
  const registry = listProcessDefinitions();

  const affectedProcesses = registry.filter((proc) => (proc.triggerEvents || []).some((t) => triggerTypes.includes(t)));
  const usesAssignment = nodes.some((n) => n.type === "assignment");
  const usesIntegration = nodes.some((n) => n.type === "integration");
  const usesApproval = nodes.some((n) => n.type === "approval");
  const usesAI = actionTypes.includes("ai_insight");

  const affectedRoles = new Set();
  for (const node of nodes) {
    if (node.type === "notification") {
      const role = ROLE_BY_ACTION_TYPE[node.config?.actionType];
      if (role) affectedRoles.add(role);
    }
    if (node.type === "approval" || node.type === "assignment") affectedRoles.add("admin (Operations Queue)");
  }

  const knownActionTypes = new Set(listActionDefinitions().map((a) => a.type));
  const unrecognizedActionTypes = actionTypes.filter((t) => !knownActionTypes.has(t));

  return {
    affectedProcesses: affectedProcesses.map((p) => ({ id: p.id, label: p.label, category: p.category })),
    affectedRoles: [...affectedRoles],
    expectedAutomationTouchpoints: {
      workflowEngine: usesApproval,
      assignmentEngine: usesAssignment,
      integrationOutbound: usesIntegration,
      aiPipeline: usesAI,
    },
    unrecognizedActionTypes,
    // Section 9: "If something cannot be calculated from available data,
    // show 'Insufficient historical data' rather than guessing." This
    // process has never run yet at authoring time, so per-run SLA/workload
    // numbers are honestly unavailable until the Monitoring Platform has
    // real AutomationRunLog rows for it (available from the Version
    // History / run-history endpoint once published).
    expectedNotifications: "Insufficient historical data — no runs recorded yet for this version.",
    expectedWorkloadImpact: "Insufficient historical data — no runs recorded yet for this version.",
    slaImpact: usesApproval || usesAssignment
      ? "This process feeds real Operation Registry items and will be subject to the same SLA targets as the existing Workflow Engine (see /admin/workflow-engine)."
      : "Not applicable — this process does not touch the Operation Registry.",
  };
}

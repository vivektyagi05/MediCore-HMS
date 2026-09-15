// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.1 — Enterprise Process Registry & Orchestration Core.
// Process Orchestration Engine (mission Part 2).
//
// STOP CONDITION: "It NEVER executes work. It coordinates work." This
// module contains zero writes and zero calls into workflowEngine,
// automationEventBus, assignmentEngine, or monitoringController. It only
// READS the Process Registry, the real State Machine (workflowStateMachine.
// js), the real Policy Engine (policies.js), and the real trigger fan-out
// (monitoringAggregates.buildDependencyFanout, A6.2.4 — reused, never
// recomputed) to produce a PLAN describing who calls whom, when, why,
// ordering, approval gates, parallel vs sequential execution, timeouts, and
// rollback/retry support. Execution itself continues to happen exactly
// where it already does: workflowEngine.executeWorkflowTransition (A6.2.1),
// automationEventBus (A6.2.3), assignmentEngine (A6.2.2), the AI pipeline.
// ─────────────────────────────────────────────────────────────────────────

import { getProcessDefinition, isKnownProcess } from "./processRegistry.js";
import { getLifecycleGraph, listAllowedActions } from "../workflow/workflowStateMachine.js";
import { SLA_TARGET_MS, computeSla } from "../workflow/policies.js";
import { buildDependencyFanout } from "../monitoring/monitoringAggregates.js";

const WORKFLOW_TYPE_IDS = new Set([
  "doctor_verification",
  "refund_request",
  "insurance_claim",
  "critical_report",
  "payment_failure",
  "webhook_failure",
  "automation_failure",
  "delayed_appointment",
  "emergency_patient",
  "unread_executive_alert",
]);

// A process "has an approval gate" if its own documented business/validation
// rules mention approval/resolve, OR it is one of the real lifecycle-status
// workflow types (whose RESOLVE action literally IS the approval decision).
function hasApprovalGate(proc) {
  if (WORKFLOW_TYPE_IDS.has(proc.id)) return true;
  return [...(proc.businessRules || []), ...(proc.validationRules || [])].some((rule) => /approv/i.test(rule));
}

// Execution mode is read from real structure, never guessed: a process with
// more than one dependency that itself has no dependency on the other is
// candidate for parallel prerequisite resolution; a process whose only
// dependency chain is linear is sequential.
function inferExecutionMode(proc, allProcesses) {
  if (proc.status === "composite") return "not_applicable";
  const deps = proc.dependencies || [];
  if (deps.length <= 1) return "sequential";
  const depsHaveInterDependency = deps.some((depId) => {
    const dep = allProcesses[depId];
    return dep && (dep.dependencies || []).some((d2) => deps.includes(d2));
  });
  return depsHaveInterDependency ? "sequential" : "parallel_prerequisites";
}

/**
 * Builds a read-only coordination plan for one process. Never executes
 * anything — returns the plan for the real engines (workflowEngine,
 * automationEventBus, assignmentEngine) to carry out exactly as they
 * already do today.
 */
export async function getOrchestrationPlan(processId) {
  if (!isKnownProcess(processId)) return null;
  const proc = getProcessDefinition(processId);
  if (proc.status === "composite") {
    return {
      processId,
      executable: false,
      note: "Composite entries have no execution plan of their own — see the real plan for each of its childProcesses/dependencies instead.",
      dependencies: proc.dependencies,
    };
  }

  const allByIdArr = await Promise.all(proc.dependencies.map((id) => getProcessDefinition(id)));
  const allById = Object.fromEntries(allByIdArr.filter(Boolean).map((p) => [p.id, p]));

  const plan = {
    processId,
    executable: true,
    prerequisites: proc.dependencies,
    executionMode: inferExecutionMode(proc, allById),
    approvalGate: hasApprovalGate(proc),
    rollbackSupport: proc.rollbackSupport,
    retrySupport: proc.retrySupport,
    timeoutPolicy: null,
    lifecycleGraph: null,
    downstreamAutomation: [],
  };

  if (WORKFLOW_TYPE_IDS.has(processId)) {
    plan.lifecycleGraph = getLifecycleGraph();
    plan.allowedActionsByStatus = Object.fromEntries(
      ["open", "claimed", "assigned", "escalated", "resolved", "cancelled"].map((s) => [s, listAllowedActions(s)]),
    );
    // Timeout policy: reuse the real SLA target for the process's typical
    // priority. Every workflow type's priority varies by item, so this
    // reports the full SLA_TARGET_MS table rather than picking one — the
    // real per-item value is computeSla(createdAt, priority) at read time.
    plan.timeoutPolicy = { slaTargetsMs: SLA_TARGET_MS, sample: computeSla(new Date(), "medium", null) };
  }

  if (proc.triggerEvents?.length) {
    const fanout = await buildDependencyFanout();
    plan.downstreamAutomation = fanout.filter((f) => proc.triggerEvents.includes(f.triggerType));
  }

  return plan;
}

/**
 * General, honestly-derived orchestration rules — a documentation view
 * (not a new capability) built by walking the real dependency edges every
 * process already declares in the registry. This is what mission Part 2
 * calls "who calls whom / when / why / ordering" as text an admin (or the
 * AI orchestrationAdvisor) can read.
 */
export function describeOrchestrationRule(proc) {
  if (!proc.dependencies?.length) {
    return `${proc.label} has no upstream prerequisites in this registry — it can run independently.`;
  }
  const depLabels = proc.dependencies.join(", ");
  const mode = proc.status === "composite" ? "n/a (composite)" : undefined;
  return `${proc.label} depends on: ${depLabels}. Approval gate: ${hasApprovalGate(proc) ? "yes" : "no"}.${mode ? ` Mode: ${mode}` : ""}`;
}

export function listOrchestrationRules(allProcesses) {
  return allProcesses.map((proc) => ({ processId: proc.id, label: proc.label, rule: describeOrchestrationRule(proc) }));
}

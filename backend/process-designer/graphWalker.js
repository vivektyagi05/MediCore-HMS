// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
//
// This is the Process Simulation Engine (brief Section 7) AND the real
// execution path published/active processes run through (brief Section
// 13's "thin adapter/bridge"). Both call walkProcessGraph() with a
// different `dryRun` value — exactly the same posture as
// automation-studio/automationEventBus.js#runFlow, which already proved
// out "one function, two callers, one flag" for AutomationFlow. This file
// does the same thing for a branching graph instead of a flat list.
//
// NEVER a second engine: action-like nodes call
// automation-studio/actionExecutor.js#runActionStep (the exact dispatcher
// Automation Studio's own flows run through); condition/decision nodes
// call automation-studio/conditionEvaluator.js#evaluateConditions/
// evaluateConditionNode. Nothing here re-implements notification delivery,
// AI generation, assignment scoring, or workflow transitions.
// ─────────────────────────────────────────────────────────────────────────

import { runActionStep } from "../automation-studio/actionExecutor.js";
import { evaluateConditionNode, evaluateConditions } from "../automation-studio/conditionEvaluator.js";
import { getTriggerDefinition } from "../automation-studio/triggerRegistry.js";
import { _internal as operationsInternal } from "../controllers/admin/operationsAdminController.js";

const ACTION_LIKE_TYPES = new Set(["action", "approval", "assignment", "notification", "integration"]);

function buildAdjacency(edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
  }
  return outgoing;
}

/**
 * Walks a process graph starting from `startNodeId`, visiting every node
 * reachable via the branch each condition/decision node resolves to.
 * Returns { status, nodeTrace, stepResults } — nodeTrace covers EVERY
 * visited node (brief Section 7's PASS/SKIPPED/BLOCKED/WARNING/FAIL/
 * UNSUPPORTED states); stepResults is the subset from action-like nodes,
 * kept in the same shape AutomationRunLog.stepResults already uses so the
 * Monitoring Platform's existing viewers need no special-casing.
 */
export async function walkProcessGraph(definition, context, { dryRun = true, startNodeId = null } = {}) {
  const nodes = definition.nodes || [];
  const edges = definition.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = buildAdjacency(edges);

  const startNodes = startNodeId
    ? [byId.get(startNodeId)].filter(Boolean)
    : nodes.filter((n) => n.type === "trigger");

  const nodeTrace = [];
  const stepResults = [];
  const visited = new Set();
  let overallStatus = "success"; // success | failed | blocked

  async function visit(node) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    const startedAt = Date.now();

    if (node.type === "trigger") {
      nodeTrace.push({ nodeId: node.id, nodeType: node.type, status: "pass", message: `Trigger: ${getTriggerDefinition(node.config?.triggerType)?.label || node.config?.triggerType}`, durationMs: 0 });
      for (const edge of outgoing.get(node.id) || []) await visit(byId.get(edge.target));
      return;
    }

    if (node.type === "end") {
      nodeTrace.push({ nodeId: node.id, nodeType: node.type, status: "pass", message: "End of process.", durationMs: 0 });
      return;
    }

    if (node.type === "delay") {
      nodeTrace.push({ nodeId: node.id, nodeType: node.type, status: "unsupported", message: "Delay/Wait is unavailable — no scheduler exists. Skipped without waiting.", durationMs: 0 });
      for (const edge of outgoing.get(node.id) || []) await visit(byId.get(edge.target));
      return;
    }

    if (node.type === "condition" || node.type === "decision") {
      const conditionTree = node.config?.conditionTree || node.config?.conditions || null;
      const { matched, trace } = evaluateConditions(conditionTree, context);
      const out = outgoing.get(node.id) || [];
      const trueEdges = out.filter((e) => e.branch === "true" || (!e.branch && out.length === 1));
      const falseEdges = out.filter((e) => e.branch === "false");
      const nextEdges = matched ? trueEdges : falseEdges;

      nodeTrace.push({
        nodeId: node.id,
        nodeType: node.type,
        status: matched ? "pass" : nextEdges.length ? "pass" : "blocked",
        message: `Condition ${matched ? "matched" : "did not match"}${trace.length ? ` (${trace.map((t) => `${t.field} ${t.operator} ${t.value}: ${t.result}`).join("; ")})` : " (no rules configured — always true)"}.`,
        durationMs: Date.now() - startedAt,
      });

      if (!nextEdges.length) {
        if (!matched) overallStatus = overallStatus === "success" ? "blocked" : overallStatus;
        return; // no path forward on this branch — a legitimate structural gate, not a failure
      }
      for (const edge of nextEdges) await visit(byId.get(edge.target));
      return;
    }

    if (ACTION_LIKE_TYPES.has(node.type)) {
      const step = { id: node.id, type: node.config?.actionType, config: node.config || {} };
      const outcome = await runActionStep(step, context, { dryRun });
      const status = outcome.skipped ? "skipped" : outcome.ok ? "pass" : "fail";
      if (status === "fail") overallStatus = "failed";
      nodeTrace.push({ nodeId: node.id, nodeType: node.type, status, message: outcome.message, durationMs: outcome.durationMs });
      stepResults.push({ actionId: node.id, actionType: node.config?.actionType, ok: outcome.ok, skipped: outcome.skipped, message: outcome.message, durationMs: outcome.durationMs });
      for (const edge of outgoing.get(node.id) || []) await visit(byId.get(edge.target));
      return;
    }

    nodeTrace.push({ nodeId: node.id, nodeType: node.type, status: "unsupported", message: `Unknown node type "${node.type}".`, durationMs: 0 });
  }

  for (const start of startNodes) await visit(start);

  return { status: overallStatus, nodeTrace, stepResults };
}

/**
 * Builds the same context shape AutomationFlow's runtime already uses
 * (automationEventBus.js#runFlow) so actionExecutor.js needs zero
 * special-casing between the two callers.
 */
export function buildProcessContext(definition, payload = {}) {
  return {
    ...payload,
    payload,
    triggerType: payload.triggerType,
    triggerLabel: payload.triggerType ? getTriggerDefinition(payload.triggerType)?.label : undefined,
    flowId: definition._id || definition.id,
    flowName: definition.name,
    processName: definition.name,
    sourceId: payload?.sourceId || payload?.appointmentId || payload?.refundRequestId || payload?.insuranceId || payload?.reportId || payload?.paymentId || payload?.doctorId || payload?.userId,
    internal: operationsInternal,
  };
}

export { evaluateConditionNode };

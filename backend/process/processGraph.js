// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.1/A6.3.2 — Enterprise Process Registry & Orchestration Core +
// Cross-System Integration Hub.
// Process Graph (mission Part 5): "Automatically generate ... Everything
// generated from real Process Registry." Every function below is a pure
// derivation over PROCESS_DEFINITIONS + the real orchestration/integration/
// health modules — nothing here is hand-authored graph data.
// ─────────────────────────────────────────────────────────────────────────

import { listProcessDefinitions, getProcessDefinition } from "./processRegistry.js";
import { getOrchestrationPlan } from "./orchestrationEngine.js";
import { discoverIntegrationEdges, buildIntegrationHealth } from "./integrationHub.js";
import { buildDependencyFanout } from "../monitoring/monitoringAggregates.js";
import { computeAllProcessHealth } from "./processHealth.js";

function nodesFromProcesses(procs) {
  return procs.map((p) => ({ id: p.id, label: p.label, category: p.category, status: p.status }));
}

/** Dependency Graph — every process node + every dependency edge. */
export function buildProcessDependencyGraph() {
  const procs = listProcessDefinitions();
  const edges = procs.flatMap((p) => (p.dependencies || []).map((depId) => ({ from: depId, to: p.id })));
  return { nodes: nodesFromProcesses(procs), edges };
}

/** Dependency Graph with real health scores attached to each node. */
export async function buildProcessDependencyGraphWithHealth() {
  const graph = buildProcessDependencyGraph();
  const health = await computeAllProcessHealth(graph.nodes.map((n) => n.id));
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, health: health[n.id] })) };
}

/** Execution Graph — one process's real orchestration plan, as nodes/edges. */
export async function buildExecutionGraph(processId) {
  const plan = await getOrchestrationPlan(processId);
  if (!plan) return null;
  if (!plan.executable) return { processId, nodes: [], edges: [], note: plan.note };
  const nodes = [processId, ...plan.prerequisites].map((id) => {
    const def = getProcessDefinition(id);
    return { id, label: def?.label || id };
  });
  const edges = plan.prerequisites.map((depId) => ({ from: depId, to: processId, kind: plan.executionMode }));
  return { processId, nodes, edges, executionMode: plan.executionMode, approvalGate: plan.approvalGate };
}

/** Approval Graph — only processes whose orchestration plan has an approval gate. */
export async function buildApprovalGraph() {
  const procs = listProcessDefinitions().filter((p) => p.status !== "composite");
  const plans = await Promise.all(procs.map((p) => getOrchestrationPlan(p.id)));
  const gated = procs.filter((_, i) => plans[i]?.approvalGate);
  const edges = gated.flatMap((p) => (p.dependencies || []).filter((d) => gated.some((g) => g.id === d)).map((d) => ({ from: d, to: p.id })));
  return { nodes: nodesFromProcesses(gated), edges };
}

/** Automation Graph — trigger -> subscribed AutomationFlow edges (A6.2.4's fan-out, reused). */
export async function buildAutomationGraph() {
  const fanout = await buildDependencyFanout();
  const nodes = [];
  const edges = [];
  for (const entry of fanout) {
    nodes.push({ id: `trigger:${entry.triggerType}`, label: entry.triggerLabel, kind: "trigger" });
    for (const flow of entry.subscribedFlows) {
      nodes.push({ id: `flow:${flow.id}`, label: flow.name, kind: "flow" });
      edges.push({ from: `trigger:${entry.triggerType}`, to: `flow:${flow.id}` });
    }
  }
  return { nodes, edges };
}

/** Integration Graph — delegates to the Integration Hub (never recomputed). */
export function buildIntegrationGraph() {
  const edges = discoverIntegrationEdges();
  const procs = listProcessDefinitions();
  const involvedIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  return { nodes: nodesFromProcesses(procs.filter((p) => involvedIds.has(p.id))), edges: edges.map((e) => ({ from: e.from, to: e.to, id: e.id })) };
}

/** Failure Graph — dependency edges restricted to nodes currently unhealthy (real signal). */
export async function buildFailureGraph() {
  const graph = await buildProcessDependencyGraphWithHealth();
  const unhealthyIds = new Set(
    graph.nodes.filter((n) => typeof n.health?.score === "number" && n.health.score < 80).map((n) => n.id),
  );
  const edges = graph.edges.filter((e) => unhealthyIds.has(e.from) || unhealthyIds.has(e.to));
  const nodes = graph.nodes.filter((n) => unhealthyIds.has(n.id));
  return { nodes, edges, note: "Nodes below health score 80 (real, derived — see processHealth.js) and every dependency edge touching them." };
}

/** Impact analysis — everything downstream (and upstream) of one process. */
export function buildImpactGraph(processId) {
  const procs = listProcessDefinitions();
  const byId = Object.fromEntries(procs.map((p) => [p.id, p]));
  const target = byId[processId];
  if (!target) return null;

  const downstream = new Set();
  const queue = [processId];
  while (queue.length) {
    const current = queue.shift();
    for (const p of procs) {
      if ((p.dependencies || []).includes(current) && !downstream.has(p.id)) {
        downstream.add(p.id);
        queue.push(p.id);
      }
    }
  }

  return {
    processId,
    upstream: target.dependencies || [],
    downstream: [...downstream],
    impactedCount: downstream.size,
    note: downstream.size
      ? `${downstream.size} downstream process(es) would be affected if ${target.label} degrades.`
      : "No other process in the registry declares a dependency on this one.",
  };
}

export async function buildAllGraphs() {
  const [dependency, approval, automation, failure] = await Promise.all([
    buildProcessDependencyGraphWithHealth(),
    buildApprovalGraph(),
    buildAutomationGraph(),
    buildFailureGraph(),
  ]);
  return { dependency, approval, automation, integration: buildIntegrationGraph(), failure };
}

export { buildIntegrationHealth };

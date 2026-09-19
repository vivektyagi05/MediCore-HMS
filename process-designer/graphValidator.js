// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Validation Engine (brief Section 5). Server-side, deterministic, pure —
// takes { nodes, edges } and returns { valid, errors, warnings, info }.
// Frontend validation (mirrors these same rules for instant UI feedback)
// is NOT trusted; publish always re-runs this exact function server-side.
// ─────────────────────────────────────────────────────────────────────────

import { checkNodeActionType, UNSUPPORTED_NODE_TYPES } from "./nodeRegistry.js";

const BRANCHING_TYPES = new Set(["condition", "decision"]);

function buildAdjacency(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (outgoing.has(edge.source)) outgoing.get(edge.source).push(edge);
    if (incoming.has(edge.target)) incoming.get(edge.target).push(edge);
  }
  return { byId, outgoing, incoming };
}

/**
 * DFS reachability from every trigger node. A node not reached from any
 * trigger is unreachable/orphaned — the brief's two closely related checks
 * ("orphan node" and "unreachable node") are really the same graph
 * property viewed from two directions (no incoming edge vs. no path from
 * a start node), so they are computed together here to avoid duplicating
 * the traversal.
 */
function computeReachability(nodes, outgoing) {
  const triggerIds = nodes.filter((n) => n.type === "trigger").map((n) => n.id);
  const reached = new Set();
  const stack = [...triggerIds];
  while (stack.length) {
    const current = stack.pop();
    if (reached.has(current)) continue;
    reached.add(current);
    for (const edge of outgoing.get(current) || []) stack.push(edge.target);
  }
  return reached;
}

/** Detects a cycle reachable from any trigger — this graph has no loop
 * construct (no "repeat" node type exists), so any cycle is a design bug,
 * not a supported feature, and must block publish. */
function detectCycle(nodes, outgoing) {
  const state = new Map(); // 0 = unvisited, 1 = visiting, 2 = done
  const path = [];
  let cyclePath = null;

  function visit(id) {
    if (cyclePath) return;
    const s = state.get(id) || 0;
    if (s === 2) return;
    if (s === 1) {
      cyclePath = [...path, id];
      return;
    }
    state.set(id, 1);
    path.push(id);
    for (const edge of outgoing.get(id) || []) visit(edge.target);
    path.pop();
    state.set(id, 2);
  }

  for (const node of nodes) visit(node.id);
  return cyclePath;
}

export function validateProcessGraph({ nodes = [], edges = [] } = {}) {
  const errors = [];
  const warnings = [];
  const info = [];

  // ── Structural basics ───────────────────────────────────────────────
  const ids = nodes.map((n) => n.id);
  const idSet = new Set();
  for (const id of ids) {
    if (!id) { errors.push("A node is missing an id."); continue; }
    if (idSet.has(id)) errors.push(`Duplicate node ID "${id}".`);
    idSet.add(id);
  }

  if (!nodes.length) {
    errors.push("Process has no nodes.");
    return { valid: false, errors, warnings, info };
  }

  const triggerNodes = nodes.filter((n) => n.type === "trigger");
  const endNodes = nodes.filter((n) => n.type === "end");
  if (!triggerNodes.length) errors.push("Missing trigger — every process must start from at least one Trigger node.");
  if (triggerNodes.length > 1) warnings.push(`Process has ${triggerNodes.length} trigger nodes — each will independently start a run.`);
  if (!endNodes.length) errors.push("Missing end node — every process must have at least one End node.");

  for (const edge of edges) {
    if (!edge.id) errors.push("An edge is missing an id.");
    if (!idSet.has(edge.source)) errors.push(`Edge "${edge.id}" references unknown source node "${edge.source}".`);
    if (!idSet.has(edge.target)) errors.push(`Edge "${edge.id}" references unknown target node "${edge.target}".`);
  }

  const { outgoing, incoming } = buildAdjacency(nodes, edges);

  // ── Per-node semantic checks ─────────────────────────────────────────
  for (const node of nodes) {
    const nodeActionError = checkNodeActionType(node);
    if (nodeActionError) {
      if (node.type === "delay") warnings.push(nodeActionError); // exposed as unsupported, not a hard error, so a draft can still be saved and later fixed
      else errors.push(nodeActionError);
    }

    const out = outgoing.get(node.id) || [];
    const inc = incoming.get(node.id) || [];

    if (node.type !== "trigger" && inc.length === 0) {
      errors.push(`Orphan node "${node.id}" (${node.type}) has no incoming edge and is not a Trigger.`);
    }
    if (node.type !== "end" && out.length === 0) {
      errors.push(`Node "${node.id}" (${node.type}) has no outgoing edge and is not an End node — the process would dead-end there.`);
    }

    if (BRANCHING_TYPES.has(node.type)) {
      const branches = out.map((e) => e.branch);
      const hasTrue = branches.includes("true");
      const hasFalse = branches.includes("false");
      if (node.type === "decision" && (!hasTrue || !hasFalse)) {
        errors.push(`Decision node "${node.id}" must have exactly one "true" edge and one "false" edge (found ${out.length} outgoing edge(s)).`);
      }
      if (node.type === "condition" && out.length > 1 && (!hasTrue || !hasFalse)) {
        warnings.push(`Condition node "${node.id}" has multiple outgoing edges without true/false branch labels — only the first will be used deterministically. Consider a Decision node instead.`);
      }
      if (!node.config?.conditionTree && !node.config?.conditions) {
        info.push(`${node.type === "decision" ? "Decision" : "Condition"} node "${node.id}" has no condition configured — it will always evaluate true.`);
      }
    } else if (out.length > 1) {
      warnings.push(`Node "${node.id}" (${node.type}) has ${out.length} outgoing edges but is not a branching node — only the first edge taken is deterministic. Consider inserting a Decision node.`);
    }
  }

  // ── Graph-wide checks ─────────────────────────────────────────────────
  const reached = computeReachability(nodes, outgoing);
  for (const node of nodes) {
    if (node.type !== "trigger" && !reached.has(node.id)) {
      errors.push(`Unreachable node "${node.id}" (${node.type}) — no path exists from any Trigger node.`);
    }
  }
  if (endNodes.length && !endNodes.some((n) => reached.has(n.id))) {
    errors.push("No End node is reachable from any Trigger — the process would never terminate.");
  }

  const cyclePath = detectCycle(nodes, outgoing);
  if (cyclePath) {
    errors.push(`Circular dependency detected: ${cyclePath.join(" -> ")}. This graph has no loop/repeat node type, so cycles are never supported.`);
  }

  // Missing failure path: a Delay-free process with an integration/webhook
  // or approval node and no distinct branch for a failed outcome is a real,
  // named risk in the brief's own checklist (Section 5). This engine
  // cannot know actionExecutor.js's runtime failure without running it
  // (that's the Simulation Engine's job), but it can flag the structural
  // absence of any alternate path out of a risky node.
  for (const node of nodes) {
    if ((node.type === "integration" || node.type === "approval") && (outgoing.get(node.id) || []).length === 1) {
      info.push(`Node "${node.id}" (${node.type}) has only one outgoing path — if it fails at runtime, the process has no distinct failure branch.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, info };
}

export { UNSUPPORTED_NODE_TYPES };

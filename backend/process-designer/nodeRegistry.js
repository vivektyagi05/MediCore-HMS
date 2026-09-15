// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Node Registry (brief Section 4: "Every designer node must map to an
// actual backend capability... Do NOT invent imaginary action handlers.").
//
// Every entry below was checked against the real dispatcher it claims to
// call:
//   - TRIGGER   -> automation-studio/triggerRegistry.js (14 real, wired
//                  triggers — the exact same list Automation Studio uses).
//   - CONDITION/DECISION -> automation-studio/conditionEvaluator.js
//                  (evaluateConditionNode). A DECISION node is a CONDITION
//                  node that additionally requires a true/false edge pair
//                  (see graphValidator.js) — same evaluator, different
//                  graph-shape requirement, not a second implementation.
//   - ACTION/APPROVAL/ASSIGNMENT/NOTIFICATION/INTEGRATION -> the SAME
//                  automation-studio/actionExecutor.js#runActionStep
//                  dispatcher Automation Studio's own flows already run
//                  through, restricted per node type to the subset of real
//                  action types that make sense for that node's label (see
//                  NODE_ACTION_TYPES below). This is a UI/semantic
//                  narrowing, not a new executor.
//   - DELAY/WAIT -> NO backend capability exists (no scheduler anywhere in
//                  this codebase — see automation-studio/actionExecutor.js's
//                  own audit note on reminder_note, and A6.2.5's same
//                  finding). Per the brief's Section 27 stop condition,
//                  this is exposed but marked unavailable, never faked.
//   - END       -> a pure terminal marker. No execution, no config.
// ─────────────────────────────────────────────────────────────────────────

import { listTriggerDefinitions, getTriggerDefinition, isKnownTrigger } from "../automation-studio/triggerRegistry.js";
import { getActionDefinition } from "../automation-studio/actionLibrary.js";

// Which real actionExecutor.js action types each non-generic node type may
// use. A plain "action" node gets the general-purpose leftovers so every
// real action type in actionLibrary.js is reachable from exactly one node
// type — no action type is orphaned, and none is reachable from two node
// types (which would make the palette ambiguous about which node to drag).
export const NODE_ACTION_TYPES = Object.freeze({
  notification: ["notify_user", "notify_role", "notify_admins", "reminder_note"],
  approval: ["workflow_resolve", "workflow_escalate"],
  assignment: ["assignment_recommend"],
  integration: ["webhook"],
  action: ["activity_log", "feature_toggle", "ai_insight"],
});

export const UNSUPPORTED_NODE_TYPES = Object.freeze({
  delay: "No background scheduler or delayed-execution mechanism exists anywhere in this codebase (see automation-studio/actionExecutor.js's reminder_note audit note and Phase A6.2.5's same finding). A Delay/Wait node cannot be made genuinely working without adding a real job scheduler, which is out of scope for this phase — exposed here as unavailable rather than faked as an immediate no-op.",
});

export function listTriggerNodeOptions() {
  return listTriggerDefinitions();
}

export function listActionNodeOptions(nodeType) {
  const allowed = NODE_ACTION_TYPES[nodeType];
  if (!allowed) return [];
  return allowed.map((type) => getActionDefinition(type)).filter(Boolean);
}

/**
 * Full registry payload for the Designer's node palette — one call gives
 * the frontend every real option for every node type, so it never has to
 * guess or hardcode a list that could drift from the backend.
 */
export function getNodeRegistry() {
  return {
    nodeTypes: [
      { type: "trigger", label: "Trigger", description: "Starts the process when a real platform event fires.", options: listTriggerNodeOptions() },
      { type: "condition", label: "Condition", description: "Evaluates a rule/rule-group against the trigger payload; execution only continues down edges whose branch matches.", options: [] },
      { type: "decision", label: "Decision", description: "Same evaluator as Condition, but requires exactly one true edge and one false edge — used when the graph must explicitly branch two ways.", options: [] },
      { type: "action", label: "Action", description: "A general-purpose real action.", options: listActionNodeOptions("action") },
      { type: "approval", label: "Approval", description: "Approves (resolves) or escalates a real Operation Registry item via the existing Workflow Engine.", options: listActionNodeOptions("approval") },
      { type: "assignment", label: "Assignment", description: "Asks the existing Smart Assignment Engine for its top candidate.", options: listActionNodeOptions("assignment") },
      { type: "notification", label: "Notification", description: "Sends a real in-app notification.", options: listActionNodeOptions("notification") },
      { type: "integration", label: "Integration", description: "Sends a real outbound webhook.", options: listActionNodeOptions("integration") },
      { type: "delay", label: "Delay / Wait", description: "Unavailable — no scheduler exists in this codebase.", options: [], unsupported: true, unsupportedReason: UNSUPPORTED_NODE_TYPES.delay },
      { type: "end", label: "End", description: "Terminal marker. No configuration.", options: [] },
    ],
  };
}

/**
 * Resolves whether a node's configured action type is real and legal for
 * that node's type. Returns null when valid, otherwise a human-readable
 * error string (used directly by graphValidator.js).
 */
export function checkNodeActionType(node) {
  if (node.type === "trigger") {
    const triggerType = node.config?.triggerType;
    if (!triggerType) return `Trigger node "${node.id}" has no triggerType configured.`;
    if (!isKnownTrigger(triggerType)) return `Trigger node "${node.id}" references unknown trigger "${triggerType}".`;
    return null;
  }
  if (node.type === "condition" || node.type === "decision" || node.type === "end") return null;
  if (node.type === "delay") return `Node "${node.id}" uses the unsupported Delay/Wait node type. ${UNSUPPORTED_NODE_TYPES.delay}`;

  const allowed = NODE_ACTION_TYPES[node.type];
  if (!allowed) return `Node "${node.id}" has unsupported node type "${node.type}".`;
  const actionType = node.config?.actionType;
  if (!actionType) return `Node "${node.id}" (${node.type}) has no actionType configured.`;
  if (!allowed.includes(actionType)) return `Node "${node.id}" (${node.type}) references actionType "${actionType}", which is not a real capability for this node type.`;
  if (!getActionDefinition(actionType)) return `Node "${node.id}" references actionType "${actionType}", which does not exist in the Action Library.`;
  return null;
}

export function triggerLabel(triggerType) {
  return getTriggerDefinition(triggerType)?.label || triggerType;
}

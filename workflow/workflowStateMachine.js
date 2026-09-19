// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
// Workflow State Machine (brief Step 4).
//
// AUDIT FINDING: OperationAssignment (A6.1) already declares a `status` enum
// (open/claimed/assigned/escalated/resolved/cancelled), but nothing in
// operationsAdminController.js's upsertOverlay() ever validated that a
// requested action was a legal transition from the item's CURRENT status —
// every claim/release/assign/escalate/resolve/cancel handler unconditionally
// overwrote status. That means, for example, a resolved item could be
// silently "claimed" again with no record of it being reopened. This module
// is the fix: one transition graph, one validator, used by every workflow
// type through the Execution Pipeline (./workflowEngine.js). No controller
// is allowed to set `status` directly anymore.
//
// The graph is intentionally permissive about REOPENING (resolved/cancelled
// -> open via `release`) rather than fully terminal, because A6.1's own
// resolveOperation response already documents that resolving here only
// flags the QUEUE item, not the underlying source record — so correcting a
// premature resolve/cancel is a legitimate, expected action, and locking it
// out would be a regression, not a safety improvement.
// ─────────────────────────────────────────────────────────────────────────

export const WORKFLOW_STATUS = Object.freeze({
  OPEN: "open",
  CLAIMED: "claimed",
  ASSIGNED: "assigned",
  ESCALATED: "escalated",
  RESOLVED: "resolved",
  CANCELLED: "cancelled",
});

export const WORKFLOW_ACTIONS = Object.freeze({
  CLAIM: "claim",
  RELEASE: "release",
  ASSIGN: "assign",
  ESCALATE: "escalate",
  RESOLVE: "resolve",
  CANCEL: "cancel",
  PIN: "pin", // orthogonal to lifecycle status — never appears in the graph below
});

// currentStatus -> action -> nextStatus. Any action/status pair absent here
// is an illegal transition and the Execution Pipeline rejects it.
const TRANSITIONS = {
  [WORKFLOW_STATUS.OPEN]: {
    [WORKFLOW_ACTIONS.CLAIM]: WORKFLOW_STATUS.CLAIMED,
    [WORKFLOW_ACTIONS.ASSIGN]: WORKFLOW_STATUS.ASSIGNED,
    [WORKFLOW_ACTIONS.ESCALATE]: WORKFLOW_STATUS.ESCALATED,
    [WORKFLOW_ACTIONS.RESOLVE]: WORKFLOW_STATUS.RESOLVED,
    [WORKFLOW_ACTIONS.CANCEL]: WORKFLOW_STATUS.CANCELLED,
  },
  [WORKFLOW_STATUS.CLAIMED]: {
    [WORKFLOW_ACTIONS.RELEASE]: WORKFLOW_STATUS.OPEN,
    [WORKFLOW_ACTIONS.ASSIGN]: WORKFLOW_STATUS.ASSIGNED,
    [WORKFLOW_ACTIONS.ESCALATE]: WORKFLOW_STATUS.ESCALATED,
    [WORKFLOW_ACTIONS.RESOLVE]: WORKFLOW_STATUS.RESOLVED,
    [WORKFLOW_ACTIONS.CANCEL]: WORKFLOW_STATUS.CANCELLED,
  },
  [WORKFLOW_STATUS.ASSIGNED]: {
    [WORKFLOW_ACTIONS.RELEASE]: WORKFLOW_STATUS.OPEN,
    [WORKFLOW_ACTIONS.ASSIGN]: WORKFLOW_STATUS.ASSIGNED, // reassign to someone else
    [WORKFLOW_ACTIONS.ESCALATE]: WORKFLOW_STATUS.ESCALATED,
    [WORKFLOW_ACTIONS.RESOLVE]: WORKFLOW_STATUS.RESOLVED,
    [WORKFLOW_ACTIONS.CANCEL]: WORKFLOW_STATUS.CANCELLED,
  },
  [WORKFLOW_STATUS.ESCALATED]: {
    [WORKFLOW_ACTIONS.RELEASE]: WORKFLOW_STATUS.OPEN,
    [WORKFLOW_ACTIONS.ASSIGN]: WORKFLOW_STATUS.ASSIGNED, // reassign after escalation
    [WORKFLOW_ACTIONS.ESCALATE]: WORKFLOW_STATUS.ESCALATED, // re-escalate to someone else
    [WORKFLOW_ACTIONS.RESOLVE]: WORKFLOW_STATUS.RESOLVED,
    [WORKFLOW_ACTIONS.CANCEL]: WORKFLOW_STATUS.CANCELLED,
  },
  [WORKFLOW_STATUS.RESOLVED]: {
    [WORKFLOW_ACTIONS.RELEASE]: WORKFLOW_STATUS.OPEN, // documented reopen path
  },
  [WORKFLOW_STATUS.CANCELLED]: {
    [WORKFLOW_ACTIONS.RELEASE]: WORKFLOW_STATUS.OPEN, // documented reopen path
  },
};

export class WorkflowTransitionError extends Error {
  constructor(currentStatus, action) {
    super(`Cannot perform "${action}" on an operation in status "${currentStatus}".`);
    this.name = "WorkflowTransitionError";
    this.currentStatus = currentStatus;
    this.action = action;
  }
}

/**
 * Validates and resolves a lifecycle transition. `pin` is deliberately
 * exempt — it is a display flag, not a lifecycle state, and is legal from
 * any status.
 * @returns {string} the resulting status
 * @throws {WorkflowTransitionError} if the transition is not legal
 */
export function resolveTransition(currentStatus, action) {
  if (action === WORKFLOW_ACTIONS.PIN) return currentStatus;
  const fromState = TRANSITIONS[currentStatus] || {};
  const nextStatus = fromState[action];
  if (!nextStatus) throw new WorkflowTransitionError(currentStatus, action);
  return nextStatus;
}

export function isTerminalStatus(status) {
  return status === WORKFLOW_STATUS.RESOLVED || status === WORKFLOW_STATUS.CANCELLED;
}

export function listAllowedActions(currentStatus) {
  return Object.keys(TRANSITIONS[currentStatus] || {}).concat(WORKFLOW_ACTIONS.PIN);
}

// Phase UI-11, Part C — State Machine Visualization. For ONE given status,
// returns every real WORKFLOW_ACTIONS entry that is NOT currently legal
// (excluding `pin`, which is orthogonal to lifecycle status), each paired
// with the exact WorkflowTransitionError message resolveTransition() would
// throw for that action — so a UI showing "why is this blocked" can never
// drift from what the API actually enforces. Lives here (not in a
// controller) because it depends only on this module's own graph.
export function getBlockedTransitions(currentStatus) {
  const allowed = new Set(listAllowedActions(currentStatus));
  return Object.values(WORKFLOW_ACTIONS)
    .filter((action) => action !== WORKFLOW_ACTIONS.PIN && !allowed.has(action))
    .map((action) => {
      try {
        resolveTransition(currentStatus, action);
        return null; // unreachable — allowed already excludes these
      } catch (transitionError) {
        return { action, reason: transitionError.message };
      }
    })
    .filter(Boolean);
}

// Full lifecycle description for the frontend's Lifecycle Viewer (brief
// Step 9) — a plain, serializable graph, not tied to any single workflow
// type (every type in the registry shares this one lifecycle).
export function getLifecycleGraph() {
  return {
    states: Object.values(WORKFLOW_STATUS),
    actions: Object.values(WORKFLOW_ACTIONS),
    transitions: Object.entries(TRANSITIONS).map(([from, actions]) => ({
      from,
      edges: Object.entries(actions).map(([action, to]) => ({ action, to })),
    })),
  };
}

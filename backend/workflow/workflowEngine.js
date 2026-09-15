// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
// Execution Pipeline (brief Step 8) + Business Rule Engine (brief Step 5).
//
// AUDIT FINDING: A6.1's claimOperation/releaseOperation/assignOperation/
// escalateOperation/resolveOperation/cancelOperation/pinOperation were seven
// near-identical handlers, each: (a) re-implementing the same "look up the
// target user and check they're an admin" check inline (assign + escalate),
// (b) calling upsertOverlay() directly with no transition validation at all
// (see workflowStateMachine.js's audit note), and (c) never emitting any
// notification on assign/escalate (see workflowEvents.js's audit note).
// This module is the fix: ONE function, executeWorkflowTransition(), that
// every one of those seven route handlers now calls through. The route
// handlers in operationsAdminController.js are unchanged in shape (same
// endpoints, same request/response contract) — they now delegate instead of
// duplicating.
//
// Pipeline order (every transition, no shortcuts):
//   1. Validation            — known workflow type, known action
//   2. Permission Check       — already enforced by requirePermission() at
//                               the route layer; this stage additionally
//                               validates the ACTION's target user (assign/
//                               escalate), which is data validation route
//                               middleware cannot express
//   3. Business Rules         — target-user eligibility (Policy Engine)
//   4. State Machine          — resolveTransition() (workflowStateMachine.js)
//   5. Persistence            — upsert the OperationAssignment overlay
//   6. Event Bus              — one workflow:* event (workflowEvents.js),
//                               which itself fans out to Notification +
//                               Realtime (steps 7 & 8 of the brief) without
//                               this module needing to know about either
//   7. Audit Log              — AdminActivityLog (existing writeAdminLog)
//   8. Result                 — the updated overlay + resolved SLA
// ─────────────────────────────────────────────────────────────────────────

import OperationAssignment from "../models/OperationAssignment.js";
import User from "../models/User.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { writeAdminLog } from "../utils/adminAudit.js";
import { isKnownWorkflowType } from "./workflowRegistry.js";
import { WORKFLOW_ACTIONS, resolveTransition, WorkflowTransitionError } from "./workflowStateMachine.js";
import { AssignmentPolicy, EscalationPolicy, computeSla } from "./policies.js";
import { WORKFLOW_EVENTS, emitWorkflowEvent } from "./workflowEvents.js";

const ACTION_TO_AUDIT = {
  [WORKFLOW_ACTIONS.CLAIM]: "operations.claim",
  [WORKFLOW_ACTIONS.RELEASE]: "operations.release",
  [WORKFLOW_ACTIONS.ASSIGN]: "operations.assign",
  [WORKFLOW_ACTIONS.ESCALATE]: "operations.escalate",
  [WORKFLOW_ACTIONS.RESOLVE]: "operations.resolve",
  [WORKFLOW_ACTIONS.CANCEL]: "operations.cancel",
  [WORKFLOW_ACTIONS.PIN]: "operations.pin",
};

const ACTION_TO_EVENT = {
  [WORKFLOW_ACTIONS.CLAIM]: WORKFLOW_EVENTS.CLAIMED,
  [WORKFLOW_ACTIONS.RELEASE]: WORKFLOW_EVENTS.RELEASED,
  [WORKFLOW_ACTIONS.ASSIGN]: WORKFLOW_EVENTS.ASSIGNED,
  [WORKFLOW_ACTIONS.ESCALATE]: WORKFLOW_EVENTS.ESCALATED,
  [WORKFLOW_ACTIONS.RESOLVE]: WORKFLOW_EVENTS.RESOLVED,
  [WORKFLOW_ACTIONS.CANCEL]: WORKFLOW_EVENTS.CANCELLED,
};

async function assertEligibleTarget(userId, policy) {
  if (!userId) throw new AppError("userId is required", 400);
  const target = await User.findById(userId).select("role name").lean();
  const eligible = target && (policy === "assign" ? AssignmentPolicy.isEligibleAssignee(target.role) : EscalationPolicy.isEligibleEscalationTarget(target.role));
  if (!eligible) throw new AppError("Target user must be an admin or super admin", 400);
  return target;
}

/**
 * The single Execution Pipeline every workflow lifecycle action runs
 * through. `item` is the already-resolved OperationItem (from
 * operationsAdminController's Operation Registry read) — this pipeline
 * never re-derives source data, it only manages the assignment/lifecycle
 * overlay on top of it.
 */
export async function executeWorkflowTransition({ req, item, action, targetUserId, note, pinned }) {
  // 1. Validation
  if (!isKnownWorkflowType(item.type)) {
    throw new AppError(`Unknown workflow type "${item.type}"`, 400);
  }
  if (!Object.values(WORKFLOW_ACTIONS).includes(action)) {
    throw new AppError(`Unknown workflow action "${action}"`, 400);
  }

  // 2 & 3. Permission check (route-level) + Business Rules (target eligibility)
  let target = null;
  if (action === WORKFLOW_ACTIONS.ASSIGN) {
    target = await assertEligibleTarget(targetUserId, "assign");
  } else if (action === WORKFLOW_ACTIONS.ESCALATE) {
    target = await assertEligibleTarget(targetUserId, "escalate");
  }

  // 4. State Machine
  let nextStatus;
  try {
    nextStatus = resolveTransition(item.status, action);
  } catch (err) {
    if (err instanceof WorkflowTransitionError) throw new AppError(err.message, 409);
    throw err;
  }

  // 5. Persistence — same overlay shape OperationAssignment already used;
  // only the value assembly is now centralized instead of duplicated per
  // action handler.
  const patch = { status: nextStatus };
  const timelineEntry = { action, actorId: req.user._id, at: new Date() };

  if (action === WORKFLOW_ACTIONS.CLAIM) {
    patch.assignedTo = req.user._id;
  } else if (action === WORKFLOW_ACTIONS.RELEASE) {
    patch.assignedTo = null;
  } else if (action === WORKFLOW_ACTIONS.ASSIGN) {
    patch.assignedTo = targetUserId;
    // Phase A6.2.2: an optional `note` on assign now carries the Assignment
    // Engine's own transparent reason (e.g. "lowest workload, refund
    // history") when the caller is the scoring/auto-assign path rather than
    // a manual admin pick — additive, backward compatible (manual assign
    // never passes a note today, so the message is unchanged for it).
    timelineEntry.note = note ? `Assigned to ${target.name} — ${note}` : `Assigned to ${target.name}`;
    timelineEntry.targetUserId = targetUserId; // see OperationAssignment.js audit note on the timeline sub-schema
  } else if (action === WORKFLOW_ACTIONS.ESCALATE) {
    patch.escalatedTo = targetUserId;
    timelineEntry.note = note || `Escalated to ${target.name}`;
    timelineEntry.targetUserId = targetUserId;
  } else if (action === WORKFLOW_ACTIONS.RESOLVE) {
    patch.resolvedAt = new Date();
    patch.resolvedBy = req.user._id;
    patch.resolutionNote = note || "";
    timelineEntry.note = note;
  } else if (action === WORKFLOW_ACTIONS.CANCEL) {
    patch.resolvedAt = new Date();
    patch.resolvedBy = req.user._id;
    patch.resolutionNote = note || "";
    timelineEntry.note = note;
  } else if (action === WORKFLOW_ACTIONS.PIN) {
    patch.pinned = Boolean(pinned);
  }

  const overlay = await OperationAssignment.findOneAndUpdate(
    { operationKey: item.id },
    {
      $set: { type: item.type, ...patch },
      // Phase A6.2.2 audit fix (see OperationAssignment.js's AUDIT FINDING):
      // capture the source's real createdAt/priority exactly once, at
      // first-touch time, so resolved-item analytics remain possible after
      // the source record itself leaves the live queue.
      $setOnInsert: { operationKey: item.id, sourceCreatedAt: item.createdAt, sourcePriority: item.priority },
      ...(action === WORKFLOW_ACTIONS.PIN ? {} : { $push: { timeline: timelineEntry } }),
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  );

  // 6. Event Bus (fans out to Notification + Realtime — see workflowEvents.js)
  // Awaited (not fire-and-forget): the core transition above already
  // succeeded and must not be rolled back over a notification failure, but
  // the caller still deserves to know if the side effect actually happened
  // — see notification.delivered/error on the returned result.
  const event = ACTION_TO_EVENT[action];
  let notification = { delivered: true, error: null };
  if (event) {
    notification = await emitWorkflowEvent(event, {
      operationKey: item.id,
      type: item.type,
      actorId: req.user._id,
      targetUserId,
      note,
      reason: item.reason,
    });
  }

  // 7. Audit Log
  await writeAdminLog({
    req,
    action: ACTION_TO_AUDIT[action],
    resourceType: item.type,
    resourceId: item.sourceId,
    severity: action === WORKFLOW_ACTIONS.ESCALATE ? "warning" : "info",
    metadata: targetUserId ? { targetUserId } : {},
  });

  // 8. Result
  return {
    overlay,
    status: nextStatus,
    sla: computeSla(item.createdAt, item.priority, overlay.resolvedAt),
    notification,
  };
}

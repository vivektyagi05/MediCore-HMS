// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentEvents (brief Step 11 — "No duplicate sockets").
//
// AUDIT FINDING: workflowEvents.js already wires Assign/Claim/Release/
// Escalate/Resolve/Cancel to notificationEmitter + dashboard sync. Reassign
// is not a distinct action in this codebase — a reassignment IS an ASSIGN
// action targeting a different admin, so it already fires WORKFLOW_EVENTS.
// ASSIGNED with no new event needed. "Workload Changed"/"SLA Changed" are
// also already covered: every dashboard that shows workload/SLA numbers
// refetches on the existing generic dashboard:sync ping rather than reading
// a diff payload (the same pattern every other realtime surface in this
// codebase uses), so a distinct event name for them would be unused
// plumbing. What's genuinely new here is the Assignment Engine acting
// WITHOUT a human in the loop (the sweep) and conflict detection surfacing
// something no human asked about — those two get their own events because
// no existing event covers "the system decided this on its own."
//
// Reuses the SAME EventEmitter instance as workflowEvents.js (imported, not
// re-instantiated) — this file adds event names and listeners to it, it
// never creates a second bus.
// ─────────────────────────────────────────────────────────────────────────

import { notificationEmitter } from "../../realtime/notificationEmitter.js";
import { roomManager } from "../../socket/roomManager.js";
import { workflowEventBus } from "../workflowEvents.js";

export const ASSIGNMENT_EVENTS = Object.freeze({
  AUTO_ASSIGNED: "assignment:auto_assigned",
  AUTO_ESCALATED: "assignment:auto_escalated",
  CONFLICT_DETECTED: "assignment:conflict_detected",
  SWEEP_COMPLETED: "assignment:sweep_completed",
});

function pingAdminDashboard(payload) {
  notificationEmitter.emitDashboardSync(roomManager.adminRoom(), payload);
}

// AUDIT FINDING: this used to also call notificationEmitter.emitToUser()
// with type "assignment_auto_assigned" -- but assignmentScheduler.js's
// autoAssignUnassigned() already runs the assignment through
// executeWorkflowTransition(), whose own WORKFLOW_EVENTS.ASSIGNED listener
// (workflowEvents.js) already sends a "you've been assigned" notification
// carrying this exact `reason` string via the `note` field. The listener
// below was therefore sending a second, fully redundant notification for
// the same single assignment. Removed -- only the dashboard-sync ping
// (which nothing else triggers for auto-assign) remains here.
workflowEventBus.on(ASSIGNMENT_EVENTS.AUTO_ASSIGNED, () => {
  pingAdminDashboard({ type: "assignment_engine_updated" });
});

workflowEventBus.on(ASSIGNMENT_EVENTS.AUTO_ESCALATED, () => {
  pingAdminDashboard({ type: "assignment_engine_updated" });
});

workflowEventBus.on(ASSIGNMENT_EVENTS.CONFLICT_DETECTED, () => {
  pingAdminDashboard({ type: "assignment_conflict_detected" });
});

workflowEventBus.on(ASSIGNMENT_EVENTS.SWEEP_COMPLETED, () => {
  pingAdminDashboard({ type: "assignment_sweep_completed" });
});

export function emitAutoAssigned(payload) {
  workflowEventBus.emit(ASSIGNMENT_EVENTS.AUTO_ASSIGNED, payload);
}

export function emitConflictsDetected(payload) {
  workflowEventBus.emit(ASSIGNMENT_EVENTS.CONFLICT_DETECTED, payload);
}

export function emitSweepCompleted(payload) {
  workflowEventBus.emit(ASSIGNMENT_EVENTS.SWEEP_COMPLETED, payload);
}

export const AssignmentEvents = Object.freeze({
  ASSIGNMENT_EVENTS,
  emitAutoAssigned,
  emitConflictsDetected,
  emitSweepCompleted,
});

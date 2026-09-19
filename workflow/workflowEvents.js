// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
// Workflow Event Bus (brief Step 7).
//
// AUDIT FINDING: assignOperation/escalateOperation (A6.1) wrote a timeline
// entry and an AdminActivityLog row, but never notified the admin they were
// assigned/escalated to — that admin would only find out by opening the
// Operations Inbox themselves. This is a real, previously-undocumented gap
// (distinct from A6.1's own explicitly-deferred list). The event bus below
// closes it, using ONLY the existing notificationEmitter (backend/realtime/
// notificationEmitter.js) — no new websocket, no new notification model, no
// new polling loop (brief Step 11: reuse dashboardSyncTick / RealtimeContext
// / notificationEmitter, exactly as done everywhere else in this codebase).
//
// This is a thin, in-process EventEmitter, not a message queue — it exists
// so the Execution Pipeline (./workflowEngine.js) can emit one standard
// event per transition without every workflow type's controller needing to
// know which notification/audit/realtime calls to make. A future workflow
// type (Lab, Pharmacy, ...) gets assignment/escalation notifications for
// free just by running its transitions through the pipeline.
// ─────────────────────────────────────────────────────────────────────────

import { EventEmitter } from "events";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { roomManager } from "../socket/roomManager.js";
import { getWorkflowDefinition } from "./workflowRegistry.js";

export const WORKFLOW_EVENTS = Object.freeze({
  ASSIGNED: "workflow:assigned",
  ESCALATED: "workflow:escalated",
  CLAIMED: "workflow:claimed",
  RELEASED: "workflow:released",
  RESOLVED: "workflow:resolved",
  CANCELLED: "workflow:cancelled",
});

class WorkflowEventBus extends EventEmitter {}
export const workflowEventBus = new WorkflowEventBus();

// ── Awaitable emit (Product Truth Principle) ─────────────────────────────
// AUDIT FINDING: workflowEngine.js called workflowEventBus.emit(event, ...)
// and immediately returned a 200 response. EventEmitter.emit() invokes
// listeners synchronously but does not await async listeners or surface
// their rejections — so when a listener's promise rejected (as every
// ASSIGNED/ESCALATED listener call did while the enum mismatch in bug #3
// was live), that failure became an unhandled promise rejection nobody
// ever saw, while the API told the caller the operation fully succeeded.
// emitWorkflowEvent() awaits every listener and reports the outcome
// instead of hiding it, so the pipeline can build an honest partial-
// success result (core transition vs. notification delivery) rather than
// either crashing the whole request or fabricating success.
export async function emitWorkflowEvent(event, payload) {
  const listeners = workflowEventBus.listeners(event);
  if (listeners.length === 0) return { delivered: true, error: null };

  const results = await Promise.allSettled(listeners.map((listener) => listener(payload)));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    console.error(`[workflowEventBus] listener error for "${event}":`, failure.reason);
    return { delivered: false, error: failure.reason?.message || "Notification delivery failed" };
  }
  return { delivered: true, error: null };
}

// ── Standard listeners (registered once, at module load) ────────────────

workflowEventBus.on(WORKFLOW_EVENTS.ASSIGNED, async ({ operationKey, type, targetUserId, actorId, note, reason }) => {
  if (!targetUserId) return;
  const def = getWorkflowDefinition(type);
  await notificationEmitter.emitToUser(targetUserId, {
    actorId,
    type: "workflow_assigned",
    title: `${def?.label || "Operation"} assigned to you`,
    // Phase A6.2.2: `note` carries the Assignment Engine's own transparent
    // reason when this assignment came from a recommendation/auto-assign
    // rather than a manual pick — preferred over the generic `reason` when
    // present, so the admin sees WHY they were chosen, not just that they were.
    message: note || reason || `You have been assigned an item in the ${def?.department || "Operations"} queue.`,
    entityType: type,
    entityId: operationKey,
    severity: "info",
  });
});

workflowEventBus.on(WORKFLOW_EVENTS.ESCALATED, async ({ operationKey, type, targetUserId, actorId, note, reason }) => {
  if (!targetUserId) return;
  const def = getWorkflowDefinition(type);
  await notificationEmitter.emitToUser(targetUserId, {
    actorId,
    type: "workflow_escalated",
    title: `${def?.label || "Operation"} escalated to you`,
    message: note || reason || `An item in the ${def?.department || "Operations"} queue was escalated to you.`,
    entityType: type,
    entityId: operationKey,
    severity: "warning",
  });
});

// Resolved/cancelled/claimed/released items don't need a targeted user
// notification (no one is being newly handed work), but every admin's open
// Operations Inbox should still refresh — the existing generic dashboard
// sync ping (already used by every other realtime surface in this
// codebase), never a new socket event name of its own.
function pingAdminDashboard() {
  notificationEmitter.emitDashboardSync(roomManager.adminRoom(), { type: "operations_queue_updated" });
}

workflowEventBus.on(WORKFLOW_EVENTS.RESOLVED, pingAdminDashboard);
workflowEventBus.on(WORKFLOW_EVENTS.CANCELLED, pingAdminDashboard);
workflowEventBus.on(WORKFLOW_EVENTS.CLAIMED, pingAdminDashboard);
workflowEventBus.on(WORKFLOW_EVENTS.RELEASED, pingAdminDashboard);

// Listener errors must never crash a request — log and move on, exactly the
// posture the rest of this codebase's fire-and-forget notification calls
// already take.
workflowEventBus.on("error", (err) => {
  console.error("[workflowEventBus] listener error:", err);
});

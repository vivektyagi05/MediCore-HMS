// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentScheduler (brief Steps 4 & 7 — "When new operation arrives,
// system decides. No fake cron. Reuse existing scheduler.").
//
// AUDIT FINDING: operations in this codebase are never created as discrete
// events (no "operation created" hook exists anywhere) — they are derived
// on read from Doctor/RefundRequest/etc. query filters (see
// fetchRawOperations). There is therefore no literal "on arrival" trigger
// point to attach to. What DOES already exist is a real, working on-demand
// scheduler (backend/automation/cronJobs.js + cronRunTracker.js, built in
// Phase A5.2) that every other automation job in this codebase runs
// through. This sweep is registered as one more job in that exact list —
// it is the closest honest equivalent to "on arrival" available (runs every
// time the automation runner is triggered, which is exactly how every other
// job here already gets "scheduled").
//
// Auto-assign only fires for items with NO assignee yet, and never assigns
// past 100% capacity (WorkloadBalancerPolicy.isAssignable) or below a
// minimum confidence score — anything that doesn't clearly qualify is left
// for a human to assign from the Smart Recommendation cards instead of
// being forced. Auto-escalation only fires for items already past their
// SLA deadline and not already escalated — it never invents a new priority
// value, it uses the exact same computeSla() the rest of the codebase does.
// Every action here goes through the SAME executeWorkflowTransition() a
// human admin's click would use — nothing is duplicated for the automated
// path.
// ─────────────────────────────────────────────────────────────────────────

import { _internal } from "../../controllers/admin/operationsAdminController.js";
import { executeWorkflowTransition } from "../workflowEngine.js";
import { WORKFLOW_ACTIONS } from "../workflowStateMachine.js";
import { rankCandidatesForItem } from "./assignmentEngine.js";
import { emitAutoAssigned, emitSweepCompleted } from "./assignmentEvents.js";

// BUGFIX: same class of circular-import ordering issue as
// assignmentEngine.js -- accessed at call time, not destructured at load
// time. See assignmentEngine.js for the full explanation.

// Below this score there is no clearly-best candidate — leaving the item
// for a human to pick from the (still fully visible) recommendation list is
// safer than forcing a low-confidence auto-assign.
export const AUTO_ASSIGN_MIN_SCORE = 55;

// No req.user exists for a scheduler-triggered action — actorId is left
// null (both OperationAssignment.timeline.actorId and AdminActivityLog.
// actorId are optional fields, never required) and every audit/timeline
// entry is explicitly labeled so it is never mistaken for a human action.
const SYSTEM_ACTOR = Object.freeze({
  user: { _id: null },
  ip: "system:assignment-scheduler",
});

async function autoAssignUnassigned(openItems) {
  const unassigned = openItems.filter((i) => i.status === "open" && !i.assignedTo);
  const assigned = [];
  const skipped = [];

  for (const item of unassigned) {
    try {
      const ranked = await rankCandidatesForItem(item);
      const best = ranked.find((r) => r.assignable);
      if (!best || best.score < AUTO_ASSIGN_MIN_SCORE) {
        skipped.push({
          operationKey: item.id,
          reason: !best ? "no candidate under capacity" : `best score ${best.score} below auto-assign threshold`,
        });
        continue;
      }
      const reason = `Auto-assigned by Smart Assignment Engine — ${best.reason}`;
      await executeWorkflowTransition({
        req: SYSTEM_ACTOR,
        item,
        action: WORKFLOW_ACTIONS.ASSIGN,
        targetUserId: best.admin.id,
        note: reason,
      });
      emitAutoAssigned({ operationKey: item.id, type: item.type, targetUserId: best.admin.id, reason });
      assigned.push({ operationKey: item.id, assignedTo: best.admin.name, score: best.score });
    } catch (err) {
      skipped.push({ operationKey: item.id, reason: err.message });
    }
  }
  return { assigned, skipped };
}

async function autoEscalateOverdue(openItems) {
  const overdueUnescalated = openItems.filter((i) => i.sla?.state === "overdue" && i.status !== "escalated");
  const escalated = [];
  const skipped = [];

  for (const item of overdueUnescalated) {
    try {
      const ranked = await rankCandidatesForItem(item);
      // Prefer a super_admin as the escalation target (a genuine
      // supervisor, matching the brief's "Notify Supervisor" language);
      // fall back to the best assignable admin if none is online/eligible.
      const target = ranked.find((r) => r.admin.role === "super_admin" && r.assignable) || ranked.find((r) => r.assignable);
      if (!target) {
        skipped.push({ operationKey: item.id, reason: "no eligible escalation target under capacity" });
        continue;
      }
      const note = `Auto-escalated by Smart Assignment Engine — SLA overdue by ${Math.round(item.sla.elapsedMs / (60 * 60 * 1000)) - Math.round(item.sla.targetMs / (60 * 60 * 1000))}h`;
      await executeWorkflowTransition({
        req: SYSTEM_ACTOR,
        item,
        action: WORKFLOW_ACTIONS.ESCALATE,
        targetUserId: target.admin.id,
        note,
      });
      escalated.push({ operationKey: item.id, escalatedTo: target.admin.name });
    } catch (err) {
      skipped.push({ operationKey: item.id, reason: err.message });
    }
  }
  return { escalated, skipped };
}

/** The one entry point registered into backend/automation/cronJobs.js. */
export async function runSweep() {
  const { items } = await _internal.buildUnifiedQueue({ status: "all" });
  const openItems = items.filter((i) => i.status !== "resolved" && i.status !== "cancelled");

  const [{ assigned, skipped: skippedAssign }, { escalated, skipped: skippedEscalate }] = await Promise.all([
    autoAssignUnassigned(openItems),
    autoEscalateOverdue(openItems),
  ]);

  const summary = {
    autoAssignedCount: assigned.length,
    autoEscalatedCount: escalated.length,
    skippedCount: skippedAssign.length + skippedEscalate.length,
    assigned,
    escalated,
    skipped: [...skippedAssign, ...skippedEscalate],
  };
  emitSweepCompleted(summary);
  return summary;
}

export const AssignmentScheduler = Object.freeze({ runSweep, AUTO_ASSIGN_MIN_SCORE });

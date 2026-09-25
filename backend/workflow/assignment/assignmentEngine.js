// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentEngine (brief Steps 4, 6, 8, 9) — the orchestrator. Every real
// data source (candidate pool, workload, history, presence, capacity) is
// gathered by the other assignment/* modules; this file's only job is to
// combine them into recommendations, never to compute its own numbers.
// ─────────────────────────────────────────────────────────────────────────

import { _internal } from "../../controllers/admin/operationsAdminController.js";
import { AssignmentPolicy as EligibilityPolicy } from "../policies.js";
import { getCapacitySettings, isAssignable } from "./assignmentPolicy.js";
import { getCandidatePool, getPresenceMap, buildWorkloadSnapshots } from "./assignmentRegistry.js";
import { buildHistoryStatsForAdmins } from "./assignmentHistory.js";
import { scoreCandidate, explainScore } from "./assignmentScoring.js";

// BUGFIX: this used to be `const { buildUnifiedQueue, findOperationItem } =
// _internal;` at module top level. operationsAdminController.js is reached
// through more than one import path in this module graph (directly here
// and via assignmentScheduler.js, itself imported by automation/cronJobs.js
// and controllers/admin/assignmentAdminController.js among others); when
// the entry point into the graph is one of THOSE files rather than
// operationsAdminController.js itself, this file's top-level destructuring
// could run before operationsAdminController.js finished evaluating its own
// module body -- `_internal` (its very last export) was still in the
// temporal dead zone, and importing this file crashed outright with
// "Cannot access '_internal' before initialization". Accessing the two
// functions through `_internal.<fn>` at CALL time instead of destructuring
// them at LOAD time defers the property read until every module has
// finished initializing, which is the standard fix for this class of ESM
// circular-import ordering issue.

/**
 * Gathers every real input once and scores every eligible candidate for a
 * single item. Shared by getRecommendations, getReassignmentRecommendation,
 * and the AssignmentScheduler's auto-assign sweep — so all three always
 * agree on who the best candidate is, computed one way.
 */
export async function rankCandidatesForItem(item) {
  const [pool, capacity, { items: unifiedItems }] = await Promise.all([
    getCandidatePool(),
    getCapacitySettings(),
    _internal.buildUnifiedQueue({ status: "all" }),
  ]);

  const eligible = pool.filter((c) => EligibilityPolicy.isEligibleAssignee(c.role));
  const ids = eligible.map((c) => c._id.toString());

  const [presenceMap, historyMap] = await Promise.all([getPresenceMap(ids), buildHistoryStatsForAdmins(ids)]);
  const workloadSnapshots = buildWorkloadSnapshots(eligible, unifiedItems, capacity);
  const workloadByAdmin = new Map(workloadSnapshots.map((s) => [s.admin._id.toString(), s]));

  const maxExperienceInPool = Math.max(
    0,
    ...ids.map((id) => historyMap.get(id)?.resolvedCountByType?.[item.type] || 0),
  );

  const ranked = eligible.map((candidate) => {
    const id = candidate._id.toString();
    const workload = workloadByAdmin.get(id);
    const history = historyMap.get(id);
    const isOnline = presenceMap.get(id)?.isOnline || false;
    const { total, breakdown } = scoreCandidate({ item, workload, history, isOnline, maxExperienceInPool });
    return {
      admin: { id: candidate._id, name: candidate.name, email: candidate.email, role: candidate.role },
      isOnline,
      utilization: workload.utilization,
      assignable: isAssignable(workload.utilization),
      score: total,
      breakdown,
      reason: explainScore(breakdown),
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Step 4/5: transparent ranked candidates for one item. Never auto-assigns — read-only. */
export async function getRecommendations(operationKey, { limit = 5 } = {}) {
  const item = await _internal.findOperationItem(operationKey);
  const ranked = await rankCandidatesForItem(item);
  return { item: { id: item.id, type: item.type, typeLabel: item.typeLabel, priority: item.priority }, candidates: ranked.slice(0, limit) };
}

/**
 * Step 8: Reassignment Engine — recommendation only, admin approves via the
 * existing assign endpoint. Never executes a reassignment itself.
 */
export async function getReassignmentRecommendation(operationKey) {
  const item = await _internal.findOperationItem(operationKey);
  const ranked = await rankCandidatesForItem(item);

  const currentAssigneeId = item.assignedTo?.id?.toString();
  const current = currentAssigneeId ? ranked.find((r) => r.admin.id.toString() === currentAssigneeId) : null;

  const reasons = [];
  if (current) {
    if (!current.assignable) reasons.push("currently over capacity");
    if (!current.isOnline) reasons.push("currently offline");
    if (item.sla?.state === "overdue") reasons.push("item is overdue");
  } else if (currentAssigneeId) {
    reasons.push("current assignee is no longer an eligible admin"); // e.g. role/permission changed after assignment
  }

  const alternates = ranked.filter((r) => r.admin.id.toString() !== currentAssigneeId && r.assignable).slice(0, 3);

  return {
    item: { id: item.id, type: item.type, typeLabel: item.typeLabel },
    current: current ? { ...current, reasonsToReassign: reasons } : currentAssigneeId ? { admin: null, reasonsToReassign: reasons } : null,
    shouldReassign: reasons.length > 0,
    alternates,
  };
}

// ── Step 9: Conflict Detection ──────────────────────────────────────────
export async function detectConflicts() {
  const [{ items }, capacity] = await Promise.all([_internal.buildUnifiedQueue({ status: "all" }), getCapacitySettings()]);
  const openItems = items.filter((i) => i.status !== "resolved" && i.status !== "cancelled");
  const conflicts = [];

  // Circular assignment: an item escalated back to the same admin who was
  // already holding it.
  for (const item of openItems) {
    if (item.status === "escalated" && item.escalatedTo?.id && item.assignedTo?.id && item.escalatedTo.id.toString() === item.assignedTo.id.toString()) {
      conflicts.push({
        type: "circular_assignment",
        severity: "medium",
        operationKey: item.id,
        description: `${item.typeLabel} was escalated back to its own current assignee (${item.assignedTo.name}).`,
      });
    }
  }

  // Multiple critical operations held by one admin — real overload/risk signal.
  const criticalByAdmin = new Map();
  for (const item of openItems) {
    if (item.priority !== "critical" || !item.assignedTo?.id) continue;
    const id = item.assignedTo.id.toString();
    if (!criticalByAdmin.has(id)) criticalByAdmin.set(id, { name: item.assignedTo.name, items: [] });
    criticalByAdmin.get(id).items.push(item.id);
  }
  for (const [, bucket] of criticalByAdmin.entries()) {
    if (bucket.items.length >= 2) {
      conflicts.push({
        type: "multiple_critical",
        severity: "high",
        description: `${bucket.name} is holding ${bucket.items.length} critical-priority items at once.`,
        operationKeys: bucket.items,
      });
    }
  }

  // Operation starvation: open, unassigned, and already past 2x its own SLA target.
  for (const item of openItems) {
    if (item.assignedTo || item.sla?.state !== "overdue") continue;
    if (item.sla.elapsedMs >= item.sla.targetMs * 2) {
      conflicts.push({
        type: "operation_starvation",
        severity: "critical",
        operationKey: item.id,
        description: `${item.typeLabel} has been unassigned for ${Math.round(item.sla.elapsedMs / (60 * 60 * 1000))}h — over 2x its SLA target with no one ever assigned.`,
      });
    }
  }

  // Blocked workflow: stuck in "escalated" for a long time with no resolution.
  for (const item of openItems) {
    if (item.status !== "escalated") continue;
    const lastEscalate = [...(item.timeline || [])].reverse().find((t) => t.action === "escalate");
    if (lastEscalate && Date.now() - new Date(lastEscalate.at).getTime() > 3 * 24 * 60 * 60 * 1000) {
      conflicts.push({
        type: "blocked_workflow",
        severity: "high",
        operationKey: item.id,
        description: `${item.typeLabel} has sat in "escalated" for over 3 days with no further action.`,
      });
    }
  }

  // Dead queue: a department with open work but zero eligible admins online right now.
  const pool = await getCandidatePool();
  const ids = pool.map((c) => c._id.toString());
  const presenceMap = await getPresenceMap(ids);
  const anyOnline = ids.some((id) => presenceMap.get(id)?.isOnline);
  if (!anyOnline) {
    const departmentsWithWork = [...new Set(openItems.map((i) => i.department))];
    for (const department of departmentsWithWork) {
      conflicts.push({
        type: "dead_queue",
        severity: "critical",
        description: `No admin is currently online and the "${department}" queue has open work.`,
        department,
      });
    }
  }

  // Wrong department / permission mismatch: current assignee's role no
  // longer passes eligibility (e.g. demoted after being assigned).
  for (const item of openItems) {
    if (!item.assignedTo?.id) continue;
    const candidate = pool.find((c) => c._id.toString() === item.assignedTo.id.toString());
    if (!candidate || !EligibilityPolicy.isEligibleAssignee(candidate.role)) {
      conflicts.push({
        type: "permission_mismatch",
        severity: "high",
        operationKey: item.id,
        description: `${item.assignedTo.name} is assigned to ${item.typeLabel} but is no longer an eligible admin.`,
      });
    }
  }

  return { conflicts, capacity };
}

export const AssignmentEngine = Object.freeze({
  rankCandidatesForItem,
  getRecommendations,
  getReassignmentRecommendation,
  detectConflicts,
});

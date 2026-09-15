// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentRegistry (brief Step 3 — Workload Intelligence) + candidate pool.
//
// AUDIT FINDING: there is no per-admin "department", "shift", or "expertise
// tag" field anywhere in this codebase — Permission is keyed by ROLE (only
// admin/super_admin exist), not per-user, and User has no admin-specific
// profile fields at all. Rather than invent fields that don't exist (the
// brief's own "never invent data" rule), the candidate pool below is every
// active admin/super_admin, and "expertise" is derived later (see
// assignmentHistory.js) from each admin's REAL resolution history — a
// grounded substitute, not a fabricated label. Real-time online/offline
// status IS available (OnlineSession, already used by Mission Control) and
// is used directly, unmodified.
//
// Workload counts below are computed by filtering the SAME unified-queue
// item list operationsAdminController already builds (passed in by the
// caller) — never a second, duplicate query against Doctor/RefundRequest/
// etc. That is also why this module never imports fetchRawOperations
// itself.
// ─────────────────────────────────────────────────────────────────────────

import User from "../../models/User.js";
import OnlineSession from "../../models/OnlineSession.js";
import { ADMIN_ROLES } from "../../constants/roles.js";
import { computeUtilization } from "./assignmentPolicy.js";
import { isSessionOnline } from "../../socket/presenceQuery.js";

const OPEN_STATUSES = ["open", "claimed", "assigned", "escalated"];

export async function getCandidatePool() {
  return User.find({ role: { $in: ADMIN_ROLES }, isActive: true })
    .select("name email role")
    .lean();
}

// One query for every candidate's presence — never one OnlineSession query
// per candidate (would duplicate the same lookup N times for N admins).
export async function getPresenceMap(candidateIds) {
  const sessions = await OnlineSession.find({ userId: { $in: candidateIds } })
    .sort({ lastActiveAt: -1 })
    .select("userId status lastActiveAt")
    .lean();
  const map = new Map();
  for (const session of sessions) {
    const key = session.userId.toString();
    if (!map.has(key)) map.set(key, { isOnline: isSessionOnline(session), lastActiveAt: session.lastActiveAt });
  }
  return map;
}

/**
 * Builds one real Workload Intelligence snapshot per candidate from the
 * already-fetched unified queue items (see AUDIT FINDING above).
 * @param {Array} candidates - from getCandidatePool()
 * @param {Array} unifiedItems - full item list from operationsAdminController's
 *   buildUnifiedQueue({ status: "all" }) — includes resolved/cancelled too,
 *   filtered out below for "current" workload counts.
 * @param {{maxOpenItemsPerAdmin:number, overloadThresholdPct:number}} capacity
 */
export function buildWorkloadSnapshots(candidates, unifiedItems, capacity) {
  const presenceless = new Map(candidates.map((c) => [c._id.toString(), c]));
  const byAdmin = new Map();
  for (const id of presenceless.keys()) {
    byAdmin.set(id, {
      adminId: id,
      openItems: [],
      pending: 0, // assigned, not yet claimed/worked
      working: 0, // claimed or escalated-and-still-theirs
      critical: 0,
      overdue: 0,
      atRisk: 0,
      resolvedToday: 0,
      queueWeight: 0,
    });
  }

  const PRIORITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  for (const item of unifiedItems) {
    const adminId = item.assignedTo?.id?.toString();
    if (!adminId || !byAdmin.has(adminId)) continue;
    const bucket = byAdmin.get(adminId);

    if (item.status === "resolved" && item.resolvedAt && new Date(item.resolvedAt) >= todayStart) {
      bucket.resolvedToday += 1;
    }
    if (!OPEN_STATUSES.includes(item.status)) continue;

    bucket.openItems.push(item.id);
    if (item.status === "assigned") bucket.pending += 1;
    if (item.status === "claimed" || item.status === "escalated") bucket.working += 1;
    if (item.priority === "critical") bucket.critical += 1;
    if (item.sla?.state === "overdue") bucket.overdue += 1;
    if (item.sla?.state === "at_risk") bucket.atRisk += 1;
    bucket.queueWeight += PRIORITY_WEIGHT[item.priority] || 1;
  }

  const snapshots = [];
  for (const [adminId, bucket] of byAdmin.entries()) {
    const openCount = bucket.openItems.length;
    const utilization = computeUtilization(openCount, capacity);
    snapshots.push({
      admin: presenceless.get(adminId),
      openCount,
      pending: bucket.pending,
      working: bucket.working,
      critical: bucket.critical,
      overdue: bucket.overdue,
      atRisk: bucket.atRisk,
      resolvedToday: bucket.resolvedToday,
      queueWeight: bucket.queueWeight,
      utilization,
    });
  }
  return snapshots;
}

export const AssignmentRegistry = Object.freeze({
  getCandidatePool,
  getPresenceMap,
  buildWorkloadSnapshots,
});

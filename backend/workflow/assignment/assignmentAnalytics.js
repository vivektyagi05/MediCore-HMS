// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentAnalytics (brief Step 10 — "Everything from real data").
//
// AUDIT FINDING: no historical time-series of queue volume exists anywhere
// (there is no daily snapshot job for operations). "Queue Trend" below is
// therefore an honestly-labeled proxy — new OperationAssignment rows
// created per day over the last 14 days — not a true historical queue-size
// series. This is disclosed in the returned payload's own `trendNote`
// field rather than presented as something it isn't.
// ─────────────────────────────────────────────────────────────────────────

import OperationAssignment from "../../models/OperationAssignment.js";
import { _internal } from "../../controllers/admin/operationsAdminController.js";
import { getCapacitySettings } from "./assignmentPolicy.js";
import { getCandidatePool, buildWorkloadSnapshots } from "./assignmentRegistry.js";
import { buildHistoryStatsForAdmins } from "./assignmentHistory.js";

const { buildUnifiedQueue } = _internal;

function average(list) {
  if (!list.length) return null;
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}

export async function buildAssignmentAnalytics() {
  const [pool, capacity, queue] = await Promise.all([
    getCandidatePool(),
    getCapacitySettings(),
    buildUnifiedQueue({ status: "all" }),
  ]);
  const { items, byDepartment } = queue;

  const adminIds = pool.map((c) => c._id.toString());
  const historyMap = await buildHistoryStatsForAdmins(adminIds, { lookbackDays: 90 });
  const workloadSnapshots = buildWorkloadSnapshots(pool, items, capacity);

  const overlays = await OperationAssignment.find({})
    .select("type status createdAt resolvedAt sourceCreatedAt timeline")
    .lean();

  const assignmentTimes = [];
  const acceptanceTimes = [];
  const resolutionTimes = [];
  let reassignedCount = 0;
  let assignedTotal = 0;
  let resolvedTerminal = 0;
  let cancelledTerminal = 0;

  for (const overlay of overlays) {
    const assignEntries = (overlay.timeline || []).filter((t) => t.action === "assign");
    if (assignEntries.length > 0) {
      assignedTotal += 1;
      const distinctTargets = new Set(assignEntries.map((t) => String(t.targetUserId || "")));
      if (distinctTargets.size > 1) reassignedCount += 1;

      if (overlay.sourceCreatedAt) {
        const ms = new Date(assignEntries[0].at).getTime() - new Date(overlay.sourceCreatedAt).getTime();
        if (ms >= 0) assignmentTimes.push(ms);
      }

      const firstAssign = assignEntries[0];
      const nextClaim = (overlay.timeline || []).find(
        (t) => t.action === "claim" && new Date(t.at) >= new Date(firstAssign.at) && String(t.actorId) === String(firstAssign.targetUserId),
      );
      if (nextClaim) {
        const ms = new Date(nextClaim.at).getTime() - new Date(firstAssign.at).getTime();
        if (ms >= 0) acceptanceTimes.push(ms);
      }
    }

    if (overlay.status === "resolved") {
      resolvedTerminal += 1;
      if (overlay.sourceCreatedAt && overlay.resolvedAt) {
        const ms = new Date(overlay.resolvedAt).getTime() - new Date(overlay.sourceCreatedAt).getTime();
        if (ms >= 0) resolutionTimes.push(ms);
      }
    } else if (overlay.status === "cancelled") {
      cancelledTerminal += 1;
    }
  }

  const terminalTotal = resolvedTerminal + cancelledTerminal;

  const topPerformers = pool
    .map((admin) => {
      const h = historyMap.get(admin._id.toString());
      return {
        admin: { id: admin._id, name: admin.name },
        resolvedTotal: h.resolvedTotal,
        slaSuccessRate: h.slaSuccessRate,
        avgResolutionMs: h.avgResolutionMs,
      };
    })
    .filter((p) => p.resolvedTotal > 0)
    .sort((a, b) => b.resolvedTotal - a.resolvedTotal || (b.slaSuccessRate || 0) - (a.slaSuccessRate || 0))
    .slice(0, 10);

  const workloadHeatmap = workloadSnapshots
    .map((s) => ({
      admin: { id: s.admin._id, name: s.admin.name },
      openCount: s.openCount,
      utilizationPct: s.utilization.pct,
      state: s.utilization.state,
    }))
    .sort((a, b) => b.openCount - a.openCount);

  const openItems = items.filter((i) => i.status !== "resolved" && i.status !== "cancelled");
  const operationDistribution = {};
  const slaDistribution = { on_track: 0, at_risk: 0, overdue: 0 };
  for (const item of openItems) {
    operationDistribution[item.type] = (operationDistribution[item.type] || 0) + 1;
    if (item.sla?.state && slaDistribution[item.sla.state] !== undefined) slaDistribution[item.sla.state] += 1;
  }

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recentOverlays = await OperationAssignment.find({ createdAt: { $gte: fourteenDaysAgo } })
    .select("createdAt")
    .lean();
  const trendByDay = {};
  for (const o of recentOverlays) {
    const day = o.createdAt.toISOString().slice(0, 10);
    trendByDay[day] = (trendByDay[day] || 0) + 1;
  }

  return {
    avgAssignmentTimeMs: average(assignmentTimes),
    avgAcceptanceTimeMs: average(acceptanceTimes),
    avgResolutionTimeMs: average(resolutionTimes),
    reassignmentRate: assignedTotal > 0 ? Math.round((reassignedCount / assignedTotal) * 100) : null,
    assignmentSuccessRate: terminalTotal > 0 ? Math.round((resolvedTerminal / terminalTotal) * 100) : null,
    topPerformers,
    workloadHeatmap,
    departmentLoad: byDepartment,
    operationDistribution,
    slaDistribution,
    queueTrend: {
      trendNote:
        "New assignment records tracked per day over the last 14 days — a proxy for new-work volume, not a true historical queue-size series (no daily queue snapshot exists in this codebase).",
      byDay: trendByDay,
    },
  };
}

export const AssignmentAnalytics = Object.freeze({ buildAssignmentAnalytics });

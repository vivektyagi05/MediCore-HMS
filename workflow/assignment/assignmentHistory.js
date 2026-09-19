// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// AssignmentHistory (brief Step 3/5/10 — the real, non-fabricated numbers
// behind "expertise", "historical performance", and Assignment Analytics).
//
// AUDIT FINDING: "Refund Expert", "94% experience", "past performance" in
// the brief's own worked example are exactly the kind of thing this project
// must never hardcode or invent. Every number here comes from a real
// OperationAssignment query — resolution counts, resolution time, SLA
// success, escalation counts, and acceptance time. If an admin has never
// resolved anything of a given type, their "experience" for that type is
// honestly 0, not a made-up baseline.
//
// Batched by design (one pass over the relevant documents, stats for every
// candidate at once) — never one query per candidate, which would duplicate
// the same collection scan N times when scoring N candidates for one item.
// ─────────────────────────────────────────────────────────────────────────

import OperationAssignment from "../../models/OperationAssignment.js";
import { computeSla } from "../policies.js";

const DEFAULT_LOOKBACK_DAYS = 30;

function emptyStats() {
  return {
    resolvedCountByType: {},
    resolvedTotal: 0,
    avgResolutionMs: null,
    slaSuccessRate: null, // null = no resolved history to judge by, not 0%
    recentEscalationsReceived: 0,
    recentEscalationsMade: 0,
    avgAcceptanceMs: null,
    claimsCount: 0,
  };
}

/**
 * @param {string[]} adminIds
 * @param {{lookbackDays?:number}} options
 * @returns {Promise<Map<string, ReturnType<typeof emptyStats>>>}
 */
export async function buildHistoryStatsForAdmins(adminIds, { lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const idSet = new Set(adminIds.map(String));
  const statsByAdmin = new Map(adminIds.map((id) => [String(id), emptyStats()]));
  if (idSet.size === 0) return statsByAdmin;

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // All-time resolution history (experience must reflect a full career, not
  // just a 30-day window). ──────────────────────────────────────────────
  const resolvedDocs = await OperationAssignment.find({
    resolvedBy: { $in: adminIds },
    resolvedAt: { $ne: null },
  })
    .select("resolvedBy resolvedAt sourceCreatedAt sourcePriority type timeline")
    .lean();

  const resolutionMsByAdmin = new Map();
  const slaByAdmin = new Map(); // { success, total }
  const acceptanceMsByAdmin = new Map();

  for (const doc of resolvedDocs) {
    const adminId = String(doc.resolvedBy);
    if (!idSet.has(adminId)) continue;
    const stats = statsByAdmin.get(adminId);
    stats.resolvedTotal += 1;
    stats.resolvedCountByType[doc.type] = (stats.resolvedCountByType[doc.type] || 0) + 1;

    if (doc.sourceCreatedAt) {
      const resolutionMs = new Date(doc.resolvedAt).getTime() - new Date(doc.sourceCreatedAt).getTime();
      if (resolutionMs >= 0) {
        if (!resolutionMsByAdmin.has(adminId)) resolutionMsByAdmin.set(adminId, []);
        resolutionMsByAdmin.get(adminId).push(resolutionMs);
      }
      if (doc.sourcePriority) {
        const sla = computeSla(doc.sourceCreatedAt, doc.sourcePriority, doc.resolvedAt);
        if (!slaByAdmin.has(adminId)) slaByAdmin.set(adminId, { success: 0, total: 0 });
        const bucket = slaByAdmin.get(adminId);
        bucket.total += 1;
        if (sla.state !== "overdue") bucket.success += 1;
      }
    }

    // Acceptance time: last "assign" entry targeting this admin -> their own
    // next "claim" entry on the same item.
    const assignEntry = [...(doc.timeline || [])]
      .reverse()
      .find((entry) => entry.action === "assign" && String(entry.targetUserId) === adminId);
    const claimEntry = (doc.timeline || []).find(
      (entry) => entry.action === "claim" && String(entry.actorId) === adminId,
    );
    if (assignEntry && claimEntry && new Date(claimEntry.at) >= new Date(assignEntry.at)) {
      const ms = new Date(claimEntry.at).getTime() - new Date(assignEntry.at).getTime();
      if (!acceptanceMsByAdmin.has(adminId)) acceptanceMsByAdmin.set(adminId, []);
      acceptanceMsByAdmin.get(adminId).push(ms);
    }
  }

  for (const [adminId, list] of resolutionMsByAdmin.entries()) {
    statsByAdmin.get(adminId).avgResolutionMs = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }
  for (const [adminId, bucket] of slaByAdmin.entries()) {
    statsByAdmin.get(adminId).slaSuccessRate = Math.round((bucket.success / bucket.total) * 100);
  }
  for (const [adminId, list] of acceptanceMsByAdmin.entries()) {
    statsByAdmin.get(adminId).avgAcceptanceMs = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }

  // Recent (lookback window) escalation + claim activity — these matter for
  // "is this admin currently reliable", so unlike experience they ARE
  // windowed. Scanned across ALL operations, not just resolved ones. ────
  const recentDocs = await OperationAssignment.find({
    updatedAt: { $gte: cutoff },
    $or: [{ "timeline.action": "escalate" }, { "timeline.action": "claim" }],
  })
    .select("timeline")
    .lean();

  for (const doc of recentDocs) {
    for (const entry of doc.timeline || []) {
      if (new Date(entry.at) < cutoff) continue;
      if (entry.action === "escalate") {
        const actorId = String(entry.actorId || "");
        const targetId = String(entry.targetUserId || "");
        if (idSet.has(actorId)) statsByAdmin.get(actorId).recentEscalationsMade += 1;
        if (idSet.has(targetId)) statsByAdmin.get(targetId).recentEscalationsReceived += 1;
      } else if (entry.action === "claim") {
        const actorId = String(entry.actorId || "");
        if (idSet.has(actorId)) statsByAdmin.get(actorId).claimsCount += 1;
      }
    }
  }

  return statsByAdmin;
}

export const AssignmentHistory = Object.freeze({
  buildHistoryStatsForAdmins,
});

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine.
// Thin HTTP layer over backend/workflow/assignment/*. Every real
// calculation lives in those modules; this file only fetches, shapes for
// the frontend, and (for AI endpoints) hands the SAME already-computed data
// to generativeAssistant so nothing can diverge between what the page shows
// and what the AI narrates.
// ─────────────────────────────────────────────────────────────────────────

import { asyncHandler } from "../../middleware/asyncHandler.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { getCandidatePool, getPresenceMap, buildWorkloadSnapshots } from "../../workflow/assignment/assignmentRegistry.js";
import { getCapacitySettings } from "../../workflow/assignment/assignmentPolicy.js";
import { getRecommendations, getReassignmentRecommendation, detectConflicts } from "../../workflow/assignment/assignmentEngine.js";
import { buildAssignmentAnalytics } from "../../workflow/assignment/assignmentAnalytics.js";
import { runSweep, AUTO_ASSIGN_MIN_SCORE } from "../../workflow/assignment/assignmentScheduler.js";
import { SCORE_WEIGHTS } from "../../workflow/assignment/assignmentScoring.js";
import { _internal } from "./operationsAdminController.js";

const { buildUnifiedQueue } = _internal;

// ── Step 3: Workload Intelligence ────────────────────────────────────────
export const getWorkloadIntelligence = asyncHandler(async (_req, res) => {
  const [pool, capacity, { items }] = await Promise.all([
    getCandidatePool(),
    getCapacitySettings(),
    buildUnifiedQueue({ status: "all" }),
  ]);
  const ids = pool.map((c) => c._id.toString());
  const presenceMap = await getPresenceMap(ids);
  const snapshots = buildWorkloadSnapshots(pool, items, capacity).map((s) => ({
    admin: { id: s.admin._id, name: s.admin.name, email: s.admin.email, role: s.admin.role },
    isOnline: presenceMap.get(s.admin._id.toString())?.isOnline || false,
    openCount: s.openCount,
    pending: s.pending,
    working: s.working,
    critical: s.critical,
    overdue: s.overdue,
    atRisk: s.atRisk,
    resolvedToday: s.resolvedToday,
    queueWeight: s.queueWeight,
    utilization: s.utilization,
    idle: (presenceMap.get(s.admin._id.toString())?.isOnline || false) && s.openCount === 0,
    burnoutRisk: s.utilization.pct >= 85 && s.overdue >= 2 ? "high" : s.utilization.pct >= 70 || s.overdue >= 1 ? "medium" : "low",
  }));
  res.status(200).json({ success: true, data: { snapshots, capacity }, message: "Workload intelligence fetched successfully" });
});

// ── Step 4/5: transparent scored recommendations for one item ──────────
export const getOperationRecommendations = asyncHandler(async (req, res) => {
  const result = await getRecommendations(req.params.operationKey);
  res.status(200).json({ success: true, data: result, message: "Assignment recommendations fetched successfully" });
});

// ── Step 8: Reassignment Engine — recommendation only ───────────────────
export const getOperationReassignment = asyncHandler(async (req, res) => {
  const result = await getReassignmentRecommendation(req.params.operationKey);
  res.status(200).json({ success: true, data: result, message: "Reassignment recommendation fetched successfully" });
});

// ── Step 9: Conflict Detection ──────────────────────────────────────────
export const getConflictsList = asyncHandler(async (_req, res) => {
  const result = await detectConflicts();
  res.status(200).json({ success: true, data: result, message: "Conflicts fetched successfully" });
});

// ── Step 10: Assignment Analytics ────────────────────────────────────────
export const getAnalytics = asyncHandler(async (_req, res) => {
  const result = await buildAssignmentAnalytics();
  res.status(200).json({ success: true, data: result, message: "Assignment analytics fetched successfully" });
});

// ── Step 14: Business Rules (transparent, matches assignmentScoring.js's
// documented weights verbatim — never a second, hand-typed copy) ────────
export const getAssignmentBusinessRules = asyncHandler(async (_req, res) => {
  const capacity = await getCapacitySettings();
  res.status(200).json({
    success: true,
    data: {
      scoringWeights: SCORE_WEIGHTS,
      autoAssignMinScore: AUTO_ASSIGN_MIN_SCORE,
      capacityPolicy: capacity,
      rules: {
        eligibility: "Assignable users are any admin or super_admin — reuses the existing Permission/role model, no new roles introduced.",
        capacity: `An admin at or over ${capacity.overloadThresholdPct}% utilization is flagged as near capacity; at or over 100% (${capacity.maxOpenItemsPerAdmin} open items) they are never auto-assigned or offered as a top recommendation.`,
        autoAssign: `The scheduler sweep only auto-assigns an unassigned item when the top scoring candidate is under capacity AND scores at least ${AUTO_ASSIGN_MIN_SCORE}/100 — otherwise it is left for a human to pick from the same recommendation list.`,
        autoEscalate: "The scheduler sweep auto-escalates any open item whose real SLA state is 'overdue' and not already escalated, targeting the best-scored super_admin (or best available admin).",
        reassignment: "Reassignment is always a recommendation — the engine never moves an item off its current assignee on its own; an admin must approve via the existing assign action.",
      },
    },
    message: "Assignment business rules fetched successfully",
  });
});

// ── Step 4/7: manual sweep trigger (same function the scheduler runs) ──
export const runAssignmentSweep = asyncHandler(async (_req, res) => {
  const result = await runSweep();
  res.status(200).json({ success: true, data: result, message: "Assignment sweep completed" });
});

// ── Step 12: AI Assignment Advisor — 5 capabilities, each handed the SAME
// data the corresponding page/card already displays. ─────────────────────
export const getAssignmentRecommendationExplain = asyncHandler(async (req, res) => {
  const result = await getRecommendations(req.params.operationKey);
  const ai = await generativeAssistant.assignmentRecommendation(result);
  res.status(200).json({ success: true, data: ai, message: "Assignment recommendation explained" });
});

export const getWorkloadAdvisor = asyncHandler(async (_req, res) => {
  const [pool, capacity, { items }] = await Promise.all([
    getCandidatePool(),
    getCapacitySettings(),
    buildUnifiedQueue({ status: "all" }),
  ]);
  const snapshots = buildWorkloadSnapshots(pool, items, capacity).map((s) => ({
    admin: { name: s.admin.name },
    openCount: s.openCount,
    utilization: s.utilization,
  }));
  const ai = await generativeAssistant.workloadAdvisor({ snapshots });
  res.status(200).json({ success: true, data: ai, message: "Workload advisor generated" });
});

export const getReassignmentAdvisor = asyncHandler(async (req, res) => {
  const result = await getReassignmentRecommendation(req.params.operationKey);
  const ai = await generativeAssistant.reassignmentAdvisor({
    item: result.item,
    shouldReassign: result.shouldReassign,
    reasons: result.current?.reasonsToReassign || [],
    alternate: result.alternates?.[0] || null,
  });
  res.status(200).json({ success: true, data: ai, message: "Reassignment advisor generated" });
});

export const getSlaAdvisor = asyncHandler(async (_req, res) => {
  const analytics = await buildAssignmentAnalytics();
  const distribution = analytics.slaDistribution;
  const mostAtRiskType =
    Object.entries(analytics.operationDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] &&
    (analytics.slaDistribution.overdue > 0 || analytics.slaDistribution.at_risk > 0)
      ? Object.entries(analytics.operationDistribution).sort((a, b) => b[1] - a[1])[0][0]
      : null;
  const ai = await generativeAssistant.slaAdvisor({ distribution, mostAtRiskType });
  res.status(200).json({ success: true, data: ai, message: "SLA advisor generated" });
});

export const getAssignmentExplain = asyncHandler(async (_req, res) => {
  const capacity = await getCapacitySettings();
  const ai = await generativeAssistant.assignmentExplain({ weights: SCORE_WEIGHTS, capacity });
  res.status(200).json({ success: true, data: ai, message: "Assignment engine explanation generated" });
});

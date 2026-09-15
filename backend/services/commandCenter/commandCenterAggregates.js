// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-9 — Executive Admin Command Center.
//
// AUDIT FIRST (see CHANGELOG-PHASE-UI-9-EXECUTIVE-COMMAND-CENTER.md for the
// full write-up). Before writing this file, the entire existing admin
// command ecosystem was read: missionControlAdminController.js (A5.1 —
// buildExecutiveDashboardData/buildMissionControlData/buildSmartAlerts),
// platformHealthAdminController.js (A5.2 — buildOperationalHealth/
// buildInfrastructureStatus), widgetsAdminController.js (A5.2 — 14-widget
// registry), executiveActionController.js (A5.1 — buildActionCenterData/
// buildExecutiveTimeline), operationsAdminController.js (A6.1/A6.2.1 — the
// real per-item Unified Operations Queue), assignmentAdminController.js
// (A6.2.2 — detectConflicts), monitoringController.js (A6.2.4 — flow/cron
// health), financeAggregates.js (UI-7), reviewAdminAggregates.js (UI-8),
// governanceAggregates.js (A6.3.5).
//
// SOURCE-OF-TRUTH RULE: this file computes NOTHING that already has a real
// builder elsewhere. Every section below is a direct call into an existing
// aggregate function. No revenue, appointment, alert, health-score, flow,
// conflict, or compliance number is re-derived. The only genuinely new
// composition here is:
//   1. grouping the existing review attention items by doctor (nothing
//      currently answers "which doctors need reputation attention" across
//      the whole platform — every existing review aggregate is per-review
//      or per-doctor-on-request, never platform-wide-grouped-by-doctor);
//   2. assembling a single top-level "needs attention" feed by taking the
//      existing Unified Operations Queue's already-computed items/counts
//      and slicing them for the command center card (no new query, no new
//      severity/priority logic — computeSla/TYPE_META/PRIORITY_ORDER all
//      stay exactly where they are in the workflow module);
//   3. a resilience wrapper (Promise.allSettled) so one failing section
//      never breaks the rest of the response — this is the Section 13
//      "error handling is a product feature" requirement, and does not
//      exist as a cross-cutting concern anywhere else in this codebase.
// ─────────────────────────────────────────────────────────────────────────
import Review from "../../models/Review.js";
import { buildExecutiveDashboardData, buildSmartAlerts } from "../../controllers/admin/missionControlAdminController.js";
import { buildExecutiveTimeline } from "../../controllers/admin/executiveActionController.js";
import { _internal as operationsInternal } from "../../controllers/admin/operationsAdminController.js";
import { detectConflicts } from "../../workflow/assignment/assignmentEngine.js";
import { buildFlowHealthRanking, buildCronHealthRanking, buildLiveCounters } from "../../monitoring/monitoringAggregates.js";
import { buildFinanceOverview, buildFinancialHealth, buildFinanceAttentionQueue } from "../finance/financeAggregates.js";
import { computeReviewAttentionItems, buildReviewSummary } from "../reviewAdminAggregates.js";
import { buildGovernanceOverview } from "../../process-governance/governanceAggregates.js";
import { groupReviewAttentionByDoctor } from "./commandCenterHelpers.js";

const { buildUnifiedQueue } = operationsInternal;

// ── Section wrappers: never throw, always return { available, ...data } ──
// Section 13 (Error Handling): if one data source fails, the rest of the
// command center must keep working. Every section below is isolated so a
// thrown error in one aggregate cannot take down the others.
async function safeSection(loader) {
  try {
    const data = await loader();
    return { available: true, error: null, ...data };
  } catch (error) {
    return { available: false, error: error.message || "Data unavailable", data: null };
  }
}

// ── 3. Needs Attention ──────────────────────────────────────────────────
// Composes the real, per-item Unified Operations Queue (A6.1/A6.2.1) —
// exactly the "one real actionable queue" that operationsAdminController.js
// already built to replace the old duplicated aggregate queues. No new
// alert engine. Also surfaces buildSmartAlerts' own database-connectivity
// alert (the one alert type the operations queue itself cannot represent,
// since it isn't a per-item source document).
async function buildNeedsAttention() {
  const [queue, smartAlerts] = await Promise.all([buildUnifiedQueue({ status: "open" }), buildSmartAlerts()]);
  const dbAlert = smartAlerts.alerts.find((a) => a.key === "database-warning") || null;

  return {
    items: queue.items.slice(0, 20).map((item) => ({
      id: item.id,
      type: item.type,
      typeLabel: item.typeLabel,
      priority: item.priority,
      severity: item.severity,
      reason: item.reason,
      businessImpact: item.businessImpact,
      recommendedAction: item.recommendedAction,
      owner: item.assignedTo?.name || null,
      createdAt: item.createdAt,
      sla: item.sla,
      resolutionRoute: item.resolutionRoute,
      resolutionLabel: item.resolutionLabel,
    })),
    counts: queue.counts,
    systemAlert: dbAlert,
  };
}

// ── 8. Workflow / Automation Health ─────────────────────────────────────
// Reuses A6.2.2 (Smart Assignment conflicts), A6.2.4 (Monitoring flow/cron
// health), and the Unified Operations Queue's own overdue/at-risk counts
// (already computed above in Needs Attention — passed in rather than
// re-queried) for SLA breaches / overdue operations. No new monitoring
// system, no new conflict-detection logic.
async function buildWorkflowHealth(queueCounts) {
  const [conflicts, flowHealth, cronHealth, liveCounters] = await Promise.all([
    detectConflicts(),
    buildFlowHealthRanking(),
    buildCronHealthRanking(),
    buildLiveCounters(),
  ]);

  return {
    failedExecutionsToday: liveCounters.failed,
    slaBreaches: queueCounts.overdue,
    atRiskOperations: queueCounts.atRisk,
    assignmentConflicts: conflicts.conflicts.length,
    totalFlows: flowHealth.totalFlows,
    publishedFlows: flowHealth.publishedFlows,
    topFailingFlows: flowHealth.topFailing.slice(0, 3),
    cronHealthyCount: cronHealth.healthyCount,
    cronTotalCount: cronHealth.totalCount,
  };
}

// ── 7. Reputation ────────────────────────────────────────────────────────
// Reuses UI-8's review summary + the deterministic review attention engine
// as-is; the only new work is the doctor grouping documented above.
async function buildReputationSnapshot() {
  const reviews = await Review.find({ adminDeleted: { $ne: true } })
    .select("rating doctorReply isPinned doctorId")
    .populate({ path: "doctorId", select: "userId", populate: { path: "userId", select: "name" } })
    .lean();

  const summary = buildReviewSummary(reviews);
  const attentionItems = computeReviewAttentionItems(reviews);
  const reviewsById = new Map(reviews.map((r) => [String(r._id), r]));
  const doctorsNeedingAttention = groupReviewAttentionByDoctor(attentionItems, reviewsById).slice(0, 10);

  return {
    averageRating: summary.averageRating,
    totalReviews: summary.totalReviews,
    negativeCount: summary.negativeCount,
    unrepliedCount: summary.unrepliedCount,
    doctorsNeedingAttention,
  };
}

// ── Top-level composition ───────────────────────────────────────────────
// permissions: { canViewFinance, canViewOps } — computed by the controller
// from the existing userHasPermission() gate (manage_payments / manage_
// settings, the same keys Finance/Operations/Monitoring/Assignment/
// Governance already require). Section 15 (Security): a section is
// completely omitted — never returned as a fabricated zero — when the
// requesting admin lacks the permission that already gates its own page.
export async function buildCommandCenterData({ canViewFinance, canViewOps }) {
  const [executiveSection, needsAttentionSection, activitySection, reputationSection] = await Promise.all([
    safeSection(async () => ({ executive: await buildExecutiveDashboardData() })),
    safeSection(async () => ({ needsAttention: await buildNeedsAttention() })),
    safeSection(async () => ({ activity: await buildExecutiveTimeline(20) })),
    safeSection(async () => ({ reputation: await buildReputationSnapshot() })),
  ]);

  const financeSection = canViewFinance
    ? await safeSection(async () => {
        const [overview, attention] = await Promise.all([buildFinanceOverview(), buildFinanceAttentionQueue()]);
        const health = await buildFinancialHealth(overview, attention.items.length);
        return { finance: { overview, health, attentionCounts: attention.counts } };
      })
    : { available: false, error: null, permissionDenied: true };

  const workflowSection = canViewOps
    ? await safeSection(async () => ({
        workflow: await buildWorkflowHealth(needsAttentionSection.available ? needsAttentionSection.needsAttention.counts : {}),
      }))
    : { available: false, error: null, permissionDenied: true };

  const governanceSection = canViewOps ? await safeSection(async () => ({ governance: await buildGovernanceOverview() })) : { available: false, error: null, permissionDenied: true };

  return {
    executive: executiveSection.available ? executiveSection.executive : null,
    executiveError: executiveSection.available ? null : executiveSection.error,

    needsAttention: needsAttentionSection.available ? needsAttentionSection.needsAttention : null,
    needsAttentionError: needsAttentionSection.available ? null : needsAttentionSection.error,

    activity: activitySection.available ? activitySection.activity : [],
    activityError: activitySection.available ? null : activitySection.error,

    reputation: reputationSection.available ? reputationSection.reputation : null,
    reputationError: reputationSection.available ? null : reputationSection.error,

    finance: financeSection.available ? financeSection.finance : null,
    financeError: financeSection.permissionDenied ? null : financeSection.error,
    financePermissionDenied: Boolean(financeSection.permissionDenied),

    workflow: workflowSection.available ? workflowSection.workflow : null,
    workflowError: workflowSection.permissionDenied ? null : workflowSection.error,
    workflowPermissionDenied: Boolean(workflowSection.permissionDenied),

    governance: governanceSection.available ? governanceSection.governance : null,
    governanceError: governanceSection.permissionDenied ? null : governanceSection.error,
    governancePermissionDenied: Boolean(governanceSection.permissionDenied),

    fetchedAt: new Date().toISOString(),
  };
}

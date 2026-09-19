// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-13 — Process, Automation & Governance Intelligence Workspace.
//
// AUDIT FINDING (see CHANGELOG-PHASE-UI-13-PROCESS-AUTOMATION-GOVERNANCE.md):
// every capability the UI-13 brief asked for — Process Designer, versioning,
// validation, simulation, publish/activate lifecycle, approval workflow,
// version management, change-impact analysis, process health, automation
// studio, automation execution history, retry, governance, compliance,
// optimization recommendations, AI advisors — already exists as REAL,
// CONNECTED, non-duplicated backend + frontend across seven existing admin
// pages (Process Orchestrator/Designer/Analytics/Governance, Automation
// Studio, Workflow Engine, Workflow Intelligence). Nothing above is
// rebuilt here.
//
// The one genuine gap: those seven pages have never been composed into a
// single cross-domain workspace the way UI-9 (Executive Command Center)
// and UI-10 (Operations Command Workspace) did for their domains. This
// file is that composition layer — same pattern as
// commandCenter/commandCenterAggregates.js: it computes NOTHING that
// already has a real builder elsewhere, it only calls into:
//   - process-analytics/processAnalyticsAggregates.js  (buildExecutiveOverview)
//   - process-governance/governanceAggregates.js       (buildGovernanceOverview, buildApprovalQueue)
//   - process/processRegistry.js + processHealth.js    (listProcessDefinitions, computeAllProcessHealth)
//   - controllers/admin/automationStudioController.js  (buildAutomationStudioHome — extracted
//     from getStudioHome in this same phase so this file doesn't re-query
//     AutomationFlow/AutomationRunLog a second time; see that file's changelog note)
//   - models/ProcessOptimizationRecommendation.js       (same open-recommendation count
//     already used by getExecutiveOverview)
//
// Section 13 (Error Handling as a Product Feature): each section is
// wrapped in the same safeSection() resilience pattern UI-9 established —
// one failing data source never breaks the rest of the workspace.
// ─────────────────────────────────────────────────────────────────────────
import ProcessOptimizationRecommendation from "../../models/ProcessOptimizationRecommendation.js";
import { listProcessDefinitions, listProcessCategories } from "../../process/processRegistry.js";
import { computeAllProcessHealth } from "../../process/processHealth.js";
import { buildExecutiveOverview } from "../../process-analytics/processAnalyticsAggregates.js";
import { buildGovernanceOverview, buildApprovalQueue } from "../../process-governance/governanceAggregates.js";
import { buildAutomationStudioHome } from "../../controllers/admin/automationStudioController.js";

async function safeSection(loader) {
  try {
    const data = await loader();
    return { available: true, error: null, data };
  } catch (error) {
    return { available: false, error: error.message || "Data unavailable", data: null };
  }
}

// Pure derivation, extracted so it's regression-testable without a DB
// (same discipline as commandCenterHelpers.js's groupReviewAttentionByDoctor).
export function deriveNeedsAttention(scoredProcesses) {
  const unhealthy = scoredProcesses.filter((p) => typeof p.health?.score === "number" && p.health.score < 50);
  const needsAttention = scoredProcesses
    .filter((p) => typeof p.health?.score === "number" && p.health.score < 80)
    .sort((a, b) => (a.health?.score ?? 100) - (b.health?.score ?? 100))
    .slice(0, 5)
    .map((p) => ({ id: p.id, label: p.label, category: p.category, score: p.health?.score ?? null }));
  return { unhealthyCount: unhealthy.length, needsAttention };
}

async function loadRegistrySummary() {
  const definitions = listProcessDefinitions();
  const health = await computeAllProcessHealth(definitions.map((p) => p.id));
  const scored = definitions.map((p) => ({ ...p, health: health[p.id] }));
  const { unhealthyCount, needsAttention } = deriveNeedsAttention(scored);
  return {
    totalProcesses: definitions.length,
    categories: listProcessCategories().length,
    unhealthyCount,
    needsAttention,
  };
}

async function loadOptimization() {
  const [detected, reviewed, approved] = await Promise.all([
    ProcessOptimizationRecommendation.countDocuments({ status: "detected" }),
    ProcessOptimizationRecommendation.countDocuments({ status: "reviewed" }),
    ProcessOptimizationRecommendation.countDocuments({ status: "approved" }),
  ]);
  return { detected, reviewed, approved, openTotal: detected + reviewed };
}

async function loadGovernance() {
  // PHASE UI-13 hardening: buildApprovalQueue() now returns a paginated
  // { items, pagination } shape (A2) — this command-center preview only
  // ever needed the first 5 rows, so it asks for exactly that page size
  // instead of pulling a full page and slicing further.
  const [overview, queue] = await Promise.all([buildGovernanceOverview(), buildApprovalQueue({ page: 1, pageSize: 5 })]);
  return {
    kpis: overview.kpis,
    governanceHealth: overview.governanceHealth,
    approvalQueuePreview: queue.items.map((q) => ({
      id: q.id,
      key: q.key,
      name: q.name,
      riskLevel: q.riskLevel,
      submittedAt: q.submittedAt,
      requestedBy: q.requestedBy,
    })),
  };
}

/**
 * The single composed payload behind GET /api/admin/process/command-center.
 * Every section is independently fault-isolated (Promise.allSettled via
 * safeSection) so a failure in, say, Governance never hides Automation.
 */
export async function buildProcessCommandCenter() {
  const [registry, analytics, automation, governance, optimization] = await Promise.all([
    safeSection(loadRegistrySummary),
    safeSection(() => buildExecutiveOverview({ rangeDays: 30 })),
    safeSection(buildAutomationStudioHome),
    safeSection(loadGovernance),
    safeSection(loadOptimization),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    registry,
    analytics,
    automation,
    governance,
    optimization,
  };
}

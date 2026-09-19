// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence.
//
// Section 19 (Performance): batch queries, no N+1. Every "does this
// process have simulation evidence / open critical findings" check needed
// by evaluateGovernance() across many processes at once is pre-fetched
// here in a small number of aggregation/count queries and handed to the
// engine per-document, rather than the engine re-querying per process.
// ─────────────────────────────────────────────────────────────────────────

import ProcessDefinition from "../models/ProcessDefinition.js";
import AutomationRunLog from "../models/AutomationRunLog.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import ProcessOptimizationRecommendation from "../models/ProcessOptimizationRecommendation.js";
import { evaluateGovernance, computeGovernanceHealth } from "./processGovernanceEngine.js";
import { paginateQueueItems } from "../services/operationsQueuePagination.js";

// PHASE UI-13 hardening (A2/A3/A5): governance/compliance state is computed
// live per process (evaluateGovernance()), not a stored field, so it can't
// be filtered at the DB query layer the way a plain status field can — the
// Approval Queue and Compliance Matrix both need every candidate document
// evaluated before a compliance-state/risk filter or a page slice can be
// applied. A truly unbounded platform could still make that scan itself
// unbounded, so a hard protective ceiling caps how many documents a single
// governance scan will ever evaluate — same "bounded, not truly unlimited"
// posture as every other UI-13 large-data fix, reusing the exact
// paginateQueueItems() slicer Phase UI-10 built for this in-memory-list
// shape rather than inventing a second pagination helper.
const GOVERNANCE_SCAN_CEILING = 2000;

/** Real evidence lookups batched across a set of processes — no per-doc query. */
async function buildEvidenceMaps(docs) {
  const ids = docs.map((d) => d._id);
  const keys = [...new Set(docs.map((d) => d.key))];

  const [simRows, findingRows] = await Promise.all([
    AutomationRunLog.aggregate([
      { $match: { processDefinitionId: { $in: ids }, dryRun: true } },
      { $group: { _id: "$processDefinitionId" } },
    ]),
    ProcessOptimizationRecommendation.aggregate([
      { $match: { processKey: { $in: keys }, severity: "critical", status: { $nin: ["rejected", "implemented"] } } },
      { $group: { _id: "$processKey", count: { $sum: 1 } } },
    ]),
  ]);

  const simSet = new Set(simRows.map((r) => String(r._id)));
  const findingsByKey = new Map(findingRows.map((r) => [r._id, r.count]));
  return { simSet, findingsByKey };
}

async function evaluateMany(docs) {
  if (!docs.length) return [];
  const { simSet, findingsByKey } = await buildEvidenceMaps(docs);
  return Promise.all(
    docs.map(async (doc) => ({
      doc,
      governance: await evaluateGovernance(doc, {
        hasSimulationEvidence: simSet.has(String(doc._id)),
        openCriticalFindings: findingsByKey.get(doc.key) ?? 0,
      }),
    })),
  );
}

/** Section 12.1 — Governance Overview KPIs. Every number here is a real count, no percentage scores. */
export async function buildGovernanceOverview() {
  const docs = await ProcessDefinition.find({ status: { $ne: "archived" } }).limit(GOVERNANCE_SCAN_CEILING).lean();
  const evaluated = await evaluateMany(docs);

  const governedDocs = evaluated.filter((e) => e.governance.approvalRequired || e.doc.governance?.ownerUserId);
  const pendingApproval = evaluated.filter((e) => e.doc.status === "pending_approval");
  const highRisk = evaluated.filter((e) => ["high", "critical"].includes(e.governance.riskLevel));
  const violations = evaluated.filter((e) => e.governance.blockers.length > 0 && ["published", "active"].includes(e.doc.status));
  const now = new Date();
  const reviewDue = evaluated.filter((e) => e.doc.governance?.nextReviewDue && new Date(e.doc.governance.nextReviewDue) <= now);
  const activeExceptions = docs.reduce((sum, d) => sum + (d.governanceExceptions || []).filter((x) => x.reviewRequired && !x.reviewedAt).length, 0);

  const worstHealth = evaluated.reduce((worst, e) => {
    const health = computeGovernanceHealth({
      blockers: e.governance.blockers,
      warnings: e.governance.warnings,
      approvalRequired: e.governance.approvalRequired,
      approvalStatus: e.doc.approval?.status,
    });
    const rank = { Healthy: 0, Attention: 1, "At Risk": 2, Critical: 3 };
    return rank[health] > rank[worst] ? health : worst;
  }, "Healthy");

  return {
    kpis: {
      governedProcesses: governedDocs.length,
      pendingApproval: pendingApproval.length,
      highRiskProcesses: highRisk.length,
      governanceViolations: violations.length,
      reviewDue: reviewDue.length,
      activeExceptions,
      totalProcesses: docs.length,
    },
    governanceHealth: worstHealth,
  };
}

/** Section 12.3 — Approval Queue. Server-side paginated (UI-13 A2) — page/pageSize are pre-clamped by the caller. */
export async function buildApprovalQueue({ page = 1, pageSize = 20 } = {}) {
  const docs = await ProcessDefinition.find({ status: "pending_approval" })
    .sort({ "approval.submittedAt": 1 })
    .limit(GOVERNANCE_SCAN_CEILING)
    .lean();
  const evaluated = await evaluateMany(docs);
  const rows = evaluated.map(({ doc, governance }) => ({
    id: doc._id,
    key: doc.key,
    name: doc.name,
    version: doc.version,
    riskLevel: governance.riskLevel,
    requestedBy: doc.approval?.submittedBy || null,
    submittedAt: doc.approval?.submittedAt || null,
    submittedReason: doc.approval?.submittedReason || "",
    requiredControls: governance.controls.filter((c) => c.status !== "NOT_APPLICABLE").map((c) => c.control),
    currentStage: "pending_approval",
    blockers: governance.blockers,
    segregationRequired: governance.segregationRequired,
    createdBy: doc.createdBy,
  }));

  const { pageItems, pagination } = paginateQueueItems(rows, page, pageSize);
  return { items: pageItems, pagination };
}

/** Section 12.4 — Compliance Matrix, across all live processes. Server-side paginated (UI-13 A3) — page/pageSize are pre-clamped by the caller. */
export async function buildComplianceOverview({ filter, page = 1, pageSize = 20 } = {}) {
  const docs = await ProcessDefinition.find({ status: { $ne: "archived" } }).limit(GOVERNANCE_SCAN_CEILING).lean();
  const evaluated = await evaluateMany(docs);
  let rows = evaluated.map(({ doc, governance }) => {
    const failCount = governance.controls.filter((c) => c.status === "FAIL").length;
    const complianceState = failCount > 0 ? "failed" : governance.riskLevel !== "low" && governance.warnings.length ? "attention" : "compliant";
    return {
      id: doc._id,
      key: doc.key,
      name: doc.name,
      version: doc.version,
      status: doc.status,
      riskLevel: governance.riskLevel,
      complianceState,
      controls: governance.controls,
    };
  });
  if (filter && filter === "high_risk") rows = rows.filter((r) => ["high", "critical"].includes(r.riskLevel));
  else if (filter && filter !== "all") rows = rows.filter((r) => r.complianceState === filter);

  const { pageItems, pagination } = paginateQueueItems(rows, page, pageSize);
  return { items: pageItems, pagination };
}

/** Section 12.5 — Governance Exceptions: real emergency overrides + live-computed violations, never fabricated. */
export async function buildGovernanceExceptions() {
  const docs = await ProcessDefinition.find({ status: { $ne: "archived" } }).limit(GOVERNANCE_SCAN_CEILING).lean();
  const evaluated = await evaluateMany(docs);

  const violations = [];
  for (const { doc, governance } of evaluated) {
    if (["published", "active"].includes(doc.status) && !doc.governance?.ownerUserId) {
      violations.push({ type: "missing_owner", processId: doc._id, processKey: doc.key, processName: doc.name, detail: "Active/published process has no owner assigned." });
    }
    if (["published", "active"].includes(doc.status) && governance.approvalRequired && doc.approval?.status !== "approved") {
      violations.push({ type: "high_risk_unapproved", processId: doc._id, processKey: doc.key, processName: doc.name, detail: `${governance.riskLevel}-risk process is ${doc.status} without a governance approval on record.` });
    }
    for (const control of governance.controls) {
      if (control.control === "Segregation of duties" && control.status === "FAIL") {
        violations.push({ type: "segregation_violation", processId: doc._id, processKey: doc.key, processName: doc.name, detail: control.evidence });
      }
    }
  }

  const emergencyOverrides = [];
  for (const doc of docs) {
    for (const exception of doc.governanceExceptions || []) {
      emergencyOverrides.push({
        type: "emergency_override",
        processId: doc._id,
        processKey: doc.key,
        processName: doc.name,
        reason: exception.reason,
        actorId: exception.actorId,
        createdAt: exception.createdAt,
        reviewRequired: exception.reviewRequired,
        reviewedBy: exception.reviewedBy,
        reviewedAt: exception.reviewedAt,
      });
    }
  }

  return { violations, emergencyOverrides };
}

/** Section 10 — real governance audit timeline, merged from the existing AdminActivityLog (no second audit system). */
export async function buildGovernanceAuditTimeline(processId, { limit = 100 } = {}) {
  const events = await AdminActivityLog.find({
    resourceType: "ProcessDefinition",
    resourceId: String(processId),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return events.map((e) => ({
    actor: e.actorId,
    action: e.action,
    timestamp: e.createdAt,
    severity: e.severity,
    metadata: e.metadata,
  }));
}

/** Full cross-version timeline for a process key (a governed process's real lineage spans several documents). */
export async function buildGovernanceAuditTimelineForKey(key, { limit = 200 } = {}) {
  const versions = await ProcessDefinition.find({ key }).select("_id version").lean();
  const events = await AdminActivityLog.find({
    resourceType: "ProcessDefinition",
    resourceId: { $in: versions.map((v) => String(v._id)) },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const versionById = new Map(versions.map((v) => [String(v._id), v.version]));
  return events.map((e) => ({
    actor: e.actorId,
    action: e.action,
    version: versionById.get(e.resourceId) ?? null,
    timestamp: e.createdAt,
    severity: e.severity,
    metadata: e.metadata,
  }));
}

export const _internal = { buildEvidenceMaps, evaluateMany };

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.4 — Process Analytics & Optimization Intelligence.
// Reuses the exact same requireAdmin/requirePermission("manage_settings")
// gate as processDesignerController.js — no new roles/permissions.
// Every endpoint here re-derives its data from process-analytics builders
// on every call (Section 21: "AI endpoints must not allow arbitrary
// process IDs to bypass authorization" — there is no per-process
// ownership model in this codebase beyond admin-only access, same as
// Process Designer/Registry/Orchestrator, so the gate itself is the
// authorization boundary, consistent with every prior phase).
// ─────────────────────────────────────────────────────────────────────────

import ProcessDefinition from "../../models/ProcessDefinition.js";
import ProcessOptimizationRecommendation from "../../models/ProcessOptimizationRecommendation.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import {
  buildExecutiveOverview,
  buildCrossProcessOverview,
  buildProcessPerformance,
  buildProcessHealthScore,
  buildBottleneckAnalysis,
  buildFailureIntelligence,
  buildSlaIntelligence,
  buildVersionIntelligence,
  buildVersionComparison,
  buildTrendSeries,
  listVersionsForKey,
} from "../../process-analytics/processAnalyticsAggregates.js";
import { detectOptimizationCandidates, detectOptimizationCandidatesForAllActive, generateProposedVersion } from "../../process-analytics/processOptimizationEngine.js";
import { validateProcessGraph } from "../../process-designer/graphValidator.js";
import { walkProcessGraph, buildProcessContext } from "../../process-designer/graphWalker.js";
import AutomationRunLog from "../../models/AutomationRunLog.js";

function rangeDaysFromQuery(req, fallback = 30) {
  return req.query.rangeDays ? Number(req.query.rangeDays) : fallback;
}

async function assertKeyExists(key) {
  const exists = await ProcessDefinition.exists({ key });
  if (!exists) throw new AppError(`Unknown process key "${key}".`, 404);
}

// ─────────────────────────────────────── Executive Overview (Section 17)

export const getExecutiveOverview = asyncHandler(async (req, res) => {
  const data = await buildExecutiveOverview({ rangeDays: rangeDaysFromQuery(req) });
  const openOptimizations = await ProcessOptimizationRecommendation.countDocuments({ status: { $in: ["detected", "reviewed"] } });
  res.json({ success: true, data: { ...data, openOptimizationOpportunities: openOptimizations } });
});

export const getCrossProcessOverview = asyncHandler(async (req, res) => {
  const data = await buildCrossProcessOverview({ rangeDays: rangeDaysFromQuery(req) });
  res.json({ success: true, data });
});

// ─────────────────────────────────────── Process Performance / Detail (Section 5, 18)

export const getProcessPerformance = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const data = await buildProcessPerformance({ key, version, rangeDays: rangeDaysFromQuery(req) });
  res.json({ success: true, data });
});

export const getProcessHealth = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const data = await buildProcessHealthScore({ key, version, rangeDays: rangeDaysFromQuery(req) });
  res.json({ success: true, data });
});

export const getProcessTrend = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const period = req.query.period || "7d";
  const data = await buildTrendSeries({ key, version, period });
  res.json({ success: true, data });
});

// ─────────────────────────────────────── Bottleneck Explorer (Section 7)

export const getProcessBottlenecks = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const data = await buildBottleneckAnalysis({ key, version, rangeDays: rangeDaysFromQuery(req) });
  res.json({ success: true, data });
});

// ─────────────────────────────────────── Failure & SLA Intelligence (Section 8)

export const getProcessFailures = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const data = await buildFailureIntelligence({ key, version, rangeDays: rangeDaysFromQuery(req) });
  res.json({ success: true, data });
});

export const getProcessSla = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const data = await buildSlaIntelligence({ key, version, rangeDays: rangeDaysFromQuery(req) });
  res.json({ success: true, data });
});

export const setProcessSlaTarget = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { version, slaTargetMs } = req.body;
  if (slaTargetMs !== null && (!Number.isFinite(slaTargetMs) || slaTargetMs <= 0)) {
    throw new AppError("slaTargetMs must be a positive number or null.", 400);
  }
  const doc = await ProcessDefinition.findOne({ key, version });
  if (!doc) throw new AppError(`Version ${version} of "${key}" not found.`, 404);
  doc.slaTargetMs = slaTargetMs;
  await doc.save();
  await writeAdminLog({ req, action: "process_analytics.set_sla_target", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), metadata: { slaTargetMs } });
  res.json({ success: true, data: { key, version, slaTargetMs } });
});

// ─────────────────────────────────────── Version Intelligence (Section 9)

export const getVersionIntelligence = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const data = await buildVersionIntelligence({ key, rangeDays: rangeDaysFromQuery(req, 90) });
  res.json({ success: true, data });
});

export const getVersionComparison = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const versionA = Number(req.query.versionA);
  const versionB = Number(req.query.versionB);
  if (!versionA || !versionB) throw new AppError("versionA and versionB query params are required.", 400);
  const data = await buildVersionComparison({ key, versionA, versionB, rangeDays: rangeDaysFromQuery(req, 90) });
  res.json({ success: true, data });
});

// ─────────────────────────────────────── Optimization Center (Section 12, 19)

// PHASE UI-13 hardening (A4/A5 — optimization recommendations were an
// explicitly named large-data risk): page/limit were previously trusted
// verbatim (negative page -> negative skip; unbounded limit -> unbounded
// query). Now clamped server-side, same shared helper as Automation
// Studio/Process Registry/Governance.
export const listRecommendations = asyncHandler(async (req, res) => {
  const { status, key, severity, page, limit } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (key) filter.processKey = key;
  if (severity) filter.severity = severity;

  const total = await ProcessOptimizationRecommendation.countDocuments(filter);
  const { page: safePage, pageSize: safeLimit, skip } = clampPagination(page, limit, { total });

  const items = await ProcessOptimizationRecommendation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean();
  res.json({ success: true, data: items, meta: buildPaginationMeta(safePage, safeLimit, total) });
});

export const runDetection = asyncHandler(async (req, res) => {
  const { key } = req.body;
  const rangeDays = req.body.rangeDays || 30;
  const result = key ? await detectOptimizationCandidates({ key, rangeDays }) : await detectOptimizationCandidatesForAllActive({ rangeDays });
  await writeAdminLog({ req, action: "process_analytics.run_detection", resourceType: "ProcessOptimizationRecommendation", resourceId: key || "all", metadata: { rangeDays } });
  res.json({ success: true, data: result });
});

export const reviewRecommendation = asyncHandler(async (req, res) => {
  const rec = await ProcessOptimizationRecommendation.findById(req.params.id);
  if (!rec) throw new AppError("Recommendation not found", 404);
  if (rec.status !== "detected") throw new AppError(`Cannot review a recommendation in status "${rec.status}".`, 409);
  rec.status = "reviewed";
  rec.reviewedBy = req.user._id;
  rec.reviewedAt = new Date();
  await rec.save();
  await writeAdminLog({ req, action: "process_analytics.review_recommendation", resourceType: "ProcessOptimizationRecommendation", resourceId: rec._id.toString() });
  res.json({ success: true, data: rec });
});

// Section 13: Analytics -> Candidate -> Review -> Generate Proposed
// Version -> Validate -> Simulate -> Compare -> Approval -> Publish ->
// Activate. This endpoint performs ONLY the "Generate Proposed Version"
// step — the resulting draft is a normal Process Designer draft the admin
// must still validate/simulate/publish/activate themselves through the
// existing Process Designer endpoints. No auto-mutation of nodes is
// performed here unless the admin explicitly supplies mutatedNodes/Edges
// (i.e. they already decided the structural fix) — otherwise the draft is
// an identical clone of the active version, ready for the admin to edit.
export const proposeVersion = asyncHandler(async (req, res) => {
  const rec = await ProcessOptimizationRecommendation.findById(req.params.id);
  if (!rec) throw new AppError("Recommendation not found", 404);
  if (!["detected", "reviewed"].includes(rec.status)) throw new AppError(`Cannot propose a version for a recommendation in status "${rec.status}".`, 409);
  const { mutatedNodes, mutatedEdges } = req.body;
  const { recommendation, draft } = await generateProposedVersion({ recommendationId: rec._id, mutatedNodes, mutatedEdges, actorId: req.user._id });
  await writeAdminLog({ req, action: "process_analytics.propose_version", resourceType: "ProcessDefinition", resourceId: draft._id.toString(), metadata: { recommendationId: rec._id.toString() } });
  res.status(201).json({ success: true, data: { recommendation, draft } });
});

// Section 14: Optimization Simulation — Current vs Proposed. Reuses the
// EXACT existing Simulation Engine (graphWalker.js) for both sides rather
// than a second predictive engine. Clearly labelled a structural
// simulation, never a predictive estimate.
export const simulateProposal = asyncHandler(async (req, res) => {
  const rec = await ProcessOptimizationRecommendation.findById(req.params.id).lean();
  if (!rec || !rec.proposedDefinitionId) throw new AppError("No proposed version to simulate for this recommendation.", 404);

  const [active, proposed] = await Promise.all([
    ProcessDefinition.findOne({ key: rec.processKey, status: "active" }).lean(),
    ProcessDefinition.findById(rec.proposedDefinitionId).lean(),
  ]);
  if (!proposed) throw new AppError("Proposed draft version not found.", 404);

  const proposedValidation = validateProcessGraph({ nodes: proposed.nodes, edges: proposed.edges });
  const currentValidation = active ? validateProcessGraph({ nodes: active.nodes, edges: active.edges }) : null;

  let proposedRun = null;
  const triggerNode = (proposed.nodes || []).find((n) => n.type === "trigger");
  if (proposedValidation.valid && triggerNode) {
    const context = buildProcessContext(proposed, { triggerType: triggerNode.config?.triggerType, __simulation: true });
    const startedAt = new Date();
    const result = await walkProcessGraph(proposed, context, { dryRun: true, startNodeId: triggerNode.id });
    await AutomationRunLog.create({
      processDefinitionId: proposed._id,
      processKey: proposed.key,
      processVersion: proposed.version,
      triggerType: triggerNode.config?.triggerType || "unknown",
      dryRun: true,
      status: result.status === "success" ? "success" : result.status === "blocked" ? "blocked" : "failed",
      nodeTrace: result.nodeTrace,
      stepResults: result.stepResults,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      triggeredBy: "simulator",
      actorId: req.user._id,
    });
    proposedRun = result;
  }

  res.json({
    success: true,
    data: {
      simulationKind: "structural_and_dry_run",
      banner: "SIMULATION — NO PRODUCTION DATA MUTATED",
      current: active ? { version: active.version, nodeCount: active.nodes.length, validation: currentValidation } : null,
      proposed: { version: proposed.version, nodeCount: proposed.nodes.length, validation: proposedValidation, run: proposedRun },
    },
  });
});

export const decideRecommendation = asyncHandler(async (req, res) => {
  const rec = await ProcessOptimizationRecommendation.findById(req.params.id);
  if (!rec) throw new AppError("Recommendation not found", 404);
  const { decision, note } = req.body; // "approve" | "reject"
  if (!["approve", "reject"].includes(decision)) throw new AppError('decision must be "approve" or "reject".', 400);
  if (!["simulation_ready", "reviewed", "detected"].includes(rec.status)) throw new AppError(`Cannot decide a recommendation in status "${rec.status}".`, 409);

  rec.status = decision === "approve" ? "approved" : "rejected";
  rec.decidedBy = req.user._id;
  rec.decidedAt = new Date();
  rec.decisionNote = note || "";
  await rec.save();
  await writeAdminLog({ req, action: `process_analytics.${decision}_recommendation`, resourceType: "ProcessOptimizationRecommendation", resourceId: rec._id.toString(), severity: decision === "reject" ? "warning" : "info" });
  res.json({ success: true, data: rec });
});

// Marking "Implemented" is a manual admin confirmation that the proposed
// draft has since gone through its own real Process Designer
// publish/activate flow — this endpoint does NOT publish or activate
// anything itself (that would bypass Section 13's required gate).
export const markImplemented = asyncHandler(async (req, res) => {
  const rec = await ProcessOptimizationRecommendation.findById(req.params.id);
  if (!rec) throw new AppError("Recommendation not found", 404);
  if (rec.status !== "approved") throw new AppError('Only an "approved" recommendation can be marked implemented.', 409);
  if (rec.proposedDefinitionId) {
    const proposed = await ProcessDefinition.findById(rec.proposedDefinitionId).lean();
    if (!proposed || proposed.status !== "active") {
      throw new AppError("The proposed version must be published and activated through Process Designer before this recommendation can be marked implemented.", 409);
    }
  }
  rec.status = "implemented";
  rec.implementedAt = new Date();
  await rec.save();
  await writeAdminLog({ req, action: "process_analytics.mark_implemented", resourceType: "ProcessOptimizationRecommendation", resourceId: rec._id.toString() });
  res.json({ success: true, data: rec });
});

// ─────────────────────────────────────── AI Explain (Section 15)

export const explainAnalytics = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const rangeDays = rangeDaysFromQuery(req);
  const [perf, health] = await Promise.all([
    buildProcessPerformance({ key, version, rangeDays }),
    buildProcessHealthScore({ key, version, rangeDays }),
  ]);
  const result = await generativeAssistant.processAnalyticsExplain({ key, rangeDays, ...perf, health });
  res.json({ success: true, data: result });
});

export const explainBottlenecks = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const version = req.query.version ? Number(req.query.version) : null;
  const data = await buildBottleneckAnalysis({ key, version, rangeDays: rangeDaysFromQuery(req) });
  const result = await generativeAssistant.processBottleneckExplain({ key, ...data });
  res.json({ success: true, data: result });
});

export const explainOptimization = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const recommendations = await ProcessOptimizationRecommendation.find({ processKey: key, status: { $in: ["detected", "reviewed", "simulation_ready"] } }).sort({ severity: -1 }).limit(10).lean();
  const result = await generativeAssistant.processOptimizationAdvisor({ recommendations });
  res.json({ success: true, data: result });
});

export const explainVersionComparison = asyncHandler(async (req, res) => {
  const { key } = req.params;
  await assertKeyExists(key);
  const versionA = Number(req.query.versionA);
  const versionB = Number(req.query.versionB);
  if (!versionA || !versionB) throw new AppError("versionA and versionB query params are required.", 400);
  const data = await buildVersionComparison({ key, versionA, versionB, rangeDays: rangeDaysFromQuery(req, 90) });
  const result = await generativeAssistant.processVersionComparisonExplain(data);
  res.json({ success: true, data: result });
});

export const listAnalyzableProcesses = asyncHandler(async (_req, res) => {
  const keys = await ProcessDefinition.distinct("key");
  const definitions = await Promise.all(keys.map((key) => listVersionsForKey(key)));
  const data = keys.map((key, i) => ({
    key,
    name: definitions[i][definitions[i].length - 1]?.name || key,
    activeVersion: definitions[i].find((d) => d.status === "active")?.version || null,
    versionCount: definitions[i].length,
  }));
  res.json({ success: true, data });
});

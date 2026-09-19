// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
// All read/write surfaces for the no-code automation builder. Every write
// endpoint reuses the existing requireAdmin/requirePermission("manage_settings")
// gate — no new roles/permissions invented (same discipline as every prior
// Operations/Workflow/Assignment phase).
// ─────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import AutomationFlow from "../../models/AutomationFlow.js";
import AutomationRunLog from "../../models/AutomationRunLog.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { listTriggerDefinitions, isKnownTrigger, getTriggerDefinition } from "../../automation-studio/triggerRegistry.js";
import { listActionDefinitions } from "../../automation-studio/actionLibrary.js";
import { listTemplates, getTemplate } from "../../automation-studio/templates.js";
import { runFlow } from "../../automation-studio/automationEventBus.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";

function serializeFlow(flow) {
  const obj = flow.toObject ? flow.toObject() : flow;
  return {
    ...obj,
    triggerLabel: getTriggerDefinition(obj.triggerType)?.label || obj.triggerType,
  };
}

function assertActionTypesValid(actions) {
  const valid = new Set(listActionDefinitions().map((a) => a.type));
  for (const step of actions || []) {
    if (!valid.has(step.type)) throw new AppError(`Unknown action type "${step.type}".`, 400);
    if (!step.id) throw new AppError("Every action step needs an id.", 400);
  }
}

// ─────────────────────────────────────── Studio Home / Dashboard

// PHASE UI-13: extracted from getStudioHome's body (unchanged logic) so the
// new Process/Automation/Governance Command Center can reuse the exact same
// automation health computation instead of re-querying AutomationFlow/
// AutomationRunLog a second time. getStudioHome below is now a thin
// req/res wrapper around this pure builder — no behavior change.
export async function buildAutomationStudioHome() {
  const [statusCounts, categoryCounts, recentRuns, topFlowsByRuns] = await Promise.all([
    AutomationFlow.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    AutomationFlow.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
    AutomationRunLog.find({ dryRun: false }).sort({ createdAt: -1 }).limit(20).populate("flowId", "name triggerType").lean(),
    AutomationFlow.find({ status: "published" }).sort({ "stats.totalRuns": -1 }).limit(5).select("name triggerType stats category").lean(),
  ]);

  const byStatus = { draft: 0, published: 0, archived: 0 };
  for (const row of statusCounts) byStatus[row._id] = row.count;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [executionsToday, failuresLast7d, totalLast7d] = await Promise.all([
    AutomationRunLog.countDocuments({ dryRun: false, createdAt: { $gte: todayStart } }),
    AutomationRunLog.countDocuments({ dryRun: false, status: "failed", createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    AutomationRunLog.countDocuments({ dryRun: false, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
  ]);

  const successRate = totalLast7d === 0 ? null : Math.round(((totalLast7d - failuresLast7d) / totalLast7d) * 1000) / 10;

  // Automation Health Score: transparent, documented formula — same
  // "explainable, never a black box" style as Platform Health Center's
  // score. 100 minus a penalty for recent failures, floored at 0.
  const healthScore = successRate === null ? 100 : Math.max(0, Math.round(100 - (failuresLast7d / Math.max(totalLast7d, 1)) * 100));

  return {
    cards: {
      running: 0, // no long-running/async executions exist — every run is synchronous and finishes before the trigger's own request returns
      published: byStatus.published,
      draft: byStatus.draft,
      archived: byStatus.archived,
      failedLast7d: failuresLast7d,
      executionsToday,
      successRate7d: successRate,
      healthScore,
    },
    categoryCounts: categoryCounts.map((row) => ({ category: row._id, count: row.count })),
    recentExecutions: recentRuns.map((run) => ({
      id: run._id,
      flowId: run.flowId?._id,
      flowName: run.flowId?.name || "(deleted flow)",
      triggerType: run.triggerType,
      status: run.status,
      durationMs: run.durationMs,
      createdAt: run.createdAt,
    })),
    topFlows: topFlowsByRuns,
  };
}

export const getStudioHome = asyncHandler(async (_req, res) => {
  const data = await buildAutomationStudioHome();
  res.json({ success: true, data });
});

// ─────────────────────────────────────── Trigger / Action Library

export const getTriggerLibrary = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: listTriggerDefinitions() });
});

export const getActionLibrary = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: listActionDefinitions() });
});

export const getTemplateLibrary = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: listTemplates() });
});

// ─────────────────────────────────────── Flow CRUD

// PHASE UI-13 hardening (A1): flow listing was previously unbounded — every
// AutomationFlow document was fetched and rendered in one shot regardless
// of how many exist. Now bounded/server-side: page + pageSize are
// clamped (never trusted from the client — A4), and the response carries
// standard pagination meta the frontend renders Prev/Next controls from,
// the same shape AdminOperationsCenter.jsx already established (UI-10).
export const listFlows = asyncHandler(async (req, res) => {
  const { status, category, triggerType, search, favorite, page, pageSize } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (triggerType) filter.triggerType = triggerType;
  if (favorite === "true") filter.isFavorite = true;
  if (search) filter.$text = { $search: search };

  const total = await AutomationFlow.countDocuments(filter);
  const { page: safePage, pageSize: safePageSize, skip } = clampPagination(page, pageSize, { total });

  const flows = await AutomationFlow.find(filter)
    .sort({ isPinned: -1, updatedAt: -1 })
    .skip(skip)
    .limit(safePageSize)
    .lean();

  res.json({
    success: true,
    data: flows.map(serializeFlow),
    meta: buildPaginationMeta(safePage, safePageSize, total),
  });
});

export const getFlow = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid flow id", 400);
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  res.json({ success: true, data: serializeFlow(flow) });
});

export const createFlow = asyncHandler(async (req, res) => {
  const { name, description, category, tags, triggerType, conditions, actions, sourceTemplateKey } = req.body;
  if (!name) throw new AppError("Name is required", 400);
  if (!triggerType || !isKnownTrigger(triggerType)) throw new AppError("A valid, registered triggerType is required", 400);
  assertActionTypesValid(actions);

  const flow = await AutomationFlow.create({
    name,
    description,
    category,
    tags,
    triggerType,
    conditions: conditions || null,
    actions: actions || [],
    sourceTemplateKey: sourceTemplateKey || null,
    createdBy: req.user._id,
  });

  await writeAdminLog({ req, action: "automation.flow_create", resourceType: "AutomationFlow", resourceId: flow._id.toString() });
  res.status(201).json({ success: true, data: serializeFlow(flow) });
});

export const createFlowFromTemplate = asyncHandler(async (req, res) => {
  const template = getTemplate(req.params.templateKey);
  if (!template) throw new AppError("Template not found", 404);

  const flow = await AutomationFlow.create({
    name: req.body.name || template.name,
    description: template.description,
    category: template.category,
    triggerType: template.triggerType,
    conditions: template.conditions,
    actions: template.actions,
    sourceTemplateKey: template.key,
    createdBy: req.user._id,
  });

  await writeAdminLog({ req, action: "automation.flow_create_from_template", resourceType: "AutomationFlow", resourceId: flow._id.toString(), metadata: { templateKey: template.key } });
  res.status(201).json({ success: true, data: serializeFlow(flow) });
});

export const updateFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  if (flow.status === "archived") throw new AppError("Archived flows cannot be edited — clone it into a new draft instead.", 409);

  const { name, description, category, tags, triggerType, conditions, actions } = req.body;
  if (triggerType && !isKnownTrigger(triggerType)) throw new AppError("Unknown triggerType", 400);
  if (actions) assertActionTypesValid(actions);

  if (name !== undefined) flow.name = name;
  if (description !== undefined) flow.description = description;
  if (category !== undefined) flow.category = category;
  if (tags !== undefined) flow.tags = tags;
  if (triggerType !== undefined) flow.triggerType = triggerType;
  if (conditions !== undefined) flow.conditions = conditions;
  if (actions !== undefined) flow.actions = actions;
  flow.updatedBy = req.user._id;

  // Editing a published flow silently would defeat the whole point of
  // versioning — send it back to draft so a rollback is always available
  // and the next Publish captures a fresh, deliberate snapshot.
  if (flow.status === "published") flow.status = "draft";

  await flow.save();
  await writeAdminLog({ req, action: "automation.flow_update", resourceType: "AutomationFlow", resourceId: flow._id.toString() });
  res.json({ success: true, data: serializeFlow(flow) });
});

export const publishFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  if (flow.status === "archived") throw new AppError("Archived flows cannot be published — clone it first.", 409);
  if (!flow.actions?.length) throw new AppError("A flow needs at least one action before it can be published.", 400);

  flow.version += 1;
  flow.versionHistory.push({
    version: flow.version,
    trigger: flow.triggerType,
    conditions: flow.conditions,
    actions: flow.actions,
    publishedBy: req.user._id,
    publishedAt: new Date(),
    changeNote: req.body.changeNote || "",
  });
  flow.status = "published";
  flow.publishedBy = req.user._id;
  flow.publishedAt = new Date();
  await flow.save();

  await writeAdminLog({ req, action: "automation.flow_publish", resourceType: "AutomationFlow", resourceId: flow._id.toString(), metadata: { version: flow.version } });
  res.json({ success: true, data: serializeFlow(flow) });
});

export const archiveFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  flow.status = "archived";
  flow.archivedBy = req.user._id;
  flow.archivedAt = new Date();
  await flow.save();
  await writeAdminLog({ req, action: "automation.flow_archive", resourceType: "AutomationFlow", resourceId: flow._id.toString(), severity: "warning" });
  res.json({ success: true, data: serializeFlow(flow) });
});

export const restoreFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  if (flow.status !== "archived") throw new AppError("Only archived flows can be restored.", 409);
  flow.status = "draft";
  flow.archivedBy = undefined;
  flow.archivedAt = undefined;
  await flow.save();
  await writeAdminLog({ req, action: "automation.flow_restore", resourceType: "AutomationFlow", resourceId: flow._id.toString() });
  res.json({ success: true, data: serializeFlow(flow) });
});

export const cloneFlow = asyncHandler(async (req, res) => {
  const source = await AutomationFlow.findById(req.params.id);
  if (!source) throw new AppError("Automation flow not found", 404);

  const clone = await AutomationFlow.create({
    name: `${source.name} (Copy)`,
    description: source.description,
    category: source.category,
    tags: source.tags,
    triggerType: source.triggerType,
    conditions: source.conditions,
    actions: source.actions,
    sourceTemplateKey: source.sourceTemplateKey,
    createdBy: req.user._id,
  });

  await writeAdminLog({ req, action: "automation.flow_clone", resourceType: "AutomationFlow", resourceId: clone._id.toString(), metadata: { sourceFlowId: source._id.toString() } });
  res.status(201).json({ success: true, data: serializeFlow(clone) });
});

export const rollbackFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  const targetVersion = Number(req.body.version);
  const snapshot = flow.versionHistory.find((v) => v.version === targetVersion);
  if (!snapshot) throw new AppError(`Version ${targetVersion} not found in this flow's history.`, 404);

  flow.triggerType = snapshot.trigger;
  flow.conditions = snapshot.conditions;
  flow.actions = snapshot.actions;
  flow.status = "draft"; // rolling back restores the DEFINITION as a fresh draft — an explicit Publish is still required, never silently re-publishes
  flow.updatedBy = req.user._id;
  await flow.save();

  await writeAdminLog({ req, action: "automation.flow_rollback", resourceType: "AutomationFlow", resourceId: flow._id.toString(), metadata: { restoredVersion: targetVersion } });
  res.json({ success: true, data: serializeFlow(flow) });
});

export const compareVersions = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id).lean();
  if (!flow) throw new AppError("Automation flow not found", 404);
  const versionA = flow.versionHistory.find((v) => v.version === Number(req.query.a));
  const versionB = flow.versionHistory.find((v) => v.version === Number(req.query.b));
  if (!versionA || !versionB) throw new AppError("Both versions must exist in this flow's history.", 404);
  res.json({ success: true, data: { a: versionA, b: versionB } });
});

export const pinFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  flow.isPinned = Boolean(req.body.pinned);
  await flow.save();
  res.json({ success: true, data: serializeFlow(flow) });
});

export const favoriteFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  flow.isFavorite = Boolean(req.body.favorite);
  await flow.save();
  res.json({ success: true, data: serializeFlow(flow) });
});

export const deleteFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  // Protected Delete (brief Security section): only a never-published draft
  // with zero run history can be hard-deleted. Anything with real history
  // must be archived instead, so execution history/audit trail is never
  // silently lost.
  const hasRun = await AutomationRunLog.exists({ flowId: flow._id });
  if (flow.status !== "draft" || flow.versionHistory.length > 0 || hasRun) {
    throw new AppError("Only a never-published draft with no run history can be deleted. Archive it instead.", 409);
  }
  await flow.deleteOne();
  await writeAdminLog({ req, action: "automation.flow_delete", resourceType: "AutomationFlow", resourceId: req.params.id, severity: "warning" });
  res.json({ success: true, message: "Flow deleted." });
});

// ─────────────────────────────────────── Execution Simulator + History

export const simulateFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id);
  if (!flow) throw new AppError("Automation flow not found", 404);
  const samplePayload = req.body.samplePayload || {};

  const result = await runFlow(flow, samplePayload, { dryRun: true, triggeredBy: "simulator", actorId: req.user._id });
  res.json({ success: true, data: result });
});

export const getFlowRunHistory = asyncHandler(async (req, res) => {
  const runs = await AutomationRunLog.find({ flowId: req.params.id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, data: runs });
});

// ─────────────────────────────────────── Inspector

export const getFlowInspector = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id).lean();
  if (!flow) throw new AppError("Automation flow not found", 404);

  const [relatedFlows, recentRuns] = await Promise.all([
    AutomationFlow.find({ triggerType: flow.triggerType, _id: { $ne: flow._id } }).select("name status stats").limit(10).lean(),
    AutomationRunLog.find({ flowId: flow._id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const triggerDef = getTriggerDefinition(flow.triggerType);
  const successPct = flow.stats.totalRuns ? Math.round((flow.stats.successCount / flow.stats.totalRuns) * 1000) / 10 : null;
  const failurePct = flow.stats.totalRuns ? Math.round((flow.stats.failureCount / flow.stats.totalRuns) * 1000) / 10 : null;

  res.json({
    success: true,
    data: {
      flow: serializeFlow(flow),
      trigger: triggerDef,
      usedActionTypes: [...new Set((flow.actions || []).map((a) => a.type))],
      relatedFlows,
      recentRuns,
      successPct,
      failurePct,
      consumers: [], // no other module in this codebase reads an AutomationFlow document directly yet — honestly empty rather than fabricated
    },
  });
});

// ─────────────────────────────────────── AI Workflow Builder

export const explainFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id).lean();
  if (!flow) throw new AppError("Automation flow not found", 404);
  const result = await generativeAssistant.automationFlowExplain({
    flowName: flow.name,
    triggerType: flow.triggerType,
    triggerLabel: getTriggerDefinition(flow.triggerType)?.label,
    conditions: flow.conditions,
    actions: flow.actions,
  });
  res.json({ success: true, data: result });
});

export const advisorFlow = asyncHandler(async (req, res) => {
  const flow = await AutomationFlow.findById(req.params.id).lean();
  if (!flow) throw new AppError("Automation flow not found", 404);
  const result = await generativeAssistant.automationFlowAdvisor({
    flowName: flow.name,
    triggerType: flow.triggerType,
    conditions: flow.conditions,
    actions: flow.actions,
    stats: flow.stats,
  });
  res.json({ success: true, data: result });
});

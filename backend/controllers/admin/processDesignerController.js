// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Every write endpoint reuses the existing requireAdmin/
// requirePermission("manage_settings") gate — no new roles/permissions
// invented (same discipline as every prior Operations/Workflow/Assignment/
// Automation Studio phase). See routes/admin/processDesignerRoutes.js.
// ─────────────────────────────────────────────────────────────────────────

import ProcessDefinition from "../../models/ProcessDefinition.js";
import AutomationRunLog from "../../models/AutomationRunLog.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { getNodeRegistry, checkNodeActionType } from "../../process-designer/nodeRegistry.js";
import { validateProcessGraph } from "../../process-designer/graphValidator.js";
import { assessProcessRisk } from "../../process-designer/riskEngine.js";
import { analyzeProcessImpact } from "../../process-designer/impactAnalysis.js";
import { walkProcessGraph, buildProcessContext } from "../../process-designer/graphWalker.js";
import { isKnownTrigger } from "../../automation-studio/triggerRegistry.js";
import { evaluateGovernance } from "../../process-governance/processGovernanceEngine.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "process";
}

function serialize(doc) {
  return doc.toObject ? doc.toObject() : doc;
}

function assertNodesShape(nodes = []) {
  for (const node of nodes) {
    if (!node.id) throw new AppError("Every node needs an id.", 400);
    if (!node.type) throw new AppError(`Node "${node.id}" needs a type.`, 400);
  }
}

// ─────────────────────────────────────── Node Registry

export const getRegistry = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: getNodeRegistry() });
});

// ─────────────────────────────────────── Process Library

// PHASE UI-13 hardening (A7/A4): page/limit were previously trusted
// verbatim from the client (negative page -> negative skip -> a Mongo
// CastError; unbounded limit -> an effectively unbounded query) and the
// frontend never actually sent or rendered pagination at all, so a
// registry beyond one page was silently truncated with no way to see the
// rest. Both sides are now synchronized: page/pageSize are clamped
// server-side (never trusted), and standard pagination meta is returned
// for the frontend's Prev/Next controls.
export const listProcesses = asyncHandler(async (req, res) => {
  const { status, category, risk, owner, search, page, pageSize } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (risk) filter["lastRisk.level"] = risk;
  if (owner) filter.owner = owner;
  if (search) filter.$text = { $search: search };

  const total = await ProcessDefinition.countDocuments(filter);
  const { page: safePage, pageSize: safePageSize, skip } = clampPagination(page, pageSize, { total });

  const items = await ProcessDefinition.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(safePageSize).lean();

  res.json({ success: true, data: items, meta: buildPaginationMeta(safePage, safePageSize, total) });
});

export const getProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  res.json({ success: true, data: serialize(doc) });
});

export const getProcessVersions = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const versions = await ProcessDefinition.find({ key: doc.key }).sort({ version: -1 }).select("version status name updatedAt publishedAt activatedAt lastRisk.level").lean();
  res.json({ success: true, data: versions });
});

export const compareVersions = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const otherVersion = Number(req.query.withVersion);
  if (!otherVersion) throw new AppError("withVersion query param is required", 400);
  const other = await ProcessDefinition.findOne({ key: doc.key, version: otherVersion }).lean();
  if (!other) throw new AppError(`Version ${otherVersion} of "${doc.key}" not found`, 404);

  const diff = diffDefinitions(other, doc);
  res.json({ success: true, data: { from: { version: other.version, status: other.status }, to: { version: doc.version, status: doc.status }, diff } });
});

function diffDefinitions(from, to) {
  const fromNodes = new Map((from.nodes || []).map((n) => [n.id, n]));
  const toNodes = new Map((to.nodes || []).map((n) => [n.id, n]));
  const addedNodes = [...toNodes.keys()].filter((id) => !fromNodes.has(id));
  const removedNodes = [...fromNodes.keys()].filter((id) => !toNodes.has(id));
  const changedNodes = [...toNodes.keys()].filter((id) => fromNodes.has(id) && JSON.stringify(fromNodes.get(id)) !== JSON.stringify(toNodes.get(id)));

  const fromEdges = new Set((from.edges || []).map((e) => `${e.source}->${e.target}:${e.branch || ""}`));
  const toEdges = new Set((to.edges || []).map((e) => `${e.source}->${e.target}:${e.branch || ""}`));
  const addedEdges = [...toEdges].filter((e) => !fromEdges.has(e));
  const removedEdges = [...fromEdges].filter((e) => !toEdges.has(e));

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    riskChange: { from: from.lastRisk?.level || null, to: to.lastRisk?.level || null },
  };
}

// ─────────────────────────────────────── CRUD (draft-only mutation)

export const createProcess = asyncHandler(async (req, res) => {
  const { name, description, category, owner, nodes = [], edges = [] } = req.body;
  if (!name) throw new AppError("Name is required", 400);
  assertNodesShape(nodes);

  const key = req.body.key ? slugify(req.body.key) : slugify(name);
  const existing = await ProcessDefinition.findOne({ key });
  if (existing) throw new AppError(`Process key "${key}" already exists — choose a different name or key.`, 409);

  const doc = await ProcessDefinition.create({
    key,
    name,
    description,
    category,
    owner,
    nodes,
    edges,
    version: 1,
    status: "draft",
    createdBy: req.user._id,
  });

  await writeAdminLog({ req, action: "process_designer.create", resourceType: "ProcessDefinition", resourceId: doc._id.toString() });
  res.status(201).json({ success: true, data: serialize(doc) });
});

export const updateProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status === "archived") throw new AppError("Archived processes cannot be edited — clone it into a new draft instead.", 409);

  const { name, description, category, owner, nodes, edges } = req.body;
  if (nodes) assertNodesShape(nodes);

  // Section 2: "Never mutate an active version underneath a running
  // process... Editing an active/published process creates a new draft
  // version." A draft is mutated in place; anything else forks.
  if (doc.status === "draft") {
    if (name !== undefined) doc.name = name;
    if (description !== undefined) doc.description = description;
    if (category !== undefined) doc.category = category;
    if (owner !== undefined) doc.owner = owner;
    if (nodes !== undefined) doc.nodes = nodes;
    if (edges !== undefined) doc.edges = edges;
    doc.updatedBy = req.user._id;
    await doc.save();
    await writeAdminLog({ req, action: "process_designer.update_draft", resourceType: "ProcessDefinition", resourceId: doc._id.toString() });
    return res.json({ success: true, data: serialize(doc) });
  }

  const maxVersion = await ProcessDefinition.find({ key: doc.key }).sort({ version: -1 }).limit(1).select("version").lean();
  const nextVersion = (maxVersion[0]?.version || doc.version) + 1;

  const fork = await ProcessDefinition.create({
    key: doc.key,
    name: name !== undefined ? name : doc.name,
    description: description !== undefined ? description : doc.description,
    category: category !== undefined ? category : doc.category,
    owner: owner !== undefined ? owner : doc.owner,
    nodes: nodes !== undefined ? nodes : doc.nodes,
    edges: edges !== undefined ? edges : doc.edges,
    version: nextVersion,
    parentVersion: doc.version,
    status: "draft",
    createdBy: req.user._id,
  });

  await writeAdminLog({ req, action: "process_designer.fork_new_draft", resourceType: "ProcessDefinition", resourceId: fork._id.toString(), metadata: { forkedFrom: doc._id.toString(), fromVersion: doc.version, toVersion: nextVersion } });
  res.status(201).json({ success: true, data: serialize(fork), message: `Version ${doc.version} is immutable (status: ${doc.status}) — created new draft version ${nextVersion} instead.` });
});

export const deleteProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status !== "draft") throw new AppError("Only draft versions can be deleted — archive published/active versions instead.", 409);
  await doc.deleteOne();
  await writeAdminLog({ req, action: "process_designer.delete_draft", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), severity: "warning" });
  res.json({ success: true, data: { deleted: true } });
});

export const cloneProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const key = slugify(`${doc.key}_copy_${Date.now().toString(36)}`);

  const clone = await ProcessDefinition.create({
    key,
    name: `${doc.name} (Copy)`,
    description: doc.description,
    category: doc.category,
    owner: doc.owner,
    nodes: doc.nodes,
    edges: doc.edges,
    version: 1,
    status: "draft",
    createdBy: req.user._id,
  });

  await writeAdminLog({ req, action: "process_designer.clone", resourceType: "ProcessDefinition", resourceId: clone._id.toString(), metadata: { clonedFrom: doc._id.toString() } });
  res.status(201).json({ success: true, data: serialize(clone) });
});

// ─────────────────────────────────────── Validation / Risk

export const validateProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);

  const validation = validateProcessGraph({ nodes: doc.nodes, edges: doc.edges });
  const risk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });

  if (doc.status === "draft") {
    doc.lastValidation = { ...validation, computedAt: new Date() };
    doc.lastRisk = { level: risk.level, factors: risk.factors, computedAt: new Date() };
    doc.status = validation.valid ? "valid" : "draft";
    await doc.save();
  }

  res.json({ success: true, data: { validation, risk } });
});

// ─────────────────────────────────────── Simulation

export const simulateProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);

  const { triggerNodeId, scenarioPayload = {} } = req.body;
  const triggerNode = triggerNodeId
    ? (doc.nodes || []).find((n) => n.id === triggerNodeId && n.type === "trigger")
    : (doc.nodes || []).find((n) => n.type === "trigger");
  if (!triggerNode) throw new AppError("No trigger node found to simulate from.", 400);

  const payload = { ...scenarioPayload, triggerType: triggerNode.config?.triggerType, __simulation: true };
  const context = buildProcessContext(doc, payload);
  const startedAt = new Date();
  const result = await walkProcessGraph(doc, context, { dryRun: true, startNodeId: triggerNode.id });

  await AutomationRunLog.create({
    processDefinitionId: doc._id,
    processKey: doc.key,
    processVersion: doc.version,
    triggerType: triggerNode.config?.triggerType || "unknown",
    triggerPayload: scenarioPayload,
    dryRun: true,
    status: result.status === "success" ? "success" : result.status === "blocked" ? "blocked" : "failed",
    nodeTrace: result.nodeTrace,
    stepResults: result.stepResults,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    triggeredBy: "simulator",
    actorId: req.user._id,
  });

  res.json({ success: true, data: { ...result, banner: "SIMULATION — NO PRODUCTION DATA MUTATED" } });
});

export const getRunHistory = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const runs = await AutomationRunLog.find({ processDefinitionId: doc._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, data: runs });
});

// ─────────────────────────────────────── Impact Analysis

export const getImpact = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const impact = analyzeProcessImpact({ nodes: doc.nodes });
  res.json({ success: true, data: impact });
});

// ─────────────────────────────────────── Lifecycle

// Phase A6.3.5 — extracted so the ungoverned direct-publish path below AND
// processGovernanceController.js#approveGovernance (which performs the
// actual publish once a governed process's approval is granted) share the
// exact same mutation — the publish snapshot logic itself is never
// duplicated, only gated differently depending on governance policy.
export function applyPublishMutation(doc, { validation, risk, actorId, changeNote = "" }) {
  doc.lastValidation = { ...validation, computedAt: new Date() };
  doc.lastRisk = { level: risk.level, factors: risk.factors, computedAt: new Date() };
  doc.versionHistory.push({
    version: doc.version,
    nodes: doc.nodes,
    edges: doc.edges,
    publishedBy: actorId,
    publishedAt: new Date(),
    changeNote,
    riskLevel: risk.level,
  });
  doc.status = "published";
  doc.publishedBy = actorId;
  doc.publishedAt = new Date();
  return doc;
}

export const publishProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (!["draft", "valid"].includes(doc.status)) throw new AppError(`Cannot publish a process in status "${doc.status}".`, 409);

  const validation = validateProcessGraph({ nodes: doc.nodes, edges: doc.edges });
  if (!validation.valid) throw new AppError("Cannot publish — process has validation errors.", 400, { errors: validation.errors });

  const risk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });

  // Phase A6.3.5 — Process Governance gate. AUDIT FINDING: this endpoint
  // previously published unconditionally for any risk level. Low/medium
  // risk processes are completely unaffected (Section 3: preserve existing
  // behavior) — only when governance policy requires approval for this
  // process's effective risk tier is direct publish blocked in favor of
  // the real submit-for-review -> approve flow (processGovernanceController.js).
  const hasSimulationEvidence = await AutomationRunLog.exists({ processDefinitionId: doc._id, dryRun: true }).then(Boolean);
  const governance = await evaluateGovernance(doc, { risk, hasSimulationEvidence, openCriticalFindings: 0 });
  if (governance.approvalRequired) {
    throw new AppError(
      "Governance policy requires approval before this process can be published at its current risk tier. Submit it for governance review instead.",
      409,
      { governance },
    );
  }
  if (!governance.allowed) {
    throw new AppError("Cannot publish — governance controls are not satisfied.", 409, { governance });
  }

  applyPublishMutation(doc, { validation, risk, actorId: req.user._id, changeNote: req.body.changeNote });
  await doc.save();

  await writeAdminLog({ req, action: "process_designer.publish", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), metadata: { version: doc.version, riskLevel: risk.level } });
  res.json({ success: true, data: serialize(doc) });
});

export const activateProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (!["published", "paused"].includes(doc.status)) throw new AppError(`Cannot activate a process in status "${doc.status}".`, 409);

  const unsupported = (doc.nodes || []).filter((n) => n.type === "delay");
  if (unsupported.length) {
    throw new AppError("Cannot activate — process uses the unsupported Delay/Wait node type, which has no real backend dependency yet.", 409, { unsupportedNodeIds: unsupported.map((n) => n.id) });
  }

  const conflicting = await ProcessDefinition.findOne({ key: doc.key, status: "active", _id: { $ne: doc._id } });
  if (conflicting) {
    throw new AppError(`Version ${conflicting.version} of "${doc.key}" is already active. Pause it first — this system never runs two active versions of the same process.`, 409);
  }

  doc.status = "active";
  doc.activatedBy = req.user._id;
  doc.activatedAt = new Date();
  await doc.save();

  await writeAdminLog({ req, action: "process_designer.activate", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), metadata: { version: doc.version } });
  res.json({ success: true, data: serialize(doc) });
});

export const pauseProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status !== "active") throw new AppError(`Cannot pause a process in status "${doc.status}".`, 409);
  doc.status = "paused";
  doc.pausedBy = req.user._id;
  doc.pausedAt = new Date();
  await doc.save();
  await writeAdminLog({ req, action: "process_designer.pause", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), severity: "warning" });
  res.json({ success: true, data: serialize(doc) });
});

export const archiveProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status === "archived") throw new AppError("Already archived.", 409);
  doc.status = "archived";
  doc.archivedBy = req.user._id;
  doc.archivedAt = new Date();
  await doc.save();
  await writeAdminLog({ req, action: "process_designer.archive", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), severity: "warning" });
  res.json({ success: true, data: serialize(doc) });
});

// ─────────────────────────────────────── AI (grounded only)

export const explainProcess = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const validation = validateProcessGraph({ nodes: doc.nodes, edges: doc.edges });
  const risk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });
  const result = await generativeAssistant.processDesignExplain({
    name: doc.name,
    status: doc.status,
    version: doc.version,
    nodes: doc.nodes,
    edges: doc.edges,
    validation,
    risk,
  });
  res.json({ success: true, data: result });
});

export const explainSimulation = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const lastRun = await AutomationRunLog.findOne({ processDefinitionId: doc._id, dryRun: true }).sort({ createdAt: -1 }).lean();
  if (!lastRun) throw new AppError("No simulation has been run yet for this process.", 404);
  const result = await generativeAssistant.processSimulationExplain({
    name: doc.name,
    status: lastRun.status,
    nodeTrace: lastRun.nodeTrace,
    stepResults: lastRun.stepResults,
  });
  res.json({ success: true, data: result });
});

export const _internal = { diffDefinitions, slugify, checkNodeActionType, isKnownTrigger };

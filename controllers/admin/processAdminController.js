// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.1 — Enterprise Process Registry & Orchestration Core.
// Thin controller — every real computation lives in backend/process/*.js
// (Registry, Health, Orchestration Engine, Graph generation). This file
// only wires HTTP <-> those modules and the existing audit log, same
// pattern as every other admin controller in this codebase.
// ─────────────────────────────────────────────────────────────────────────

import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { listProcessDefinitions, getProcessDefinition, isKnownProcess, listProcessCategories } from "../../process/processRegistry.js";
import { computeProcessHealth, computeAllProcessHealth } from "../../process/processHealth.js";
import { getOrchestrationPlan, listOrchestrationRules } from "../../process/orchestrationEngine.js";
import {
  buildProcessDependencyGraphWithHealth,
  buildExecutionGraph,
  buildApprovalGraph,
  buildAutomationGraph,
  buildFailureGraph,
  buildImpactGraph,
  buildAllGraphs,
} from "../../process/processGraph.js";
import { listEventRegistry, getEventTrace, listDeadAndFailedEvents } from "../../process/eventOrchestration.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { buildProcessCommandCenter } from "../../services/commandCenter/processCommandCenterAggregates.js";

// ─────────────────────────────────────── PHASE UI-13 — Command Center
// Composition-only endpoint; see processCommandCenterAggregates.js for the
// audit note on why this exists and what it does (and does not) compute.
export const getCommandCenter = asyncHandler(async (_req, res) => {
  const data = await buildProcessCommandCenter();
  res.json({ success: true, data });
});

// ─────────────────────────────────────── 1. Registry
export const getRegistry = asyncHandler(async (req, res) => {
  const all = listProcessDefinitions();
  const health = await computeAllProcessHealth(all.map((p) => p.id));
  const data = all.map((p) => ({ ...p, health: health[p.id] }));
  res.json({ success: true, data: { processes: data, categories: listProcessCategories(), total: data.length } });
});

export const getProcessDetail = asyncHandler(async (req, res) => {
  const { processId } = req.params;
  if (!isKnownProcess(processId)) throw new AppError("Unknown process id", 404);
  const proc = getProcessDefinition(processId);
  const health = await computeProcessHealth(processId);
  res.json({ success: true, data: { ...proc, health } });
});

export const getProcessAiExplain = asyncHandler(async (req, res) => {
  const { processId } = req.params;
  if (!isKnownProcess(processId)) throw new AppError("Unknown process id", 404);
  const process = getProcessDefinition(processId);
  const health = await computeProcessHealth(processId);
  const result = await generativeAssistant.processExplain({ process, health });
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 2. Orchestration
export const getOrchestrationPlanForProcess = asyncHandler(async (req, res) => {
  const { processId } = req.params;
  if (!isKnownProcess(processId)) throw new AppError("Unknown process id", 404);
  const plan = await getOrchestrationPlan(processId);
  res.json({ success: true, data: plan });
});

export const getOrchestrationRules = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { rules: listOrchestrationRules(listProcessDefinitions()) } });
});

export const getOrchestrationAiAdvisor = asyncHandler(async (req, res) => {
  const { processId } = req.query;
  const plan = processId && isKnownProcess(processId) ? await getOrchestrationPlan(processId) : null;
  const { buildIntegrationHealth } = await import("../../process/integrationHub.js");
  const integrationHealth = await buildIntegrationHealth();
  const result = await generativeAssistant.orchestrationAdvisor({ plan, integrationHealth });
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 3. Graphs
export const getDependencyGraph = asyncHandler(async (_req, res) => {
  const data = await buildProcessDependencyGraphWithHealth();
  res.json({ success: true, data });
});

export const getExecutionGraphForProcess = asyncHandler(async (req, res) => {
  const { processId } = req.params;
  if (!isKnownProcess(processId)) throw new AppError("Unknown process id", 404);
  const data = await buildExecutionGraph(processId);
  res.json({ success: true, data });
});

export const getApprovalGraph = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await buildApprovalGraph() });
});

export const getAutomationGraph = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await buildAutomationGraph() });
});

export const getFailureGraph = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await buildFailureGraph() });
});

export const getAllGraphs = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await buildAllGraphs() });
});

// ─────────────────────────────────────── 4. Impact Analysis / Trace
export const getImpactAnalysis = asyncHandler(async (req, res) => {
  const { processId } = req.params;
  if (!isKnownProcess(processId)) throw new AppError("Unknown process id", 404);
  const impact = buildImpactGraph(processId);
  res.json({ success: true, data: impact });
});

export const getImpactAiExplain = asyncHandler(async (req, res) => {
  const { processId } = req.params;
  const { sourceId } = req.query;
  if (!isKnownProcess(processId)) throw new AppError("Unknown process id", 404);
  const impact = buildImpactGraph(processId);
  const trace = sourceId ? await getEventTrace(sourceId) : [];
  const result = await generativeAssistant.impactAnalysis({ impact, trace });
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 5. Event Registry / Explorer / Trace
export const getEventRegistry = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { events: listEventRegistry() } });
});

export const getTrace = asyncHandler(async (req, res) => {
  const { sourceId } = req.params;
  const events = await getEventTrace(sourceId);
  res.json({ success: true, data: { sourceId, events } });
});

export const getFailedEvents = asyncHandler(async (req, res) => {
  const lookbackDays = Math.min(Number(req.query.lookbackDays) || 7, 90);
  const data = await listDeadAndFailedEvents({ lookbackDays });
  res.json({ success: true, data });
});

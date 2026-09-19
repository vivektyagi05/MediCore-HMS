// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
//
// This controller is a thin HTTP layer only — every real computation lives
// in backend/workflow/intelligence/*. Nothing here re-queries a collection
// a module already queried; nothing here executes a healing action without
// going through selfHealingEngine.approveAndExecute(), which itself
// requires req.user (a real authenticated admin) as the approver.
// ─────────────────────────────────────────────────────────────────────────

import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { generatePredictions } from "../../workflow/intelligence/predictionEngine.js";
import { detectAnomalies } from "../../workflow/intelligence/anomalyDetector.js";
import { buildCapacityForecast } from "../../workflow/intelligence/capacityForecast.js";
import { generateOptimizationSuggestions } from "../../workflow/intelligence/optimizationEngine.js";
import { decideOnBatch } from "../../workflow/intelligence/decisionEngine.js";
import { listCapabilities } from "../../workflow/intelligence/intelligenceRegistry.js";
import {
  queueAction,
  approveAndExecute,
  rejectAction,
  listHealingQueue,
  isActionAllowed,
  ALLOWED_ACTIONS,
} from "../../workflow/intelligence/selfHealingEngine.js";

// ── Platform Intelligence Score ─────────────────────────────────────────
// Deterministic composite, never a hardcoded number: starts at 100 and
// subtracts real, disclosed penalties. Mirrors the same "starts at 100,
// subtracts explained penalties" pattern platformHealthAdminController.js
// (A5.2) already established for its own health score — same convention,
// new inputs.
function computeIntelligenceScore({ predictions, anomalies, healingQueue, optimization }) {
  const criticalPredictions = predictions.filter((p) => p.severity === "critical").length;
  const highPredictions = predictions.filter((p) => p.severity === "high").length;
  const criticalAnomalies = anomalies.filter((a) => a.severity === "critical").length;
  const highAnomalies = anomalies.filter((a) => a.severity === "high").length;
  const pendingHealingActions = healingQueue.filter((q) => q.status === "pending_approval").length;
  const failedHealingActions = healingQueue.filter((q) => q.status === "failed").length;
  const optimizationSuggestions = optimization.totalSuggestions;

  let score = 100;
  score -= criticalPredictions * 10;
  score -= highPredictions * 5;
  score -= criticalAnomalies * 10;
  score -= highAnomalies * 5;
  score -= failedHealingActions * 4;
  score -= Math.min(10, optimizationSuggestions); // capped — optimization backlog is lower-urgency than live predictions/anomalies
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    breakdown: {
      criticalPredictions,
      highPredictions,
      criticalAnomalies,
      highAnomalies,
      pendingHealingActions,
      failedHealingActions,
      optimizationSuggestions,
    },
  };
}

// ── GET /overview ────────────────────────────────────────────────────────
export const getIntelligenceOverview = asyncHandler(async (_req, res) => {
  const [predictions, anomalies, capacityForecast, optimization, healingQueue] = await Promise.all([
    generatePredictions(),
    detectAnomalies(),
    buildCapacityForecast(),
    generateOptimizationSuggestions(),
    listHealingQueue(),
  ]);

  const { score, breakdown } = computeIntelligenceScore({ predictions, anomalies, healingQueue, optimization });

  res.status(200).json({
    success: true,
    data: {
      intelligenceScore: score,
      scoreBreakdown: breakdown,
      predictions,
      anomalies,
      capacityForecast,
      optimization,
      healingQueue,
    },
    message: "Platform intelligence overview fetched successfully",
  });
});

export const getPredictions = asyncHandler(async (_req, res) => {
  const predictions = await generatePredictions();
  const decisions = decideOnBatch(predictions, "prediction");
  res.status(200).json({ success: true, data: { predictions, decisions }, message: "Predictions fetched successfully" });
});

export const getAnomalies = asyncHandler(async (_req, res) => {
  const anomalies = await detectAnomalies();
  const decisions = decideOnBatch(anomalies, "anomaly");
  res.status(200).json({ success: true, data: { anomalies, decisions }, message: "Anomalies fetched successfully" });
});

export const getCapacityForecast = asyncHandler(async (_req, res) => {
  const forecast = await buildCapacityForecast();
  res.status(200).json({ success: true, data: forecast, message: "Capacity forecast fetched successfully" });
});

export const getOptimizationSuggestions = asyncHandler(async (_req, res) => {
  const optimization = await generateOptimizationSuggestions();
  res.status(200).json({ success: true, data: optimization, message: "Optimization suggestions fetched successfully" });
});

export const getIntelligenceRegistry = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, data: listCapabilities(), message: "Intelligence registry fetched successfully" });
});

// ── Self-Healing Queue ───────────────────────────────────────────────────
export const getHealingQueue = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const queue = await listHealingQueue({ status });
  res.status(200).json({ success: true, data: queue, message: "Self-healing queue fetched successfully" });
});

export const postQueueHealingAction = asyncHandler(async (req, res) => {
  const { actionKey, trigger, params } = req.body;
  if (!isActionAllowed(actionKey)) {
    throw new AppError(`"${actionKey}" is not an allowed self-healing action.`, 400);
  }
  const log = await queueAction({ actionKey, trigger, params });
  await writeAdminLog({
    req,
    action: "intelligence.healing.queue",
    resourceType: "IntelligenceActionLog",
    resourceId: log._id,
    severity: "info",
    metadata: { actionKey, trigger },
  });
  res.status(201).json({ success: true, data: log, message: "Self-healing action queued for approval" });
});

export const postApproveHealingAction = asyncHandler(async (req, res) => {
  const { actionLogId } = req.params;
  const log = await approveAndExecute(actionLogId, req.user._id);
  await writeAdminLog({
    req,
    action: "intelligence.healing.approve_execute",
    resourceType: "IntelligenceActionLog",
    resourceId: log._id,
    severity: log.status === "failed" ? "warning" : "info",
    metadata: { actionKey: log.actionKey, status: log.status },
  });
  res.status(200).json({ success: true, data: log, message: `Self-healing action ${log.status}` });
});

export const postRejectHealingAction = asyncHandler(async (req, res) => {
  const { actionLogId } = req.params;
  const { reason } = req.body;
  const log = await rejectAction(actionLogId, req.user._id, reason);
  await writeAdminLog({
    req,
    action: "intelligence.healing.reject",
    resourceType: "IntelligenceActionLog",
    resourceId: log._id,
    severity: "info",
    metadata: { actionKey: log.actionKey, reason },
  });
  res.status(200).json({ success: true, data: log, message: "Self-healing action rejected" });
});

export const getAllowedHealingActions = asyncHandler(async (_req, res) => {
  const data = Object.entries(ALLOWED_ACTIONS).map(([key, def]) => ({
    key,
    label: def.label,
    requiresParam: def.requiresParam,
    rollbackPossible: def.rollbackPossible,
    rollbackNote: def.rollbackNote,
    safetyPolicy: def.safetyPolicy,
  }));
  res.status(200).json({ success: true, data, message: "Allowed self-healing actions fetched successfully" });
});

// ── AI explain/advisor endpoints (Step 11) ──────────────────────────────
export const explainPrediction = asyncHandler(async (req, res) => {
  const predictions = await generatePredictions();
  const prediction = predictions.find((p) => p.id === req.params.predictionId);
  if (!prediction) throw new AppError("Prediction not found (it may no longer be active).", 404);
  const result = await generativeAssistant.predictionExplain(prediction);
  res.status(200).json({ success: true, data: result, message: "Prediction explanation generated" });
});

export const explainAnomaly = asyncHandler(async (req, res) => {
  const anomalies = await detectAnomalies();
  const anomaly = anomalies.find((a) => a.id === req.params.anomalyId);
  if (!anomaly) throw new AppError("Anomaly not found (it may no longer be active).", 404);
  const result = await generativeAssistant.anomalyExplain(anomaly);
  res.status(200).json({ success: true, data: result, message: "Anomaly explanation generated" });
});

export const getCapacityAiAdvisor = asyncHandler(async (_req, res) => {
  const forecast = await buildCapacityForecast();
  const result = await generativeAssistant.capacityAdvisor(forecast);
  res.status(200).json({ success: true, data: result, message: "Capacity advisor summary generated" });
});

export const getOptimizationAiAdvisor = asyncHandler(async (_req, res) => {
  const optimization = await generateOptimizationSuggestions();
  const result = await generativeAssistant.optimizationAdvisor(optimization);
  res.status(200).json({ success: true, data: result, message: "Optimization advisor summary generated" });
});

export const getSelfHealingAiAdvisor = asyncHandler(async (_req, res) => {
  const queue = await listHealingQueue();
  const result = await generativeAssistant.selfHealingAdvisor({ queue });
  res.status(200).json({ success: true, data: result, message: "Self-healing advisor summary generated" });
});

export const getPlatformIntelligenceAiSummary = asyncHandler(async (_req, res) => {
  const [predictions, anomalies, healingQueue, optimization] = await Promise.all([
    generatePredictions(),
    detectAnomalies(),
    listHealingQueue(),
    generateOptimizationSuggestions(),
  ]);
  const { score, breakdown } = computeIntelligenceScore({ predictions, anomalies, healingQueue, optimization });
  const result = await generativeAssistant.platformIntelligenceSummary({ score, breakdown });
  res.status(200).json({ success: true, data: result, message: "Platform intelligence summary generated" });
});

export const _internal = { computeIntelligenceScore };

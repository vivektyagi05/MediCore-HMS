// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.2 — Cross-System Integration Hub.
// Thin controller — real computation lives in backend/process/integrationHub.js
// and backend/process/eventOrchestration.js.
// ─────────────────────────────────────────────────────────────────────────

import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { discoverIntegrationEdges, buildIntegrationHealth, buildConnectedDisconnectedModules, buildLiveTrafficSummary } from "../../process/integrationHub.js";
import { listDeadAndFailedEvents } from "../../process/eventOrchestration.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";

export const getIntegrations = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { edges: discoverIntegrationEdges() } });
});

export const getIntegrationHealth = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { edges: await buildIntegrationHealth() } });
});

export const getConnectedDisconnected = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await buildConnectedDisconnectedModules() });
});

export const getLiveTraffic = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { edges: await buildLiveTrafficSummary() } });
});

export const getDeadEvents = asyncHandler(async (req, res) => {
  const lookbackDays = Math.min(Number(req.query.lookbackDays) || 7, 90);
  res.json({ success: true, data: await listDeadAndFailedEvents({ lookbackDays }) });
});

export const explainIntegrationEdge = asyncHandler(async (req, res) => {
  const { edgeId } = req.params;
  const health = await buildIntegrationHealth();
  const edge = health.find((e) => e.id === edgeId);
  if (!edge) throw new AppError("Unknown integration edge", 404);
  const result = await generativeAssistant.integrationExplain({ edge });
  res.json({ success: true, data: result });
});

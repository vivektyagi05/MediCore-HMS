// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
// Real Execution Bridge (brief Section 13 + 15): "Do NOT create a new
// executor... Use the SAME existing workflowEventBus. Never create another
// EventEmitter." automation-studio/automationEventBus.js IS that shared
// event bus (it already fans real domain events out to AutomationFlow
// runs) — this module is called FROM INSIDE it, additively, rather than
// standing up a second subscriber list.
//
// The Designer is a control plane; this bridge is the only place a
// PUBLISHED+ACTIVE ProcessDefinition ever actually runs against production
// data, and it runs through the exact same walkProcessGraph() the
// Simulation Engine uses with dryRun:false.
// ─────────────────────────────────────────────────────────────────────────

import ProcessDefinition from "../models/ProcessDefinition.js";
import AutomationRunLog from "../models/AutomationRunLog.js";
import { walkProcessGraph, buildProcessContext } from "./graphWalker.js";
import { logger } from "../utils/logger.js";

async function updateProcessStats(definition, { status }) {
  const inc = {};
  if (status === "success") inc["stats.successCount"] = 1;
  else if (status === "failed") inc["stats.failureCount"] = 1;
  else if (status === "blocked") inc["stats.blockedCount"] = 1;
  await ProcessDefinition.findByIdAndUpdate(definition._id, {
    $set: { "stats.lastRunAt": new Date(), "stats.lastRunStatus": status },
    $inc: { "stats.totalRuns": 1, ...inc },
  });
}

/**
 * Called from automationEventBus.js#emitAutomationTrigger alongside its
 * own AutomationFlow lookup. Finds every ACTIVE ProcessDefinition with a
 * Trigger node subscribed to this exact trigger type and runs each one
 * independently — one process failing must never stop a sibling process
 * or the AutomationFlow runs already in progress for this same event
 * (same per-item isolation principle as automation/cronJobs.js and
 * automationEventBus.js's own flow loop).
 */
export async function runActiveProcessesForTrigger(triggerType, payload = {}) {
  let definitions;
  try {
    definitions = await ProcessDefinition.find({
      status: "active",
      nodes: { $elemMatch: { type: "trigger", "config.triggerType": triggerType } },
    }).lean();
  } catch (error) {
    logger.error("processExecutionBridge: failed to look up active processes", { triggerType, message: error?.message });
    return;
  }
  if (!definitions.length) return;

  for (const definition of definitions) {
    const startedAt = new Date();
    try {
      const context = buildProcessContext(definition, { ...payload, triggerType });
      const result = await walkProcessGraph(definition, context, { dryRun: false });
      const status = result.status === "success" ? "success" : result.status === "blocked" ? "blocked" : "failed";
      await AutomationRunLog.create({
        processDefinitionId: definition._id,
        processKey: definition.key,
        processVersion: definition.version,
        triggerType,
        triggerPayload: payload,
        dryRun: false,
        status,
        conditionsMatched: status !== "blocked",
        nodeTrace: result.nodeTrace,
        stepResults: result.stepResults,
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        triggeredBy: "event",
      });
      await updateProcessStats(definition, { status });
    } catch (error) {
      logger.error("Process Designer graph run failed", { processDefinitionId: definition._id, triggerType, message: error?.message });
    }
  }
}

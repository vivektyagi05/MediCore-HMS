// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
// This is the ONE place a published AutomationFlow actually runs. It is
// deliberately separate from backend/workflow/workflowEngine.js:
//   - workflowEngine.js executes a FIXED lifecycle (claim/assign/escalate/
//     resolve/cancel/pin) for the 10 hard-coded Operation Registry types.
//   - This module executes a VARIABLE, admin-authored trigger->condition->
//     action definition (AutomationFlow) for any of the 14 real triggers in
//     triggerRegistry.js.
// Neither duplicates the other's job. Where a flow's action needs to touch
// the fixed lifecycle (e.g. an escalate action against a real operation
// item), actionExecutor.js calls INTO workflowEngine.executeWorkflowTransition
// rather than re-implementing it — see actionExecutor.js#runWorkflowEscalate.
//
// Every domain controller that fires a trigger calls emitAutomationTrigger()
// AFTER its own real business logic has already completed and been
// persisted (see the wiredAt locations in triggerRegistry.js) — this module
// never sits in the critical path of the original request; it is invoked
// fire-and-forget (awaited, but failures never propagate back to the
// caller — same "monitoring must never break the thing it monitors"
// principle as cronRunTracker.js).
// ─────────────────────────────────────────────────────────────────────────

import AutomationFlow from "../models/AutomationFlow.js";
import AutomationRunLog from "../models/AutomationRunLog.js";
import { isKnownTrigger, getTriggerDefinition } from "./triggerRegistry.js";
import { evaluateConditions } from "./conditionEvaluator.js";
import { runActionStep } from "./actionExecutor.js";
import { logger } from "../utils/logger.js";
import { _internal as operationsInternal } from "../controllers/admin/operationsAdminController.js";
// Phase A6.3.3 — Enterprise Process Designer. Additive only: this is the
// SAME event entry point every domain controller already calls via
// emitAutomationTrigger(); it is never a second event bus. See
// process-designer/processExecutionBridge.js's own header for why this is
// called from here rather than a parallel subscriber.
import { runActiveProcessesForTrigger } from "../process-designer/processExecutionBridge.js";

async function updateFlowStats(flow, { status, durationMs }) {
  const stats = flow.stats || {};
  const totalRuns = (stats.totalRuns || 0) + 1;
  const prevAvg = stats.avgDurationMs || 0;
  const avgDurationMs = Math.round((prevAvg * (totalRuns - 1) + durationMs) / totalRuns);

  await AutomationFlow.findByIdAndUpdate(flow._id, {
    $set: {
      "stats.totalRuns": totalRuns,
      "stats.lastRunAt": new Date(),
      "stats.lastRunStatus": status,
      "stats.avgDurationMs": avgDurationMs,
    },
    $inc: {
      "stats.successCount": status === "success" ? 1 : 0,
      "stats.failureCount": status === "failed" ? 1 : 0,
      "stats.skippedCount": status === "skipped" ? 1 : 0,
    },
  });
}

/**
 * Runs a single flow against a trigger context. Shared by both the real
 * event path (below) and the Execution Simulator (automationStudioController.js
 * calls this directly with dryRun: true and a synthetic-but-labeled sample
 * payload).
 */
export async function runFlow(flow, payload, { dryRun = false, triggeredBy = "event", actorId = null } = {}) {
  const startedAt = new Date();
  const triggerDef = getTriggerDefinition(flow.triggerType);
  const context = {
    ...payload,
    payload,
    triggerType: flow.triggerType,
    triggerLabel: triggerDef?.label,
    flowId: flow._id,
    flowName: flow.name,
    sourceId: payload?.sourceId || payload?.appointmentId || payload?.refundRequestId || payload?.insuranceId || payload?.reportId || payload?.paymentId || payload?.doctorId || payload?.userId,
    internal: operationsInternal,
  };

  const { matched, trace } = evaluateConditions(flow.conditions, context);

  if (!matched) {
    const durationMs = Date.now() - startedAt.getTime();
    await AutomationRunLog.create({
      flowId: flow._id,
      flowVersion: flow.version,
      triggerType: flow.triggerType,
      triggerPayload: payload,
      dryRun,
      status: "skipped",
      conditionsMatched: false,
      stepResults: [],
      startedAt,
      durationMs,
      triggeredBy,
      actorId,
    });
    if (!dryRun) await updateFlowStats(flow, { status: "skipped", durationMs });
    return { status: "skipped", reason: "conditions_not_met", conditionTrace: trace, stepResults: [] };
  }

  const stepResults = [];
  let anyFailed = false;
  for (const step of flow.actions || []) {
    const outcome = await runActionStep(step, context, { dryRun });
    stepResults.push(outcome);
    if (outcome.ok === false && !outcome.skipped) anyFailed = true;
  }

  const durationMs = Date.now() - startedAt.getTime();
  const status = anyFailed ? "failed" : "success";

  await AutomationRunLog.create({
    flowId: flow._id,
    flowVersion: flow.version,
    triggerType: flow.triggerType,
    triggerPayload: payload,
    dryRun,
    status,
    conditionsMatched: true,
    stepResults,
    startedAt,
    durationMs,
    triggeredBy,
    actorId,
  });
  if (!dryRun) await updateFlowStats(flow, { status, durationMs });

  return { status, conditionTrace: trace, stepResults };
}

/**
 * The real entry point every wired controller calls. Finds every PUBLISHED
 * flow subscribed to this trigger type and runs each one independently —
 * one flow failing must never stop a sibling flow from running (same
 * per-job isolation principle as automation/cronJobs.js).
 */
export async function emitAutomationTrigger(triggerType, payload = {}) {
  if (!isKnownTrigger(triggerType)) {
    logger.warn("emitAutomationTrigger called with an unregistered trigger type", { triggerType });
    return;
  }
  try {
    const flows = await AutomationFlow.find({ triggerType, status: "published" }).lean();
    for (const flow of flows) {
      try {
        await runFlow(flow, payload, { dryRun: false, triggeredBy: "event" });
      } catch (error) {
        logger.error("Automation Studio flow run failed", { flowId: flow._id, triggerType, message: error?.message });
      }
    }
    // Phase A6.3.3 — same real event, same best-effort isolation: a
    // Process Designer failure must never affect AutomationFlow runs
    // (already completed above) or the original request that fired this
    // trigger.
    await runActiveProcessesForTrigger(triggerType, payload);
  } catch (error) {
    // Best-effort, exactly like every notification/emitter call site in
    // this codebase — a failure here must never break the real business
    // transaction that already completed in the calling controller.
    logger.error("emitAutomationTrigger failed", { triggerType, message: error?.message });
  }
}

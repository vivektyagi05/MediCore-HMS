// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.4 — Enterprise Monitoring Platform.
//
// Every handler here is additive and read-mostly. The only write path is
// resolveDeadLetterPayment (marking a real exhausted-retry payment as
// reviewed), which is audited the same way every other admin resolve
// action in this codebase is. Nothing here re-runs a flow, re-executes a
// cron job, or duplicates workflowEngine.js/automationEventBus.js — see
// monitoringAggregates.js's header for the full audit note.
// ─────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import AutomationFlow from "../../models/AutomationFlow.js";
import AutomationRunLog from "../../models/AutomationRunLog.js";
import CronRunLog from "../../models/CronRunLog.js";
import Payment from "../../models/Payment.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { getTriggerDefinition } from "../../automation-studio/triggerRegistry.js";
import {
  buildLiveCounters,
  buildExecutionKPIs,
  buildPaymentRetryQueue,
  buildFlowHealthRanking,
  buildCronHealthRanking,
  buildPerformanceIntelligence,
  buildFailureIntelligence,
  buildDependencyFanout,
  buildTimelineFromRun,
} from "../../monitoring/monitoringAggregates.js";

function parseRangeDays(req) {
  const n = Number(req.query.rangeDays);
  if (!n || n <= 0) return 7;
  return Math.min(n, 90);
}

// ─────────────────────────────────────── 1. Monitoring Dashboard

export const getOverview = asyncHandler(async (req, res) => {
  const rangeDays = parseRangeDays(req);
  const [liveCounters, executionKPIs, flowHealth, cronHealth] = await Promise.all([
    buildLiveCounters(),
    buildExecutionKPIs({ rangeDays }),
    buildFlowHealthRanking(),
    buildCronHealthRanking(),
  ]);

  res.json({
    success: true,
    data: {
      liveCounters,
      executionKPIs,
      topFailingFlows: flowHealth.topFailing,
      topSlowFlows: flowHealth.topSlow,
      totalFlows: flowHealth.totalFlows,
      publishedFlows: flowHealth.publishedFlows,
      cronHealthyCount: cronHealth.healthyCount,
      cronTotalCount: cronHealth.totalCount,
    },
  });
});

export const getOverviewAiSummary = asyncHandler(async (_req, res) => {
  const [flowHealth, cronHealth] = await Promise.all([buildFlowHealthRanking(), buildCronHealthRanking()]);
  const withRuns = flowHealth.flows.filter((f) => f.totalRuns > 0);
  const avgSuccessRate = withRuns.length
    ? Math.round((withRuns.reduce((sum, f) => sum + (f.successRate || 0), 0) / withRuns.length) * 10) / 10
    : 0;
  const worstFlow = [...withRuns].sort((a, b) => (a.successRate ?? 100) - (b.successRate ?? 100))[0] || null;

  const result = await generativeAssistant.workflowHealthAdvisor({
    totalFlows: flowHealth.totalFlows,
    publishedFlows: flowHealth.publishedFlows,
    avgSuccessRate,
    worstFlow: worstFlow ? { name: worstFlow.name, successRate: worstFlow.successRate, totalRuns: worstFlow.totalRuns } : null,
    cronHealthy: cronHealth.healthyCount,
    cronTotal: cronHealth.totalCount,
  });
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 2. Execution Explorer

export const listExecutions = asyncHandler(async (req, res) => {
  const {
    source = "flow",
    status,
    triggerType,
    jobName,
    dryRun,
    flowId,
    search,
    from,
    to,
    page = 1,
    limit = 25,
  } = req.query;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 25));

  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  if (source === "cron") {
    const match = {};
    if (status) match.status = status;
    if (jobName) match.jobName = jobName;
    if (Object.keys(dateFilter).length) match.startedAt = dateFilter;

    const [rows, total] = await Promise.all([
      CronRunLog.find(match).sort({ startedAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      CronRunLog.countDocuments(match),
    ]);

    return res.json({
      success: true,
      data: rows.map((r) => ({
        id: r._id,
        source: "cron",
        name: r.jobName,
        triggerType: null,
        status: r.status,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        error: r.error,
      })),
      pagination: { page: pageNum, limit: limitNum, total },
    });
  }

  // source === "flow" (default) — the primary Execution Explorer surface.
  const match = {};
  if (status) match.status = status;
  if (triggerType) match.triggerType = triggerType;
  if (flowId && mongoose.isValidObjectId(flowId)) match.flowId = flowId;
  if (dryRun !== undefined) match.dryRun = dryRun === "true";
  if (Object.keys(dateFilter).length) match.startedAt = dateFilter;

  if (search) {
    const matchingFlows = await AutomationFlow.find({ name: { $regex: search, $options: "i" } }).select("_id").lean();
    const flowIdsForSearch = matchingFlows.map((f) => f._id);
    match.flowId = flowIdsForSearch.length ? { $in: flowIdsForSearch } : null; // null => guaranteed empty result
  }

  const [rows, total] = await Promise.all([
    AutomationRunLog.find(match)
      .populate("flowId", "name")
      .sort({ startedAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    AutomationRunLog.countDocuments(match),
  ]);

  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r._id,
      source: "flow",
      flowId: r.flowId?._id || r.flowId,
      name: r.flowId?.name || "(deleted flow)",
      triggerType: r.triggerType,
      triggerLabel: getTriggerDefinition(r.triggerType)?.label || r.triggerType,
      status: r.status,
      conditionsMatched: r.conditionsMatched,
      dryRun: r.dryRun,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      error: r.error,
    })),
    pagination: { page: pageNum, limit: limitNum, total },
  });
});

// ─────────────────────────────────────── 3/4. Execution Inspector + Timeline

async function loadExecutionOrThrow(id, source) {
  if (source === "cron") {
    const run = await CronRunLog.findById(id).lean();
    if (!run) throw new AppError("Cron run not found", 404);
    return { source: "cron", run };
  }
  const run = await AutomationRunLog.findById(id).populate("flowId", "name triggerType status stats").lean();
  if (!run) throw new AppError("Execution not found", 404);
  return { source: "flow", run };
}

export const getExecutionDetail = asyncHandler(async (req, res) => {
  const { source = "flow" } = req.query;
  const { run } = await loadExecutionOrThrow(req.params.id, source);

  if (source === "cron") {
    return res.json({
      success: true,
      data: { source: "cron", run, timeline: [
        { label: "Started", status: "info", at: run.startedAt },
        { label: run.status === "failed" ? "Failed" : run.status === "success" ? "Succeeded" : "Running", status: run.status, at: run.finishedAt, message: run.error || null },
      ] },
    });
  }

  const relatedRuns = await AutomationRunLog.find({ flowId: run.flowId?._id || run.flowId, _id: { $ne: run._id } })
    .sort({ startedAt: -1 })
    .limit(5)
    .select("status startedAt durationMs")
    .lean();

  res.json({
    success: true,
    data: {
      source: "flow",
      run,
      timeline: buildTimelineFromRun(run),
      relatedRuns,
    },
  });
});

export const explainExecution = asyncHandler(async (req, res) => {
  const { source = "flow" } = req.query;
  const { run } = await loadExecutionOrThrow(req.params.id, source);
  if (source === "cron") throw new AppError("AI explain is only available for flow executions.", 400);

  const result = await generativeAssistant.executionExplain({
    flowName: run.flowId?.name || "(deleted flow)",
    triggerLabel: getTriggerDefinition(run.triggerType)?.label || run.triggerType,
    status: run.status,
    conditionsMatched: run.conditionsMatched,
    stepResults: run.stepResults,
    durationMs: run.durationMs,
    error: run.error,
  });
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 7. Flow + Cron Health Center

export const getFlowHealth = asyncHandler(async (_req, res) => {
  const data = await buildFlowHealthRanking();
  res.json({ success: true, data });
});

export const getCronHealth = asyncHandler(async (_req, res) => {
  const data = await buildCronHealthRanking();
  res.json({ success: true, data });
});

// ─────────────────────────────────────── 8. Performance Intelligence

export const getPerformance = asyncHandler(async (req, res) => {
  const data = await buildPerformanceIntelligence({ rangeDays: parseRangeDays(req) });
  res.json({ success: true, data });
});

export const getPerformanceAiAdvisor = asyncHandler(async (req, res) => {
  const data = await buildPerformanceIntelligence({ rangeDays: parseRangeDays(req) });
  const result = await generativeAssistant.performanceAdvisor(data);
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 9. Failure Intelligence

export const getFailures = asyncHandler(async (req, res) => {
  const data = await buildFailureIntelligence({ rangeDays: parseRangeDays(req) });
  res.json({ success: true, data });
});

export const getFailuresAiExplain = asyncHandler(async (req, res) => {
  const data = await buildFailureIntelligence({ rangeDays: parseRangeDays(req) });
  const result = await generativeAssistant.failureExplain(data);
  res.json({ success: true, data: result });
});

// ─────────────────────────────────────── 10. Dependency Fan-out

export const getDependencyFanout = asyncHandler(async (_req, res) => {
  const data = await buildDependencyFanout();
  res.json({ success: true, data });
});

// ─────────────────────────────────────── Payment Retry Queue (real)

export const getRetryQueue = asyncHandler(async (_req, res) => {
  const data = await buildPaymentRetryQueue();
  res.json({ success: true, data });
});

export const getRetryQueueAiAdvisor = asyncHandler(async (_req, res) => {
  const data = await buildPaymentRetryQueue();
  const result = await generativeAssistant.retryAdvisor({
    inRetryWindow: data.inRetryWindowCount,
    deadLetter: data.deadLetterCount,
    maxRetries: data.maxRetries,
  });
  res.json({ success: true, data: result });
});

export const resolveDeadLetterPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId);
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.retryResolvedAt) throw new AppError("This payment has already been marked reviewed.", 409);

  payment.retryResolvedAt = new Date();
  payment.retryResolvedBy = req.user?._id;
  await payment.save();

  await writeAdminLog({
    req,
    action: "monitoring.payment_retry_resolved",
    resourceType: "Payment",
    resourceId: payment._id.toString(),
    severity: "warning",
    metadata: { retryCount: payment.retryCount, amount: payment.amount },
  });

  res.json({ success: true, message: "Payment marked reviewed and removed from the dead-letter queue." });
});

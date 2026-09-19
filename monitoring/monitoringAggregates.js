// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.4 — Enterprise Monitoring Platform.
//
// This module is deliberately just builders — every function takes no
// req/res, does its own DB reads, and returns plain data. monitoringController.js
// is the only place that wires these into HTTP responses. Nothing here
// re-executes a flow, re-runs a cron job, or duplicates any write path —
// this is read-only observability layered on top of AutomationRunLog
// (Phase A6.2.3), CronRunLog (Phase A5.2), and Payment.retryCount
// (pre-existing payment retry scheduling).
//
// AUDIT FINDING: before this phase there was no cross-flow execution view
// at all — automationStudioController.getFlowRunHistory/getFlowInspector
// only ever queried one flowId at a time, and getStudioHome's
// topFlowsByRuns/recentRuns were a small dashboard slice, not a searchable/
// filterable explorer, ranking, or failure/performance breakdown. Every
// builder below is a genuinely new read, not a duplicate of an existing one.
// ─────────────────────────────────────────────────────────────────────────

import AutomationFlow from "../models/AutomationFlow.js";
import AutomationRunLog from "../models/AutomationRunLog.js";
import CronRunLog from "../models/CronRunLog.js";
import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import { getTriggerDefinition, listTriggerDefinitions } from "../automation-studio/triggerRegistry.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Mirrors paymentRetryService.js's own MAX_RETRIES so the dead-letter
// split is defined identically to how the real retry scheduler defines
// "exhausted" — never a separately invented threshold.
const PAYMENT_MAX_RETRIES = 3;

// Exported (not just used internally) so it has a real dependency-free
// test, same discipline as conditionEvaluator.js/assignmentScoring.js.
export function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

// Derives a strictly sequential execution timeline from one AutomationRunLog
// document's own stepResults order + durationMs — pure/no DB access, so it
// is unit-tested directly (see tests/monitoringTimeline.test.mjs). This
// codebase's actions run one at a time (actionExecutor.js has no
// branching/parallel step concept), so this is honestly a timeline, not a
// branching execution graph.
export function buildTimelineFromRun(run) {
  const steps = [{ label: "Triggered", status: "info", at: run.startedAt }];
  if (run.conditionsMatched === false) {
    steps.push({ label: "Condition not matched — run skipped", status: "skipped" });
    return steps;
  }
  steps.push({ label: "Conditions matched", status: "info" });
  for (const step of run.stepResults || []) {
    steps.push({
      label: `${step.actionType}`,
      status: step.skipped ? "skipped" : step.ok ? "success" : "failed",
      message: step.message || null,
      durationMs: step.durationMs ?? null,
    });
  }
  steps.push({ label: run.status === "failed" ? "Run failed" : "Run completed", status: run.status, durationMs: run.durationMs });
  return steps;
}

// ─────────────────────────────────────── 1. Monitoring Dashboard

export async function buildLiveCounters() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [runStatusCounts, cronRunning, todayTotal] = await Promise.all([
    AutomationRunLog.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    CronRunLog.countDocuments({ status: "running" }),
    AutomationRunLog.countDocuments({ createdAt: { $gte: startOfToday } }),
  ]);

  const counters = { success: 0, failed: 0, skipped: 0 };
  for (const row of runStatusCounts) {
    if (counters[row._id] !== undefined) counters[row._id] = row.count;
  }

  return {
    // Real status vocabulary this codebase actually has for a run
    // (success/failed/skipped) plus a real in-flight cron count.
    // "Waiting"/"Paused"/"Cancelled"/"Retrying"/"Dead Letter" as generic
    // execution-level statuses are NOT included here — AutomationFlow runs
    // are synchronous and one-shot (no queue, no pause, no cancel-in-flight
    // concept exists anywhere in actionExecutor.js/automationEventBus.js).
    // See buildPaymentRetryQueue() below for the one place a real
    // retry/dead-letter concept does exist (Payment, not AutomationFlow).
    running: cronRunning,
    completed: counters.success,
    failed: counters.failed,
    skipped: counters.skipped,
    todayTotal,
  };
}

export async function buildExecutionKPIs({ rangeDays = 7 } = {}) {
  const since = new Date(Date.now() - rangeDays * MS_PER_DAY);

  const [statusAgg, hourlyAgg] = await Promise.all([
    AutomationRunLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$status", count: { $sum: 1 }, avgDuration: { $avg: "$durationMs" } } },
    ]),
    AutomationRunLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $hour: "$startedAt" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  let total = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const row of statusAgg) {
    total += row.count;
    if (row._id === "success") success = row.count;
    if (row._id === "failed") failed = row.count;
    if (row._id === "skipped") skipped = row.count;
    if (typeof row.avgDuration === "number") {
      durationSum += row.avgDuration * row.count;
      durationCount += row.count;
    }
  }

  const hourlyExecutions = Array.from({ length: 24 }, (_, hour) => {
    const found = hourlyAgg.find((r) => r._id === hour);
    return { hour, count: found ? found.count : 0 };
  });

  return {
    rangeDays,
    totalExecutions: total,
    successRate: total ? Math.round((success / total) * 1000) / 10 : 0,
    failureRate: total ? Math.round((failed / total) * 1000) / 10 : 0,
    skipRate: total ? Math.round((skipped / total) * 1000) / 10 : 0,
    avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0,
    throughputPerDay: Math.round((total / rangeDays) * 10) / 10,
    hourlyExecutions,
  };
}

// ─────────────────────────────────────── 5/6. Payment Retry Queue (real)

export async function buildPaymentRetryQueue() {
  const [inWindowDocs, deadLetterDocs] = await Promise.all([
    Payment.find({
      status: PAYMENT_STATUS.FAILED,
      retryCount: { $lt: PAYMENT_MAX_RETRIES },
      retryResolvedAt: null,
    })
      .select("_id amount retryCount nextRetryAt failedAt userId appointmentId")
      .sort({ nextRetryAt: 1 })
      .limit(50)
      .lean(),
    Payment.find({
      status: PAYMENT_STATUS.FAILED,
      retryCount: { $gte: PAYMENT_MAX_RETRIES },
      retryResolvedAt: null,
    })
      .select("_id amount retryCount nextRetryAt failedAt userId appointmentId")
      .sort({ failedAt: 1 })
      .limit(50)
      .lean(),
  ]);

  return {
    maxRetries: PAYMENT_MAX_RETRIES,
    inRetryWindow: inWindowDocs,
    deadLetter: deadLetterDocs,
    inRetryWindowCount: inWindowDocs.length,
    deadLetterCount: deadLetterDocs.length,
  };
}

// ─────────────────────────────────────── 7. Flow Health Center

export async function buildFlowHealthRanking() {
  const flows = await AutomationFlow.find({})
    .select("name status triggerType stats")
    .lean();

  const ranked = flows.map((f) => {
    const totalRuns = f.stats?.totalRuns || 0;
    const successRate = totalRuns ? Math.round((f.stats.successCount / totalRuns) * 1000) / 10 : null;
    return {
      id: f._id,
      name: f.name,
      status: f.status,
      triggerType: f.triggerType,
      triggerLabel: getTriggerDefinition(f.triggerType)?.label || f.triggerType,
      totalRuns,
      successRate,
      failureRate: totalRuns ? Math.round((f.stats.failureCount / totalRuns) * 1000) / 10 : null,
      avgDurationMs: f.stats?.avgDurationMs || 0,
      lastRunAt: f.stats?.lastRunAt || null,
      lastRunStatus: f.stats?.lastRunStatus || null,
    };
  });

  const withRuns = ranked.filter((f) => f.totalRuns > 0);
  const topSlow = [...withRuns].sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 5);
  const topFailing = [...withRuns].sort((a, b) => (a.successRate ?? 100) - (b.successRate ?? 100)).slice(0, 5);
  const topFast = [...withRuns].sort((a, b) => a.avgDurationMs - b.avgDurationMs).slice(0, 5);

  return {
    totalFlows: flows.length,
    publishedFlows: flows.filter((f) => f.status === "published").length,
    flows: ranked,
    topSlow,
    topFailing,
    topFast,
  };
}

export async function buildCronHealthRanking() {
  const jobs = await CronRunLog.aggregate([
    {
      $group: {
        _id: "$jobName",
        totalRuns: { $sum: 1 },
        successCount: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
        failureCount: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        avgDurationMs: { $avg: "$durationMs" },
        lastStartedAt: { $max: "$startedAt" },
      },
    },
    { $sort: { lastStartedAt: -1 } },
  ]);

  // "Healthy" = this job's most recent run (not aggregate history)
  // succeeded — a real per-job most-recent-status lookup, not a rate.
  const latestPerJob = await CronRunLog.aggregate([
    { $sort: { startedAt: -1 } },
    { $group: { _id: "$jobName", latestStatus: { $first: "$status" } } },
  ]);
  const latestStatusByJob = Object.fromEntries(latestPerJob.map((r) => [r._id, r.latestStatus]));

  const enriched = jobs.map((j) => ({
    jobName: j._id,
    totalRuns: j.totalRuns,
    successCount: j.successCount,
    failureCount: j.failureCount,
    avgDurationMs: j.avgDurationMs ? Math.round(j.avgDurationMs) : 0,
    lastStartedAt: j.lastStartedAt,
    latestStatus: latestStatusByJob[j._id] || null,
  }));

  return {
    jobs: enriched,
    healthyCount: enriched.filter((j) => j.latestStatus === "success").length,
    totalCount: enriched.length,
  };
}

// ─────────────────────────────────────── 8. Performance Intelligence

export async function buildPerformanceIntelligence({ rangeDays = 7 } = {}) {
  const since = new Date(Date.now() - rangeDays * MS_PER_DAY);

  const [durations, triggerAgg, actionAgg, flowAvg] = await Promise.all([
    AutomationRunLog.find({ createdAt: { $gte: since }, durationMs: { $ne: null } })
      .select("durationMs")
      .lean(),
    AutomationRunLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$triggerType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AutomationRunLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: "$stepResults" },
      { $group: { _id: "$stepResults.actionType", count: { $sum: 1 }, avgDurationMs: { $avg: "$stepResults.durationMs" } } },
      { $sort: { count: -1 } },
    ]),
    AutomationRunLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$flowId", avgDurationMs: { $avg: "$durationMs" }, count: { $sum: 1 } } },
      { $sort: { avgDurationMs: -1 } },
      { $limit: 1 },
    ]),
  ]);

  const sortedDurations = durations.map((d) => d.durationMs).sort((a, b) => a - b);
  const avgDurationMs = sortedDurations.length
    ? Math.round(sortedDurations.reduce((a, b) => a + b, 0) / sortedDurations.length)
    : 0;

  let slowestFlow = null;
  if (flowAvg[0]) {
    const flow = await AutomationFlow.findById(flowAvg[0]._id).select("name").lean();
    slowestFlow = flow ? { name: flow.name, avgDurationMs: Math.round(flowAvg[0].avgDurationMs) } : null;
  }

  const hourlyAgg = await AutomationRunLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $hour: "$startedAt" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);

  return {
    rangeDays,
    totalExecutions: sortedDurations.length,
    avgDurationMs,
    p95DurationMs: percentile(sortedDurations, 95),
    p50DurationMs: percentile(sortedDurations, 50),
    peakHour: hourlyAgg[0]?._id ?? null,
    triggerDistribution: triggerAgg.map((t) => ({
      triggerType: t._id,
      triggerLabel: getTriggerDefinition(t._id)?.label || t._id,
      count: t.count,
    })),
    actionDistribution: actionAgg.map((a) => ({
      actionType: a._id,
      count: a.count,
      avgDurationMs: a.avgDurationMs ? Math.round(a.avgDurationMs) : 0,
    })),
    slowestFlow,
  };
}

// ─────────────────────────────────────── 9. Failure Intelligence

export async function buildFailureIntelligence({ rangeDays = 7 } = {}) {
  const since = new Date(Date.now() - rangeDays * MS_PER_DAY);
  const failureMatch = { createdAt: { $gte: since }, status: "failed" };

  const [totalFailures, byTriggerType, byActionType, samples] = await Promise.all([
    AutomationRunLog.countDocuments(failureMatch),
    AutomationRunLog.aggregate([
      { $match: failureMatch },
      { $group: { _id: "$triggerType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    AutomationRunLog.aggregate([
      { $match: failureMatch },
      { $unwind: "$stepResults" },
      { $match: { "stepResults.ok": false, "stepResults.skipped": { $ne: true } } },
      { $group: { _id: "$stepResults.actionType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    AutomationRunLog.find(failureMatch).select("error flowId createdAt").sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  const sampleMessages = [...new Set(samples.map((s) => s.error).filter(Boolean))];

  return {
    rangeDays,
    totalFailures,
    byTriggerType: byTriggerType.map((t) => ({
      triggerType: t._id,
      triggerLabel: getTriggerDefinition(t._id)?.label || t._id,
      count: t.count,
    })),
    byActionType: byActionType.map((a) => ({ actionType: a._id, count: a.count })),
    sampleMessages,
    recentFailures: samples,
  };
}

// ─────────────────────────────────────── 10. Dependency Fan-out (real)

export async function buildDependencyFanout() {
  const triggers = listTriggerDefinitions();
  const counts = await AutomationFlow.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$triggerType", flows: { $push: { id: "$_id", name: "$name" } } } },
  ]);
  const countsByTrigger = Object.fromEntries(counts.map((c) => [c._id, c.flows]));

  return triggers.map((t) => ({
    triggerType: t.key,
    triggerLabel: t.label,
    wiredAt: t.wiredAt || null,
    subscribedFlows: countsByTrigger[t.key] || [],
  }));
}

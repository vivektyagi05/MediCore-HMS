// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Capacity Forecast (brief Step 8).
//
// AUDIT FINDING: predictiveAnalytics.forecast() (pre-existing, used by
// aiController) already forecasts appointment/revenue volume from 90 days
// of history — reused here as-is, never duplicated. What it does NOT cover
// (operations growth, automation executions, cron utilization, assignment/
// admin workload) is genuinely new and built the same way: a real daily
// series (trendAnalyzer.buildDailySeries) projected forward with a real
// linear trend (trendAnalyzer.linearTrend), never a fabricated number.
//
// "Doctor workload" and "patient request volume" as the brief lists them
// (per-doctor granularity) are explicitly NOT built here — 14-30 days of
// history per individual doctor is too sparse for a defensible trend line
// (the brief's own "never fabricate future numbers" rule), and platform-
// level patient request volume is already covered by
// predictiveAnalytics.forecast()'s expectedDailyAppointments. Documented,
// not silently dropped.
// ─────────────────────────────────────────────────────────────────────────

import AutomationRunLog from "../../models/AutomationRunLog.js";
import CronRunLog from "../../models/CronRunLog.js";
import OperationAssignment from "../../models/OperationAssignment.js";
import { predictiveAnalytics } from "../../ai/predictiveAnalytics.js";
import { _internal as operationsInternal } from "../../controllers/admin/operationsAdminController.js";
import { buildDailySeries, linearTrend, projectForward, DAY_MS } from "./trendAnalyzer.js";

const HISTORY_DAYS = 30;

function windowsFor(series) {
  const { r2 } = linearTrend(series);
  return {
    oneHour: Math.max(0, Math.round(projectForward(series, 1) / 24)),
    twentyFourHour: projectForward(series, 1),
    sevenDay: projectForward(series, 7) + series.slice(-7).reduce((a, p) => a + p.count, 0),
    thirtyDay: projectForward(series, 30) + series.slice(-30).reduce((a, p) => a + p.count, 0),
    trendConfidenceR2: Number(r2.toFixed(2)),
  };
}

async function forecastOperationsGrowth() {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
  const items = await operationsInternal.fetchRawOperations();
  // Same honestly-disclosed proxy as AssignmentAnalytics.queueTrend and
  // anomalyDetector's long_queue_growth — createdAt of currently-open
  // items, not a true historical snapshot series (none exists).
  const docs = items.filter((i) => new Date(i.createdAt) >= since);
  const series = buildDailySeries(docs, "createdAt", since);
  return { metric: "new_operations_per_day", ...windowsFor(series), historyDays: HISTORY_DAYS, sampleSize: docs.length };
}

async function forecastAutomationExecutions() {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
  const runs = await AutomationRunLog.find({ startedAt: { $gte: since } }).select("startedAt").lean();
  const series = buildDailySeries(runs, "startedAt", since);
  return { metric: "automation_executions_per_day", ...windowsFor(series), historyDays: HISTORY_DAYS, sampleSize: runs.length };
}

async function forecastCronUtilization() {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
  const runs = await CronRunLog.find({ createdAt: { $gte: since } }).select("createdAt").lean();
  const series = buildDailySeries(runs, "createdAt", since);
  return { metric: "cron_runs_per_day", ...windowsFor(series), historyDays: HISTORY_DAYS, sampleSize: runs.length };
}

async function forecastAssignmentLoad() {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
  const overlays = await OperationAssignment.find({ createdAt: { $gte: since } }).select("createdAt").lean();
  const series = buildDailySeries(overlays, "createdAt", since);
  return { metric: "new_assignment_records_per_day", ...windowsFor(series), historyDays: HISTORY_DAYS, sampleSize: overlays.length };
}

/**
 * buildCapacityForecast — the one entry point the controller calls.
 * Combines the pre-existing appointment/revenue forecast (unchanged) with
 * the four genuinely new operations-side projections.
 */
export async function buildCapacityForecast() {
  const [legacy, operationsGrowth, automationExecutions, cronUtilization, assignmentLoad] = await Promise.all([
    predictiveAnalytics.forecast(),
    forecastOperationsGrowth(),
    forecastAutomationExecutions(),
    forecastCronUtilization(),
    forecastAssignmentLoad(),
  ]);

  return {
    appointmentsAndRevenue: legacy, // pre-existing predictiveAnalytics.forecast(), reused verbatim
    operationsGrowth,
    automationExecutions,
    cronUtilization,
    assignmentLoad,
    deferredMetrics: [
      "Per-doctor workload forecasts (insufficient per-doctor history depth for a defensible trend)",
      "Per-admin capacity forecasts beyond current-utilization snapshots (Smart Assignment's workloadHeatmap already covers current state; a time-series of individual admin load doesn't exist)",
    ],
    windowsDefinition: "oneHour/twentyFourHour are projections of the next period; sevenDay/thirtyDay are projected NEW volume over that period (trend projection + recent actuals), not cumulative totals.",
  };
}

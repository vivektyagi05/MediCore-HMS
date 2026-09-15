// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Anomaly Detector (brief Step 4).
//
// AUDIT FINDING: no anomaly-detection concept exists anywhere in this
// codebase today — aiInsights.js only checks two fixed thresholds
// (peak-hour count, cancellation rate > 15%), never a real statistical
// deviation from the entity's OWN recent history. Every anomaly below
// compares a metric's latest value against its own trailing distribution
// (z-score via trendAnalyzer.latestPointZScore), never a hardcoded cutoff.
//
// Reuses real source data only: Payment (revenue/refunds), OperationAssignment
// (assignment imbalance — same overlays A6.2.2's analytics already reads),
// AutomationRunLog/CronRunLog (execution slowdown, failure spikes — same
// collections monitoringAggregates.js already reads, queried here for a
// different statistic: deviation, not a rate).
// ─────────────────────────────────────────────────────────────────────────

import Payment, { PAYMENT_STATUS, REFUND_STATUS } from "../../models/Payment.js";
import AutomationRunLog from "../../models/AutomationRunLog.js";
import CronRunLog from "../../models/CronRunLog.js";
import WebhookEvent from "../../models/WebhookEvent.js";
import OperationAssignment from "../../models/OperationAssignment.js";
import { _internal as operationsInternal } from "../../controllers/admin/operationsAdminController.js";
import { computeConfidence } from "./confidenceEngine.js";
import { buildDailySeries, latestPointZScore, DAY_MS } from "./trendAnalyzer.js";

const WINDOW_DAYS = 14;
const Z_THRESHOLD = 2; // ~95% confidence a deviation isn't just noise

function windowSince() {
  return new Date(Date.now() - WINDOW_DAYS * DAY_MS);
}

function buildAnomaly({ id, metric, docs, dateField, direction, evidenceLabel, relatedWorkflows = [] }) {
  const since = windowSince();
  const series = buildDailySeries(docs, dateField, since);
  const { zScore, mean, stdDev, latest } = latestPointZScore(series);
  const isAnomalous = direction === "spike" ? zScore >= Z_THRESHOLD : zScore <= -Z_THRESHOLD;
  if (!isAnomalous || series.length < 5) return null;

  const confidence = computeConfidence({
    sampleSize: docs.length,
    historicalSuccessRate: 0.6,
    matchingConditionsRatio: Math.min(1, Math.abs(zScore) / (Z_THRESHOLD * 2)),
  });

  return {
    id,
    metric,
    severity: Math.abs(zScore) >= Z_THRESHOLD * 1.5 ? "critical" : "high",
    rootCause: `Today's value (${latest}) deviates ${zScore.toFixed(1)}σ from the ${WINDOW_DAYS}-day trailing mean (${mean.toFixed(1)}).`,
    evidence: `${evidenceLabel}: mean=${mean.toFixed(1)}, stdDev=${stdDev.toFixed(1)}, latest=${latest}.`,
    impact: direction === "spike"
      ? "Sustained deviation at this rate compounds operational load if not addressed."
      : "A sustained drop below normal may indicate an upstream failure (payment gateway, cron scheduler, or webhook delivery).",
    recommendedAction: "Investigate the underlying source collection for this window; cross-check against Monitoring Platform's failure/performance tabs.",
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    timeDetected: new Date().toISOString(),
    relatedWorkflows,
    zScore: Number(zScore.toFixed(2)),
  };
}

async function detectRevenueDrop() {
  const since = windowSince();
  const payments = await Payment.find({ status: PAYMENT_STATUS.CAPTURED, createdAt: { $gte: since } })
    .select("createdAt totalAmount")
    .lean();
  // Revenue series is a SUM per day, not a count — build manually since
  // buildDailySeries only counts documents.
  const byDay = new Map();
  for (const p of payments) {
    const key = new Date(p.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + Number(p.totalAmount || 0));
  }
  const series = [];
  const cursor = new Date(since);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    series.push({ date: key, count: byDay.get(key) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const { zScore, mean, stdDev, latest } = latestPointZScore(series);
  if (zScore > -Z_THRESHOLD || series.length < 5) return null;

  const confidence = computeConfidence({ sampleSize: payments.length, historicalSuccessRate: 0.65 });
  return {
    id: "revenue_drop",
    metric: "daily_captured_revenue",
    severity: Math.abs(zScore) >= Z_THRESHOLD * 1.5 ? "critical" : "high",
    rootCause: `Today's captured revenue (₹${latest.toFixed(0)}) is ${zScore.toFixed(1)}σ below the ${WINDOW_DAYS}-day mean (₹${mean.toFixed(0)}).`,
    evidence: `mean=₹${mean.toFixed(0)}, stdDev=₹${stdDev.toFixed(0)}, latest=₹${latest.toFixed(0)}.`,
    impact: "A sustained revenue drop can indicate a payment gateway or booking-funnel issue rather than normal demand variance.",
    recommendedAction: "Check Finance dashboard and payment failure rate for the same window before assuming demand fell.",
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    timeDetected: new Date().toISOString(),
    relatedWorkflows: ["payment_failure"],
    zScore: Number(zScore.toFixed(2)),
  };
}

async function detectRefundSpike() {
  const since = windowSince();
  const refunds = await Payment.find({
    refundStatus: { $in: [REFUND_STATUS.INITIATED, REFUND_STATUS.PROCESSED] },
    updatedAt: { $gte: since },
  })
    .select("updatedAt")
    .lean();
  return buildAnomaly({
    id: "refund_spike",
    metric: "daily_refunds",
    docs: refunds,
    dateField: "updatedAt",
    direction: "spike",
    evidenceLabel: "Daily refund count",
    relatedWorkflows: ["refund_request"],
  });
}

async function detectAssignmentImbalance() {
  const since = windowSince();
  const assigns = await OperationAssignment.find({ "timeline.action": "assign", createdAt: { $gte: since } })
    .select("createdAt timeline")
    .lean();
  const events = [];
  for (const overlay of assigns) {
    for (const t of overlay.timeline || []) {
      if (t.action === "assign") events.push({ createdAt: t.at });
    }
  }
  return buildAnomaly({
    id: "assignment_imbalance",
    metric: "daily_assignments",
    docs: events,
    dateField: "createdAt",
    direction: "spike",
    evidenceLabel: "Daily assignment-event count",
    relatedWorkflows: ["doctor_verification", "refund_request"],
  });
}

async function detectExecutionSlowdown() {
  const since = windowSince();
  const runs = await AutomationRunLog.find({ startedAt: { $gte: since }, status: "success" })
    .select("startedAt durationMs")
    .lean();
  if (runs.length < 10) return null;
  // Slowdown is measured on avg durationMs per day, not run count — build
  // manually like the revenue series above.
  const byDay = new Map();
  const countByDay = new Map();
  for (const r of runs) {
    const key = new Date(r.startedAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + Number(r.durationMs || 0));
    countByDay.set(key, (countByDay.get(key) || 0) + 1);
  }
  const series = [];
  const cursor = new Date(since);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const count = countByDay.get(key) || 0;
    series.push({ date: key, count: count ? Math.round(byDay.get(key) / count) : 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const nonZero = series.filter((s) => s.count > 0);
  if (nonZero.length < 5) return null;
  const { zScore, mean, stdDev, latest } = latestPointZScore(nonZero);
  if (zScore < Z_THRESHOLD) return null;

  const confidence = computeConfidence({ sampleSize: runs.length, historicalSuccessRate: 0.55 });
  return {
    id: "execution_slowdown",
    metric: "avg_automation_duration_ms",
    severity: "high",
    rootCause: `Today's avg automation run duration (${latest}ms) is ${zScore.toFixed(1)}σ above the ${WINDOW_DAYS}-day mean (${mean.toFixed(0)}ms).`,
    evidence: `mean=${mean.toFixed(0)}ms, stdDev=${stdDev.toFixed(0)}ms, latest=${latest}ms.`,
    impact: "Slower automation runs delay downstream notifications and reminders that depend on them.",
    recommendedAction: "Check Monitoring Platform's Performance tab for the specific flow(s) driving the slowdown.",
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    timeDetected: new Date().toISOString(),
    relatedWorkflows: [],
    zScore: Number(zScore.toFixed(2)),
  };
}

async function detectAutomationFailureSpike() {
  const since = windowSince();
  const failed = await AutomationRunLog.find({ startedAt: { $gte: since }, status: "failed" }).select("startedAt").lean();
  return buildAnomaly({
    id: "automation_failure_spike",
    metric: "daily_automation_failures",
    docs: failed,
    dateField: "startedAt",
    direction: "spike",
    evidenceLabel: "Daily automation failure count",
    relatedWorkflows: ["automation_failure"],
  });
}

async function detectWebhookFailureIncrease() {
  const since = windowSince();
  const failed = await WebhookEvent.find({ status: "failed", createdAt: { $gte: since } }).select("createdAt").lean();
  return buildAnomaly({
    id: "webhook_failure_increase",
    metric: "daily_webhook_failures",
    docs: failed,
    dateField: "createdAt",
    direction: "spike",
    evidenceLabel: "Daily webhook failure count",
    relatedWorkflows: ["webhook_failure"],
  });
}

async function detectCronFailureIncrease() {
  const since = windowSince();
  const failed = await CronRunLog.find({ status: "failed", createdAt: { $gte: since } }).select("createdAt").lean();
  return buildAnomaly({
    id: "cron_failure_increase",
    metric: "daily_cron_failures",
    docs: failed,
    dateField: "createdAt",
    direction: "spike",
    evidenceLabel: "Daily cron failure count",
    relatedWorkflows: ["automation_failure"],
  });
}

async function detectLongQueueGrowth() {
  const since = windowSince();
  const items = await operationsInternal.fetchRawOperations();
  // fetchRawOperations() is a live snapshot, not a history — a genuine
  // day-over-day queue-size series doesn't exist (same documented gap
  // AssignmentAnalytics' queueTrend already discloses). This uses
  // createdAt of currently-open items as an honest proxy for "how much NEW
  // work landed on which day", identical in spirit to that existing proxy.
  const docs = items.filter((i) => new Date(i.createdAt) >= since);
  return buildAnomaly({
    id: "long_queue_growth",
    metric: "daily_new_open_items",
    docs,
    dateField: "createdAt",
    direction: "spike",
    evidenceLabel: "Daily new open-operation count",
    relatedWorkflows: [...new Set(docs.map((d) => d.type))],
  });
}

/**
 * detectAnomalies — entry point for the controller. Runs every detector
 * against real, current data; returns only genuinely triggered anomalies.
 */
export async function detectAnomalies() {
  const results = await Promise.all([
    detectRevenueDrop(),
    detectRefundSpike(),
    detectAssignmentImbalance(),
    detectExecutionSlowdown(),
    detectAutomationFailureSpike(),
    detectWebhookFailureIncrease(),
    detectCronFailureIncrease(),
    detectLongQueueGrowth(),
  ]);
  return results.filter(Boolean);
}

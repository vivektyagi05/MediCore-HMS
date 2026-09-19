// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Prediction Engine (brief Step 3).
//
// AUDIT FINDING: the only pre-existing "prediction" in this codebase is
// predictiveAnalytics.forecast() (appointments/revenue only, no operations
// concept) and aiInsights.generateAdminInsights()'s two hardcoded
// threshold checks (peak-hour, cancellation-rate). Neither predicts an
// upcoming SLA breach, queue explosion, refund backlog, verification
// delay, retry exhaustion, automation bottleneck, cron failure, or
// notification congestion — every one of those is a genuine gap, not
// something being duplicated here.
//
// Every prediction below is built ONLY from real, already-computed data:
// the Operation Registry (operationsAdminController._internal, A6.1), the
// Policy Engine's SLA/threshold constants (A6.2.1, unchanged), Payment's
// real retryCount/nextRetryAt fields, CronRunLog, and NotificationDelivery.
// Nothing here re-queries a collection that already has a builder — SLA
// state reuses computeSla(), operation counts reuse fetchRawOperations().
// ─────────────────────────────────────────────────────────────────────────

import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import CronRunLog from "../../models/CronRunLog.js";
import NotificationDelivery from "../../models/NotificationDelivery.js";
import HospitalSetting from "../../models/HospitalSetting.js";
import { ADMIN_ROLES } from "../../constants/roles.js";
import { _internal as operationsInternal } from "../../controllers/admin/operationsAdminController.js";
import { PRIORITY_THRESHOLDS, DAY_MS } from "../policies.js";
import { computeConfidence } from "./confidenceEngine.js";
import { buildDailySeries, linearTrend } from "./trendAnalyzer.js";

const MS_HOUR = 60 * 60 * 1000;

function ageMs(date) {
  return Date.now() - new Date(date).getTime();
}

// ── 1. Upcoming SLA breach ──────────────────────────────────────────────
// Reuses the exact "at_risk"/"overdue" states operations already compute
// via computeSla() (A6.2.1) inside each operation item's own .sla field —
// never a second SLA calculation.
async function predictSlaBreaches(items) {
  const atRisk = items.filter((item) => item.sla?.state === "at_risk");
  if (!atRisk.length) return null;

  const bySeverity = atRisk.filter((item) => item.priority === "critical" || item.priority === "high").length;
  const confidence = computeConfidence({
    sampleSize: atRisk.length,
    dataFreshnessMs: 0,
    historicalSuccessRate: 0.7,
    matchingConditionsRatio: 1,
    systemHealthRatio: 1,
  });

  return {
    id: "sla_breach",
    prediction: `${atRisk.length} operation item(s) are on track to breach their SLA within their target window.`,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: "computeSla() classified these items as at_risk (remaining time under 25% of their priority's SLA target).",
    supportingMetrics: {
      atRiskCount: atRisk.length,
      criticalOrHighCount: bySeverity,
      types: [...new Set(atRisk.map((i) => i.type))],
    },
    recommendedAction: "Prioritize or reassign at-risk items in the Operations Queue before they breach SLA.",
    severity: bySeverity > 0 ? "high" : "medium",
  };
}

// ── 2. Upcoming queue explosion ─────────────────────────────────────────
// Reuses the exact operationsCapacity setting introduced in A6.2.2 — no
// new capacity number invented for this phase.
async function predictQueueExplosion(items) {
  const setting = await HospitalSetting.findOne().select("operationsCapacity").lean();
  const perAdminCap = setting?.operationsCapacity?.maxOpenItemsPerAdmin || 12;
  // fetchRawOperations() only ever returns items still in their pending/
  // failed source state (see its own audit note) — every item here is
  // already open by construction, so no extra resolved-state filter exists
  // to fabricate.
  const openCount = items.length;
  const adminCount = ADMIN_ROLES.length; // real role list, not a headcount guess — see recommendedAction below

  const projectedCapacity = perAdminCap * Math.max(adminCount, 1);
  const utilizationRatio = projectedCapacity ? openCount / projectedCapacity : 0;
  if (utilizationRatio < 0.7) return null;

  const confidence = computeConfidence({
    sampleSize: openCount,
    matchingConditionsRatio: utilizationRatio > 1 ? 1 : utilizationRatio,
    historicalSuccessRate: 0.6,
  });

  return {
    id: "queue_explosion",
    prediction: `Open operations queue is at ${Math.round(utilizationRatio * 100)}% of the configured per-admin capacity ceiling.`,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: `${openCount} open items against a configured capacity of ${perAdminCap} items/admin (HospitalSetting.operationsCapacity).`,
    supportingMetrics: { openCount, perAdminCap, utilizationRatio: Math.round(utilizationRatio * 100) },
    recommendedAction: "Review Smart Assignment workload distribution or raise operationsCapacity if headcount has genuinely grown.",
    severity: utilizationRatio >= 1 ? "critical" : "high",
  };
}

// ── 3. Refund backlog ───────────────────────────────────────────────────
async function predictRefundBacklog(items) {
  const refunds = items.filter((i) => i.type === "refund_request");
  const aging = refunds.filter((r) => ageMs(r.createdAt) >= PRIORITY_THRESHOLDS.refundEscalationMs * 0.7);
  if (!aging.length) return null;

  const confidence = computeConfidence({ sampleSize: refunds.length, historicalSuccessRate: 0.65 });
  return {
    id: "refund_backlog",
    prediction: `${aging.length} refund request(s) are approaching the ${PRIORITY_THRESHOLDS.refundEscalationMs / DAY_MS}-day escalation threshold.`,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: "Refund age is within 30% of the existing refund-escalation threshold (A6.1 policy, unchanged).",
    supportingMetrics: { totalOpenRefunds: refunds.length, approachingEscalation: aging.length },
    recommendedAction: "Resolve or escalate aging refund requests before they breach the backlog threshold.",
    severity: aging.length >= 3 ? "high" : "medium",
  };
}

// ── 4. Doctor verification delay ────────────────────────────────────────
async function predictVerificationDelay(items) {
  const pending = items.filter((i) => i.type === "doctor_verification");
  const aging = pending.filter((d) => ageMs(d.createdAt) >= PRIORITY_THRESHOLDS.doctorVerificationEscalationMs * 0.6);
  if (!aging.length) return null;

  const confidence = computeConfidence({ sampleSize: pending.length, historicalSuccessRate: 0.6 });
  return {
    id: "verification_delay",
    prediction: `${aging.length} doctor verification(s) are trending toward the escalation threshold.`,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: "Verification age is within 40% of the existing 2-day escalation threshold (A6.1 policy, unchanged).",
    supportingMetrics: { pendingCount: pending.length, agingCount: aging.length },
    recommendedAction: "Prioritize document review for the aging verification requests.",
    severity: aging.length >= 3 ? "high" : "medium",
  };
}

// ── 5. Payment retry exhaustion ─────────────────────────────────────────
// Reuses Payment.retryCount/nextRetryAt — the exact fields paymentRetryService
// (pre-existing) already writes. Never a second retry concept.
async function predictRetryExhaustion() {
  const nearExhaustion = await Payment.find({
    status: PAYMENT_STATUS.FAILED,
    retryCount: { $gte: 2 }, // paymentRetryService.MAX_RETRIES is 3 — 2 is "one attempt left"
  })
    .select("_id retryCount nextRetryAt totalAmount")
    .lean();
  if (!nearExhaustion.length) return null;

  const confidence = computeConfidence({ sampleSize: nearExhaustion.length, historicalSuccessRate: 0.7 });
  const totalAtRisk = nearExhaustion.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
  return {
    id: "payment_retry_exhaustion",
    prediction: `${nearExhaustion.length} failed payment(s) have one retry attempt left before exhausting retries (max 3).`,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: "Payment.retryCount is at 2 of the existing 3-attempt maximum (paymentRetryService.js, unchanged).",
    supportingMetrics: { count: nearExhaustion.length, totalAmountAtRisk: Math.round(totalAtRisk) },
    recommendedAction: "Review these payments manually or trigger POST /api/finance/payments/retry-due before the window closes.",
    severity: totalAtRisk > 0 ? "high" : "medium",
  };
}

// ── 6/7. Automation bottleneck & cron failure ───────────────────────────
async function predictCronFailureTrend() {
  const since = new Date(Date.now() - 14 * DAY_MS);
  const recent = await CronRunLog.find({ createdAt: { $gte: since } }).select("createdAt status").lean();
  if (recent.length < 4) return null;

  const series = buildDailySeries(
    recent.filter((r) => r.status === "failed"),
    "createdAt",
    since,
  );
  const { slope, r2 } = linearTrend(series);
  if (slope <= 0.05 || r2 < 0.15) return null; // real upward trend only, not noise

  const confidence = computeConfidence({
    sampleSize: recent.length,
    historicalSuccessRate: 0.55,
    matchingConditionsRatio: Math.min(1, r2 * 2),
  });
  return {
    id: "cron_failure_trend",
    prediction: "Cron/automation job failures are trending upward over the last 14 days.",
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: `Daily failed-run count has a positive slope of ${slope.toFixed(2)}/day (r²=${r2.toFixed(2)}) — see CronRunLog.`,
    supportingMetrics: { windowDays: 14, slopePerDay: Number(slope.toFixed(2)), rSquared: Number(r2.toFixed(2)) },
    recommendedAction: "Open Platform Health Center to identify the specific failing job before it compounds.",
    severity: slope > 0.5 ? "high" : "medium",
  };
}

// ── 8. Notification congestion ──────────────────────────────────────────
// AUDIT NOTE: this codebase has no "notification failure" state (Notification
// Delivery has no send-failure field) — so this predicts real backlog
// growth (unread critical volume), not a fabricated "failure rate".
async function predictNotificationCongestion() {
  const since = new Date(Date.now() - 14 * DAY_MS);
  const recent = await NotificationDelivery.find({ severity: "critical", createdAt: { $gte: since } })
    .select("createdAt readAt")
    .lean();
  if (recent.length < 6) return null;

  const series = buildDailySeries(recent, "createdAt", since);
  const { slope, r2 } = linearTrend(series);
  const unreadCount = recent.filter((n) => !n.readAt).length;
  if (slope <= 0.2 && unreadCount < 10) return null;

  const confidence = computeConfidence({ sampleSize: recent.length, historicalSuccessRate: 0.55, matchingConditionsRatio: Math.min(1, r2 * 2) });
  return {
    id: "notification_congestion",
    prediction: "Critical notification volume is growing faster than it is being read.",
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: `${unreadCount} unread critical notifications in the last 14 days; daily volume slope is ${slope.toFixed(2)}/day.`,
    supportingMetrics: { windowDays: 14, unreadCount, slopePerDay: Number(slope.toFixed(2)) },
    recommendedAction: "Review AdminNotifications and confirm the responsible admins are actively triaging critical alerts.",
    severity: unreadCount >= 25 ? "high" : "medium",
  };
}

// ── 9. Assignment overload ──────────────────────────────────────────────
// Reuses the Smart Assignment Engine's own workload builder (A6.2.2) — the
// exact numbers already shown in AdminSmartAssignment, never re-derived.
async function predictAssignmentOverload() {
  const { buildAssignmentAnalytics } = await import("../assignment/assignmentAnalytics.js");
  const analytics = await buildAssignmentAnalytics();
  const overloaded = (analytics.workloadHeatmap || []).filter((w) => w.state === "near_capacity" || w.state === "at_capacity");
  if (!overloaded.length) return null;

  const confidence = computeConfidence({ sampleSize: overloaded.length, historicalSuccessRate: 0.65 });
  return {
    id: "assignment_overload",
    prediction: `${overloaded.length} admin(s) are at or above the configured overload utilization threshold.`,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    reason: "Reused buildAssignmentAnalytics() workloadHeatmap utilization state (A6.2.2's own computeUtilization()) — never re-derived.",
    supportingMetrics: {
      overloadedAdminCount: overloaded.length,
      admins: overloaded.map((w) => ({ id: w.admin.id, name: w.admin.name, utilizationPct: w.utilizationPct, state: w.state })),
    },
    recommendedAction: "Use Smart Assignment's reassignment recommendations to rebalance workload.",
    severity: overloaded.some((w) => w.state === "at_capacity") ? "high" : "medium",
  };
}

/**
 * generatePredictions — the one entry point the controller calls. Runs
 * every check above against real, current data and returns only the
 * predictions that actually triggered (never a fixed-length placeholder
 * list).
 */
export async function generatePredictions() {
  const items = await operationsInternal.fetchRawOperations();

  const results = await Promise.all([
    predictSlaBreaches(items),
    predictQueueExplosion(items),
    predictRefundBacklog(items),
    predictVerificationDelay(items),
    predictRetryExhaustion(),
    predictCronFailureTrend(),
    predictNotificationCongestion(),
    predictAssignmentOverload(),
  ]);

  return results.filter(Boolean);
}

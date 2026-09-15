// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.1 — Enterprise Process Registry & Orchestration Core.
// Process Health (mission Part 1's "health score" field, computed for
// real).
//
// AUDIT FINDING: none of the existing "health score" precedents in this
// codebase (A5.2's platform health score, A6.2.5's Platform Intelligence
// Score) are per-PROCESS — they are platform-wide aggregates. There was no
// existing per-process health computation to reuse, so this is genuinely
// new, but every input it reads is an existing, already-computed real
// signal (never a new metric invented for this phase):
//   - The 10 Operation Registry types -> the exact same live queue
//     operationsAdminController._internal.buildUnifiedQueue() already
//     computes (A6.1), filtered by type. Overdue-SLA ratio drives the score
//     — the same `computeSla` used everywhere else.
//   - automation_flow -> monitoringAggregates.buildFlowHealthRanking()
//     (A6.2.4), reused directly.
//   - monitoring_execution -> monitoringAggregates.buildCronHealthRanking()
//     (A6.2.4), reused directly.
//   - payment_retry -> real Payment.retryCount/nextRetryAt counts
//     (paymentRetryService.js's own fields).
// For every OTHER process in the registry, there is genuinely no dedicated
// live signal anywhere in this codebase (documented per-process below,
// same "no live signal" honesty convention as A5.2/A6.2.4) — those default
// to a disclosed baseline of 100 rather than a fabricated number.
// ─────────────────────────────────────────────────────────────────────────

// NOTE: operationsAdminController.js is imported dynamically (not
// statically) below. It sits at the center of a real, pre-existing
// circular import (operationsAdminController -> generativeAssistant ->
// patientWorkflowController -> automationEventBus -> actionExecutor ->
// assignmentEngine -> operationsAdminController, for its _internal
// export) that only manifests when something OUTSIDE the app's own
// route-loading order (app.js loads operationsAdminRoutes before
// assignmentAdminRoutes, which is what keeps the real server safe) reaches
// operationsAdminController.js first. A dynamic import here defers
// resolution until this function actually runs — by which point the app
// (or a standalone script) has always already fully loaded that module
// once — without touching the pre-existing controller files themselves.
import { buildFlowHealthRanking, buildCronHealthRanking } from "../monitoring/monitoringAggregates.js";
import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import { isKnownProcess } from "./processRegistry.js";

const WORKFLOW_TYPE_IDS = new Set([
  "doctor_verification",
  "refund_request",
  "insurance_claim",
  "critical_report",
  "payment_failure",
  "webhook_failure",
  "automation_failure",
  "delayed_appointment",
  "emergency_patient",
  "unread_executive_alert",
]);

function scoreFromOverdueRatio(total, overdue, atRisk) {
  if (total === 0) return { score: 100, note: "No open items of this type right now." };
  const overduePenalty = (overdue / total) * 60;
  const atRiskPenalty = (atRisk / total) * 20;
  const score = Math.max(0, Math.round(100 - overduePenalty - atRiskPenalty));
  return { score, note: `${overdue}/${total} overdue, ${atRisk}/${total} at-risk.` };
}

async function healthForWorkflowType(processId) {
  const { _internal: operationsInternal } = await import("../controllers/admin/operationsAdminController.js");
  const { items } = await operationsInternal.buildUnifiedQueue({ type: processId });
  const total = items.length;
  const overdue = items.filter((i) => i.sla?.state === "overdue").length;
  const atRisk = items.filter((i) => i.sla?.state === "at_risk").length;
  return { ...scoreFromOverdueRatio(total, overdue, atRisk), signalSource: "operationsAdminController.buildUnifiedQueue (live)" };
}

async function healthForAutomationFlow() {
  const ranking = await buildFlowHealthRanking();
  if (!ranking.length) return { score: 100, note: "No published automation flows yet.", signalSource: "monitoringAggregates.buildFlowHealthRanking" };
  const rates = ranking.filter((f) => f.successRate !== null).map((f) => f.successRate);
  const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 100;
  return { score: Math.round(avg), note: `Average success rate across ${ranking.length} flow(s): ${Math.round(avg)}%.`, signalSource: "monitoringAggregates.buildFlowHealthRanking" };
}

async function healthForMonitoringExecution() {
  const ranking = await buildCronHealthRanking();
  if (!ranking.length) return { score: 100, note: "No cron run history yet.", signalSource: "monitoringAggregates.buildCronHealthRanking" };
  const rates = ranking.map((j) => (j.totalRuns ? Math.round((j.successCount / j.totalRuns) * 100) : 100));
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return { score: Math.round(avg), note: `Average cron success rate across ${ranking.length} job(s): ${Math.round(avg)}%.`, signalSource: "monitoringAggregates.buildCronHealthRanking" };
}

async function healthForPaymentRetry() {
  const [pendingRetries, exhausted] = await Promise.all([
    Payment.countDocuments({ status: PAYMENT_STATUS.FAILED, retryCount: { $lt: 3 } }),
    Payment.countDocuments({ status: PAYMENT_STATUS.FAILED, retryCount: { $gte: 3 } }),
  ]);
  const total = pendingRetries + exhausted;
  return { ...scoreFromOverdueRatio(total, exhausted, 0), signalSource: "Payment.retryCount (live)" };
}

const NO_LIVE_SIGNAL_NOTE = "No dedicated live health signal exists for this process in the current codebase — defaulting to a disclosed baseline.";

export async function computeProcessHealth(processId) {
  if (!isKnownProcess(processId)) return null;
  try {
    if (WORKFLOW_TYPE_IDS.has(processId)) return await healthForWorkflowType(processId);
    if (processId === "automation_flow") return await healthForAutomationFlow();
    if (processId === "monitoring_execution") return await healthForMonitoringExecution();
    if (processId === "payment_retry") return await healthForPaymentRetry();
  } catch (err) {
    return { score: null, note: `Health computation failed: ${err.message}`, signalSource: "error" };
  }
  return { score: 100, note: NO_LIVE_SIGNAL_NOTE, signalSource: "none" };
}

export async function computeAllProcessHealth(processIds) {
  const results = await Promise.all(processIds.map(async (id) => [id, await computeProcessHealth(id)]));
  return Object.fromEntries(results);
}

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.2 — Cross-System Integration Hub.
// Event Orchestration (mission Part 4).
//
// STOP CONDITION: "NO SECOND EVENT BUS." This module creates zero
// EventEmitters. It reads the ONE shared bus (workflowEventBus, exported
// from workflow/workflowEvents.js and reused as-is by assignment/
// assignmentEvents.js — confirmed by that file's own audit comment) plus
// the automation trigger catalog (triggerRegistry.js) to build a directory
// (Event Registry / Explorer). "Correlation ID" / "Trace ID" are reframed
// honestly: this codebase has no normalized cross-model correlation field,
// so the trace below reuses the EXACT sourceId-derivation convention
// automationEventBus.js already applies to its own trigger payloads
// (sourceId || appointmentId || refundRequestId || insuranceId || reportId
// || paymentId || doctorId || userId) and matches it against every model
// that stores a comparable id — never a fabricated correlation field.
// ─────────────────────────────────────────────────────────────────────────

import { WORKFLOW_EVENTS } from "../workflow/workflowEvents.js";
import { ASSIGNMENT_EVENTS } from "../workflow/assignment/assignmentEvents.js";
import { TRIGGER_TYPES, listTriggerDefinitions } from "../automation-studio/triggerRegistry.js";
import AutomationRunLog from "../models/AutomationRunLog.js";
import CronRunLog from "../models/CronRunLog.js";
import WebhookEvent from "../models/WebhookEvent.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import OperationAssignment from "../models/OperationAssignment.js";
import AIDraft from "../models/AIDraft.js";
import Payment from "../models/Payment.js";
import { buildPaymentRetryQueue } from "../monitoring/monitoringAggregates.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Event Registry / Explorer ────────────────────────────────────────────
export function listEventRegistry() {
  const workflowEvents = Object.entries(WORKFLOW_EVENTS).map(([key, value]) => ({
    source: "workflow",
    key: value,
    label: key,
    bus: "workflowEventBus (workflow/workflowEvents.js)",
  }));
  const assignmentEvents = Object.entries(ASSIGNMENT_EVENTS).map(([key, value]) => ({
    source: "assignment",
    key: value,
    label: key,
    bus: "workflowEventBus (reused — see assignmentEvents.js audit note)",
  }));
  const automationTriggers = listTriggerDefinitions().map((t) => ({
    source: "automation",
    key: t.key,
    label: t.label,
    bus: "automationEventBus (emitAutomationTrigger)",
    wiredAt: t.wiredAt,
    category: t.category,
  }));
  return [...workflowEvents, ...assignmentEvents, ...automationTriggers];
}

// ── Correlation (reframed, see module header) ────────────────────────────
export function deriveSourceId(payload = {}) {
  return (
    payload.sourceId || payload.appointmentId || payload.refundRequestId || payload.insuranceId ||
    payload.reportId || payload.paymentId || payload.doctorId || payload.userId || null
  );
}

/**
 * Real cross-system trace for one sourceId, matched against every model
 * that can plausibly reference it. Chronologically merged. No new event
 * bus, no polling — pure read.
 */
export async function getEventTrace(sourceId) {
  if (!sourceId) return [];
  const idStr = String(sourceId);

  const [automationRuns, notifications, assignment, aiDrafts] = await Promise.all([
    AutomationRunLog.find({
      $or: [
        { "triggerPayload.sourceId": idStr },
        { "triggerPayload.appointmentId": idStr },
        { "triggerPayload.refundRequestId": idStr },
        { "triggerPayload.insuranceId": idStr },
        { "triggerPayload.reportId": idStr },
        { "triggerPayload.paymentId": idStr },
        { "triggerPayload.doctorId": idStr },
        { "triggerPayload.userId": idStr },
      ],
    })
      .select("flowId triggerType status startedAt durationMs error")
      .sort({ startedAt: 1 })
      .limit(50)
      .lean(),
    NotificationDelivery.find({ entityId: sourceId }).select("title severity createdAt readAt").sort({ createdAt: 1 }).limit(50).lean(),
    OperationAssignment.find({ operationKey: { $regex: `:${idStr}$` } }).select("operationKey type status timeline createdAt").lean(),
    AIDraft.find({ "relatedEntity.id": sourceId }).select("promptKey status createdAt approvedAt").sort({ createdAt: 1 }).limit(20).lean(),
  ]);

  const events = [
    ...automationRuns.map((r) => ({ at: r.startedAt, kind: "automation_run", label: `${r.triggerType} -> flow (${r.status})`, detail: r.error || null })),
    ...notifications.map((n) => ({ at: n.createdAt, kind: "notification", label: n.title, detail: n.severity })),
    ...aiDrafts.map((d) => ({ at: d.createdAt, kind: "ai_draft", label: `${d.promptKey} (${d.status})`, detail: null })),
    ...assignment.flatMap((a) => (a.timeline || []).map((t) => ({ at: t.at, kind: "workflow_lifecycle", label: `${a.type}: ${t.action}`, detail: t.note || null }))),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  return events;
}

// ── Dead / Failed events, Replay & Retry queues ──────────────────────────
// "NO STATIC JSON" and "no duplicate ... Event Bus": every item below
// points back to the ONE real place it can already be actioned (Automation
// Studio's rerun, Monitoring's resolveDeadLetterPayment) rather than a new
// generic replay executor.
export async function listDeadAndFailedEvents({ lookbackDays = 7 } = {}) {
  const since = new Date(Date.now() - lookbackDays * DAY_MS);

  const [failedRuns, failedCron, failedWebhooks, retryQueue] = await Promise.all([
    AutomationRunLog.find({ status: { $in: ["failed", "skipped"] }, createdAt: { $gte: since } })
      .select("flowId triggerType status error createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    CronRunLog.find({ status: "failed", createdAt: { $gte: since } }).select("jobName error createdAt").sort({ createdAt: -1 }).limit(50).lean(),
    WebhookEvent.find({ status: "failed", createdAt: { $gte: since } }).select("eventId eventType failureReason createdAt").sort({ createdAt: -1 }).limit(50).lean(),
    buildPaymentRetryQueue(),
  ]);

  return {
    failedAutomationRuns: failedRuns.map((r) => ({ ...r, replayVia: "Automation Studio -> Flow -> Rerun (existing)" })),
    failedCronJobs: failedCron.map((r) => ({ ...r, replayVia: "cron/cronJobs.js next scheduled run (existing) — no manual rerun endpoint exists" })),
    failedWebhooks: failedWebhooks.map((r) => ({ ...r, replayVia: "No webhook-replay endpoint exists in this codebase (documented gap, not built here)" })),
    deadLetterPayments: retryQueue.deadLetter.map((p) => ({ ...p, replayVia: "Monitoring Platform -> Payment Retry Queue -> Resolve (existing resolveDeadLetterPayment)" })),
    totalCount: failedRuns.length + failedCron.length + failedWebhooks.length + retryQueue.deadLetterCount,
  };
}

export { TRIGGER_TYPES };

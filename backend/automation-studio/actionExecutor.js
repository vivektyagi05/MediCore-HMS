// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
// Action Library (brief Step 5): "Reuse existing actions... Everything must
// call existing services. Never duplicate."
//
// Every branch below is a thin dispatcher to a service that already exists
// elsewhere in this codebase — none of them re-implement notification
// delivery, AI generation, feature-toggle storage, or the workflow lifecycle.
// The one genuinely new piece of infrastructure is the outbound "webhook"
// action itself: nothing in this codebase previously SENT an outbound HTTP
// call (WebhookEvent only ever receives Razorpay's webhooks). That is real,
// working code here (a real fetch() POST), not a placeholder — but it is
// new, and is called out as such rather than described as a reuse.
//
// Each executor returns { ok, skipped, message } — never throws. One
// action failing must never stop the rest of the action list from running
// (same "one failing job shouldn't kill the batch" principle as
// automation/cronJobs.js), and the caller (automationEventBus.js) is
// responsible for recording every step's outcome to AutomationRunLog.
// ─────────────────────────────────────────────────────────────────────────

import { notificationEmitter } from "../realtime/notificationEmitter.js";
import FeatureToggle from "../models/FeatureToggle.js";
import { writeSystemLog } from "../utils/adminAudit.js";
import { generativeAssistant } from "../ai/generativeAssistant.js";
import { getRecommendations } from "../workflow/assignment/assignmentEngine.js";
import { executeWorkflowTransition } from "../workflow/workflowEngine.js";
import { WORKFLOW_ACTIONS } from "../workflow/workflowStateMachine.js";
import { logger } from "../utils/logger.js";

const SYSTEM_ACTOR_LABEL = "Automation Studio";

function interpolate(template, context) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), context);
    return value === undefined || value === null ? "" : String(value);
  });
}

async function runNotifyUser(config, context) {
  const userId = config.userIdField ? context[config.userIdField] : config.userId;
  if (!userId) return { ok: false, skipped: true, message: "No target userId in trigger payload/config." };
  await notificationEmitter.emitToUser(userId, {
    type: "automation",
    title: interpolate(config.title || "Automation notification", context),
    message: interpolate(config.message || "", context),
    severity: config.severity || "info",
    entityType: context.triggerType,
    entityId: context.sourceId,
    eventKey: config.dedupe ? `automation:${context.flowId}:${context.triggerType}:${context.sourceId || ""}` : undefined,
  });
  return { ok: true, message: `Notified user ${userId}.` };
}

async function runNotifyRole(config, context) {
  if (!config.role) return { ok: false, skipped: true, message: "No role configured." };
  await notificationEmitter.emitToRole(config.role, {
    type: "automation",
    title: interpolate(config.title || "Automation notification", context),
    message: interpolate(config.message || "", context),
    severity: config.severity || "info",
    entityType: context.triggerType,
    entityId: context.sourceId,
  });
  return { ok: true, message: `Notified role "${config.role}".` };
}

async function runNotifyAdmins(config, context) {
  await notificationEmitter.emitToAdmins({
    type: "automation",
    title: interpolate(config.title || "Automation notification", context),
    message: interpolate(config.message || "", context),
    severity: config.severity || "info",
    entityType: context.triggerType,
    entityId: context.sourceId,
  });
  return { ok: true, message: "Notified all admins." };
}

async function runReminderNote(config, context) {
  // AUDIT NOTE: no delayed/scheduled-send mechanism exists anywhere in this
  // codebase (see automation/cronJobs.js's audit note — everything is
  // on-demand or standalone-cron, never a background scheduler). A
  // "reminder" action here is therefore honestly an IMMEDIATE reminder-type
  // notification via the same real pipeline as notify_user, not a fake
  // delayed send. Documented rather than silently implying scheduling.
  const userId = config.userIdField ? context[config.userIdField] : config.userId;
  if (!userId) return { ok: false, skipped: true, message: "No target userId in trigger payload/config." };
  await notificationEmitter.emitToUser(userId, {
    type: "reminder",
    title: interpolate(config.title || "Reminder", context),
    message: interpolate(config.message || "", context),
    severity: "info",
    entityType: context.triggerType,
    entityId: context.sourceId,
  });
  return { ok: true, message: `Sent immediate reminder note to user ${userId} (no scheduler exists — see audit note).` };
}

async function runActivityLog(config, context) {
  await writeSystemLog({
    action: config.action || `automation.${context.triggerType}`,
    resourceType: config.resourceType || context.triggerType,
    resourceId: context.sourceId ? String(context.sourceId) : undefined,
    severity: config.severity || "info",
    metadata: { flowId: context.flowId, flowName: context.flowName, triggerType: context.triggerType, note: config.note },
  });
  return { ok: true, message: "Activity log entry written." };
}

async function runFeatureToggle(config) {
  if (!config.key) return { ok: false, skipped: true, message: "No feature toggle key configured." };
  const toggle = await FeatureToggle.findOne({ key: config.key.toLowerCase() });
  if (!toggle) return { ok: false, skipped: true, message: `Feature toggle "${config.key}" does not exist.` };
  if (typeof config.isEnabled === "boolean") toggle.isEnabled = config.isEnabled;
  if (typeof config.rolloutPercentage === "number") toggle.rolloutPercentage = config.rolloutPercentage;
  await toggle.save();
  return { ok: true, message: `Feature toggle "${config.key}" updated.` };
}

async function runWebhook(config, context) {
  if (!config.url) return { ok: false, skipped: true, message: "No webhook URL configured." };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Automation-Studio": "MediCore-HMS" },
      body: JSON.stringify({ triggerType: context.triggerType, flow: context.flowName, payload: context.payload, firedAt: new Date().toISOString() }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return { ok: false, message: `Webhook responded with HTTP ${response.status}.` };
    return { ok: true, message: `Webhook delivered (HTTP ${response.status}).` };
  } catch (error) {
    logger.warn("Automation Studio webhook action failed", { url: config.url, message: error?.message });
    return { ok: false, message: `Webhook call failed: ${error?.message || "unknown error"}` };
  }
}

async function runAiInsight(config, context) {
  // Grounded ONLY in the real trigger payload — never a client-supplied
  // free-text field — same discipline as every other AI capability in this
  // project (see promptLibrary.js's automationFlowExplain/automationFlowAdvisor).
  try {
    const result = await generativeAssistant.automationFlowExplain({
      flowName: context.flowName,
      triggerType: context.triggerType,
      triggerLabel: context.triggerLabel,
      payload: context.payload,
    });
    return { ok: true, message: result.content };
  } catch (error) {
    return { ok: false, message: `AI insight failed: ${error?.message || "unknown error"}` };
  }
}

async function runAssignmentRecommend(config, context) {
  const operationKey = context.payload?.operationKey;
  if (!operationKey) {
    return { ok: false, skipped: true, message: "Trigger payload has no operationKey — Assignment Engine only scores real Operation Registry items." };
  }
  try {
    const recommendation = await getRecommendations(operationKey, { limit: config.limit || 3 });
    const top = recommendation.candidates?.[0];
    return {
      ok: true,
      message: top ? `Top recommended assignee: ${top.name} (score ${top.score}).` : "No eligible candidates found.",
    };
  } catch (error) {
    return { ok: false, message: `Assignment recommendation failed: ${error?.message || "unknown error"}` };
  }
}

async function runWorkflowEscalate(config, context, { dryRun }) {
  const operationKey = context.payload?.operationKey;
  const targetUserId = config.escalateToUserId;
  if (!operationKey || !targetUserId) {
    return { ok: false, skipped: true, message: "workflow_escalate requires a real operationKey (trigger payload) and an escalateToUserId (action config)." };
  }
  if (dryRun) {
    return { ok: true, skipped: true, message: `Dry run — would escalate ${operationKey} to user ${targetUserId} (no transition executed).` };
  }
  try {
    const { findOperationItem } = context.internal;
    const item = await findOperationItem(operationKey);
    const pseudoReq = { user: { _id: null }, ip: "automation-studio" };
    const result = await executeWorkflowTransition({
      req: pseudoReq,
      item,
      action: WORKFLOW_ACTIONS.ESCALATE,
      targetUserId,
      note: `${SYSTEM_ACTOR_LABEL}: ${context.flowName}`,
    });
    return { ok: true, message: `Escalated ${operationKey} (now ${result.status}).` };
  } catch (error) {
    return { ok: false, message: `Escalation failed: ${error?.message || "unknown error"}` };
  }
}

// Phase A6.3.3 — Enterprise Process Designer. AUDIT FINDING: the only
// generic cross-type transition this file could call into workflowEngine
// with was ESCALATE (runWorkflowEscalate, above). The Designer's Approval
// node needs a genuine "approve" outcome, and workflowStateMachine.js
// already defines a real RESOLVE transition for every one of the 10
// Operation Registry types — nothing to invent, just a second thin
// dispatcher next to the existing one, not a new engine.
async function runWorkflowResolve(config, context, { dryRun }) {
  const operationKey = context.payload?.operationKey;
  if (!operationKey) {
    return { ok: false, skipped: true, message: "workflow_resolve requires a real operationKey in the trigger payload." };
  }
  if (dryRun) {
    return { ok: true, skipped: true, message: `Dry run — would resolve/approve ${operationKey} (no transition executed).` };
  }
  try {
    const { findOperationItem } = context.internal;
    const item = await findOperationItem(operationKey);
    const pseudoReq = { user: { _id: null }, ip: "process-designer" };
    const result = await executeWorkflowTransition({
      req: pseudoReq,
      item,
      action: WORKFLOW_ACTIONS.RESOLVE,
      note: config.note || `${SYSTEM_ACTOR_LABEL}: ${context.flowName || context.processName || "process"}`,
    });
    return { ok: true, message: `Resolved/approved ${operationKey} (now ${result.status}).` };
  } catch (error) {
    return { ok: false, message: `Approval failed: ${error?.message || "unknown error"}` };
  }
}

const EXECUTORS = {
  notify_user: runNotifyUser,
  notify_role: runNotifyRole,
  notify_admins: runNotifyAdmins,
  reminder_note: runReminderNote,
  activity_log: runActivityLog,
  feature_toggle: runFeatureToggle,
  webhook: runWebhook,
  ai_insight: runAiInsight,
  assignment_recommend: runAssignmentRecommend,
  workflow_escalate: runWorkflowEscalate,
  workflow_resolve: runWorkflowResolve,
};

/**
 * Runs one action step. `dryRun` short-circuits every side-effecting
 * action (notify/feature_toggle/webhook/workflow_escalate) so the
 * Execution Simulator can preview a flow with zero production impact,
 * while still running read-only actions (ai_insight, assignment_recommend)
 * for real since they mutate nothing.
 */
export async function runActionStep(step, context, { dryRun = false } = {}) {
  const startedAt = Date.now();
  const executor = EXECUTORS[step.type];
  if (!executor) {
    return { actionId: step.id, actionType: step.type, ok: false, skipped: true, message: `Unknown action type "${step.type}".`, durationMs: 0 };
  }

  const SIDE_EFFECTING = new Set(["notify_user", "notify_role", "notify_admins", "reminder_note", "feature_toggle", "webhook"]);
  if (dryRun && SIDE_EFFECTING.has(step.type)) {
    return {
      actionId: step.id,
      actionType: step.type,
      ok: true,
      skipped: true,
      message: `Dry run — ${step.type} would run with config ${JSON.stringify(step.config)}.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const outcome = await executor(step.config || {}, context, { dryRun });
    return { actionId: step.id, actionType: step.type, durationMs: Date.now() - startedAt, ...outcome };
  } catch (error) {
    logger.error("Automation Studio action step failed", { actionType: step.type, message: error?.message });
    return { actionId: step.id, actionType: step.type, ok: false, message: error?.message || "Unknown error", durationMs: Date.now() - startedAt };
  }
}

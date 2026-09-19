// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
// Self-Healing Engine (brief Step 5 — "the heart of this phase").
//
// HARD RULE: nothing in this file ever executes automatically. Every
// action requires an explicit approve() call carrying a real admin
// actorId; queueAction() only ever creates a "pending_approval" row. There
// is no cron job, no scheduler, no event handler anywhere in this phase
// that calls execute() on its own. The brief's "never auto execute
// dangerous operations" rule is enforced structurally (approve() is the
// only path to execute()), not just by convention.
//
// AUDIT FINDING — the brief lists 10 example allowed actions and 6 hard
// rejects. Cross-checked against what actually exists in this codebase:
//   REAL, implemented below:
//     - retry_failed_webhook      -> webhookHandler.retryWebhookEvent() (existing code path, reused)
//     - retry_due_payments        -> paymentRetryService.retryDuePayments() (pre-existing, unchanged)
//     - rerun_automation_cron     -> automationCronJobs.runAll() (pre-existing, unchanged — same function POST /api/ai/automation/run already calls)
//     - refresh_assignment_sweep  -> assignmentScheduler.runSweep() (pre-existing A6.2.2 sweep, unchanged)
//     - recalculate_ai_insights   -> aiInsights.generateAdminInsights() (pre-existing, unchanged)
//   NOT implemented — no real mechanism exists, so building them would be
//   fabrication rather than automation:
//     - "Resume paused workflow": no workflow state machine anywhere in
//       this codebase has a "paused" status (see workflowStateMachine.js —
//       open/claimed/assigned/escalated/resolved/cancelled only).
//     - "Rebuild cached analytics": no caching layer exists anywhere
//       (every builder in monitoringAggregates.js/overviewAdminController.js
//       etc. computes live on read) — there is nothing to rebuild.
//     - "Restart notification sync": NotificationDelivery rows are
//       created directly by emitters, not by any sync/poll process that
//       could be "restarted".
// Every rejected action from the brief's own list (refund money, approve
// doctor, reject insurance, delete records, modify appointments, send
// prescriptions, anything touching patient data) has no entry in
// ALLOWED_ACTIONS at all — there is no code path that could run them even
// if a caller tried, since executeAction() only ever dispatches through
// this allowlist.
// ─────────────────────────────────────────────────────────────────────────

import IntelligenceActionLog from "../../models/IntelligenceActionLog.js";
import { retryWebhookEvent } from "../../payments/webhookHandler.js";
import { paymentRetryService } from "../../payments/paymentRetryService.js";
import { automationCronJobs } from "../../automation/cronJobs.js";
import { runSweep as runAssignmentSweep } from "../assignment/assignmentScheduler.js";
import { aiInsights } from "../../ai/aiInsights.js";

// The allowlist IS the safety policy — an action not listed here cannot be
// queued, approved, or executed, full stop.
export const ALLOWED_ACTIONS = Object.freeze({
  retry_failed_webhook: {
    label: "Retry failed webhook",
    requiresParam: "webhookEventId",
    rollbackPossible: false,
    rollbackNote: "Not applicable — retrying a webhook either succeeds (advances state forward) or fails again (no state change beyond the log entry).",
    safetyPolicy: "Only rows already in WebhookEvent.status='failed' are eligible; downstream financial side effects remain protected by existing TransactionLedger idempotencyKey uniqueness.",
    run: (params) => retryWebhookEvent(params.webhookEventId),
  },
  retry_due_payments: {
    label: "Retry due failed payments",
    requiresParam: null,
    rollbackPossible: false,
    rollbackNote: "Not applicable — only increments Payment.retryCount and schedules nextRetryAt; no funds move without a subsequent successful gateway retry.",
    safetyPolicy: "Delegates entirely to the pre-existing paymentRetryService.retryDuePayments(), unchanged — only touches payments already status=failed with retryCount<3.",
    run: () => paymentRetryService.retryDuePayments(),
  },
  rerun_automation_cron: {
    label: "Restart failed automation (re-run all cron/reminder jobs)",
    requiresParam: null,
    rollbackPossible: false,
    rollbackNote: "Not applicable — re-running reminder/insight jobs is idempotent by design (each job's own dedup logic, e.g. ReminderLog, prevents duplicate notifications).",
    safetyPolicy: "Delegates entirely to the pre-existing automationCronJobs.runAll() (A5.2), the same function POST /api/ai/automation/run already calls on demand.",
    run: () => automationCronJobs.runAll(),
  },
  refresh_assignment_sweep: {
    label: "Refresh assignment recommendations",
    requiresParam: null,
    rollbackPossible: false,
    rollbackNote: "Not applicable — the sweep only auto-assigns/escalates operations still eligible per AssignmentPolicy; already-assigned items are left untouched.",
    safetyPolicy: "Delegates entirely to the pre-existing assignmentScheduler.runSweep() (A6.2.2), unchanged.",
    run: () => runAssignmentSweep(),
  },
  recalculate_ai_insights: {
    label: "Recalculate platform health insights",
    requiresParam: null,
    rollbackPossible: true,
    rollbackNote: "New AIInsight rows are additive; stale ones simply expire via their existing 7-day expiresAt.",
    safetyPolicy: "Delegates entirely to the pre-existing aiInsights.generateAdminInsights() (unchanged) — read-only over Appointment/Payment, writes only to AIInsight.",
    run: () => aiInsights.generateAdminInsights(),
  },
});

export function isActionAllowed(actionKey) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, actionKey);
}

/**
 * queueAction — Step 1 of every healing action. Never executes; only
 * records a pending_approval row with the required disclosure fields
 * (Step 5: trigger, eligibility, safety policy, rollback possibility,
 * approval requirement).
 */
export async function queueAction({ actionKey, trigger, params = {} }) {
  if (!isActionAllowed(actionKey)) {
    throw new Error(`"${actionKey}" is not an allowed self-healing action. Allowed: ${Object.keys(ALLOWED_ACTIONS).join(", ")}`);
  }
  const definition = ALLOWED_ACTIONS[actionKey];
  if (definition.requiresParam && !params[definition.requiresParam]) {
    throw new Error(`Action "${actionKey}" requires parameter "${definition.requiresParam}".`);
  }

  return IntelligenceActionLog.create({
    actionKey,
    trigger: trigger || "manual",
    eligibility: `Action is on the allowlist (ALLOWED_ACTIONS.${actionKey}); no dangerous/patient-data operation is reachable through this path.`,
    safetyPolicy: definition.safetyPolicy,
    rollbackPossible: definition.rollbackPossible,
    rollbackNote: definition.rollbackNote,
    approvalRequired: true,
    status: "pending_approval",
    result: { params },
  });
}

/**
 * approveAndExecute — the ONLY function that actually runs a healing
 * action. Requires a real admin actorId. Re-validates the allowlist
 * independently of queueAction (never trusts that a stale log row is still
 * safe to run just because it was queued that way).
 */
export async function approveAndExecute(actionLogId, approvedBy) {
  const log = await IntelligenceActionLog.findById(actionLogId);
  if (!log) throw new Error("Self-healing action not found.");
  if (log.status !== "pending_approval") throw new Error(`Action is already "${log.status}" — cannot re-execute.`);
  if (!isActionAllowed(log.actionKey)) throw new Error(`"${log.actionKey}" is no longer an allowed action.`);
  if (!approvedBy) throw new Error("approveAndExecute requires an approving admin's user id.");

  const definition = ALLOWED_ACTIONS[log.actionKey];
  const params = log.result?.params || {};

  log.approvedBy = approvedBy;
  try {
    const result = await definition.run(params);
    log.status = "executed";
    log.result = { params, output: result };
    log.executedAt = new Date();
    await log.save();
    return log;
  } catch (error) {
    log.status = "failed";
    log.errorMessage = error?.message || "Unknown error during healing action execution.";
    await log.save();
    throw error;
  }
}

export async function rejectAction(actionLogId, rejectedBy, reason) {
  const log = await IntelligenceActionLog.findById(actionLogId);
  if (!log) throw new Error("Self-healing action not found.");
  if (log.status !== "pending_approval") throw new Error(`Action is already "${log.status}" — cannot reject.`);
  log.status = "rejected";
  log.approvedBy = rejectedBy;
  log.errorMessage = reason || "";
  await log.save();
  return log;
}

export async function listHealingQueue({ status } = {}) {
  const filter = status ? { status } : {};
  return IntelligenceActionLog.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
// Policy Engine (brief Step 6).
//
// AUDIT FINDING: SLA_TARGET_MS and the assignment-eligibility check
// (`ADMIN_ROLES.includes(target.role)`) previously lived inline inside
// backend/controllers/admin/operationsAdminController.js. They were not
// duplicated anywhere else in the codebase, but they WERE the two pieces of
// "policy" a future workflow (Lab, Pharmacy, Billing, Inventory — per the
// brief's Step 2) would need to reuse and could not, because they were
// private to one controller file. This module is the extraction: the exact
// same values and rules, made importable, with nothing behaviorally
// changed for the existing Unified Operations Queue (A6.1).
//
// Everything here is deterministic and documented — never an AI guess, and
// never a new invented threshold. Where a rule is a small, disclosed
// extension of an existing one (e.g. delayed-appointment escalation), that
// is called out explicitly below and matches getOperationsBusinessRules'
// existing documentation exactly.
// ─────────────────────────────────────────────────────────────────────────

import { ADMIN_ROLES } from "../constants/roles.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

// ── SLA Policy ───────────────────────────────────────────────────────────
// Same four targets already established by A6.1's SLA Engine. Unchanged.
export const SLA_TARGET_MS = Object.freeze({
  critical: 4 * 60 * 60 * 1000, // 4 hours
  high: 24 * 60 * 60 * 1000, // 1 day
  medium: 3 * DAY_MS, // 3 days
  low: 7 * DAY_MS, // 7 days
});

export function computeSla(createdAt, priority, resolvedAt) {
  const target = SLA_TARGET_MS[priority] || SLA_TARGET_MS.medium;
  const created = new Date(createdAt).getTime();
  const deadline = created + target;
  const measureAt = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const elapsedMs = Math.max(0, measureAt - created);
  const remainingMs = deadline - measureAt;

  let state;
  if (resolvedAt) state = "completed";
  else if (remainingMs < 0) state = "overdue";
  else if (remainingMs < target * 0.25) state = "at_risk";
  else state = "on_track";

  // Phase UI-11, Part K — SLA Command Center. Additive only: `state` keeps
  // its existing "completed" value for every current consumer
  // (assignmentHistory.js, assignmentAnalytics.js, every frontend SLA_DOT/
  // SLA_STYLES map) so nothing that already reads `state` changes behavior.
  // `resolvedOnTime` is the on-time/late split Part K needs, derived from
  // the exact same deadline math this function already does — null when
  // the item isn't resolved yet, so it's never confused with "not overdue".
  const resolvedOnTime = resolvedAt ? measureAt <= deadline : null;

  return { targetMs: target, elapsedMs, remainingMs, deadline: new Date(deadline), state, resolvedOnTime };
}

// Phase UI-11, Part K — SLA Command Center. Pure bucket counter over any
// item list carrying a `.sla` (from computeSla() above) — colocated here
// rather than in a controller so it has no import-order dependency on
// anything else and can be unit-tested with zero circular-import risk.
export function buildSlaOverview(items) {
  const overview = { onTrack: 0, atRisk: 0, overdue: 0, resolvedWithinSla: 0, resolvedLate: 0 };
  for (const item of items) {
    const sla = item.sla;
    if (!sla) continue;
    if (sla.state === "on_track") overview.onTrack += 1;
    else if (sla.state === "at_risk") overview.atRisk += 1;
    else if (sla.state === "overdue") overview.overdue += 1;
    else if (sla.state === "completed") {
      if (sla.resolvedOnTime) overview.resolvedWithinSla += 1;
      else overview.resolvedLate += 1;
    }
  }
  return overview;
}

// ── Priority Policy ──────────────────────────────────────────────────────
// The escalation thresholds already documented (and applied) per workflow
// type in getOperationsBusinessRules. Centralized here so a future workflow
// type can reuse the same numbers instead of re-inventing its own.
export const PRIORITY_THRESHOLDS = Object.freeze({
  doctorVerificationEscalationMs: 2 * DAY_MS,
  refundEscalationMs: 7 * DAY_MS,
  insuranceExpiryWindowMs: 14 * DAY_MS,
  delayedAppointmentEscalationMs: 1 * DAY_MS,
  paymentFailureLookbackMs: 7 * DAY_MS,
  webhookFailureLookbackMs: 7 * DAY_MS,
  automationFailureLookbackMs: 7 * DAY_MS,
});

// ── Assignment / Escalation Policy ───────────────────────────────────────
// Reuses the existing role model (super_admin/admin) — no new roles
// invented. Assignment and escalation share the same eligibility rule today
// (any admin or super_admin); they are named separately because a future
// workflow (e.g. one requiring department-scoped escalation) may need to
// diverge without touching assignment.
export const AssignmentPolicy = Object.freeze({
  isEligibleAssignee(userRole) {
    return ADMIN_ROLES.includes(userRole);
  },
});

export const EscalationPolicy = Object.freeze({
  isEligibleEscalationTarget(userRole) {
    return ADMIN_ROLES.includes(userRole);
  },
});

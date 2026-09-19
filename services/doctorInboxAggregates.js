// ─────────────────────────────────────────────────────────────────────────
// Phase DOC-02 — Doctor Smart Inbox.
//
// Deliberately dependency-free (no model imports, no DB) so category,
// priority, and action-destination logic can be regression-tested in
// isolation — same pattern as reviewAdminAggregates.js / governanceAggregates.js
// / paginationValidation.js. The controller is responsible for the (small,
// batched) lookups this module needs context for — this module never
// fabricates a category, priority, or action; every branch below is keyed
// off a real, persisted field (type, entityType, severity, metadata) or a
// real batched-context value the controller resolved (appointmentStatus,
// reviewReplied, patientId).
// ─────────────────────────────────────────────────────────────────────────

// Category is resolved from entityType first (the more specific, always-
// correct field), falling back to type. This is what makes categorization
// correct even for historical rows created before the DOC-02 type-field
// bugfix (see NotificationDelivery.js / patientWorkflowController.js /
// financeController.js) — no DB migration required.
const CATEGORY_BY_ENTITY_TYPE = {
  appointment: { key: "appointments", label: "Appointments" },
  review: { key: "reviews", label: "Reviews" },
  payout: { key: "payments", label: "Payments & Earnings" },
  payment: { key: "payments", label: "Payments & Earnings" },
  prescription: { key: "prescriptions", label: "Prescriptions" },
  report: { key: "clinical", label: "Clinical Reports" },
  Doctor: { key: "verification", label: "Verification" },
  Subscription: { key: "subscription", label: "Subscription & Billing" },
  Invoice: { key: "subscription", label: "Subscription & Billing" },
  LeaveRequest: { key: "schedule", label: "Schedule" },
  DoctorDocument: { key: "documents", label: "Documents" },
};

const CATEGORY_BY_TYPE = {
  appointment: { key: "appointments", label: "Appointments" },
  payment: { key: "payments", label: "Payments & Earnings" },
  refund: { key: "payments", label: "Payments & Earnings" },
  payout: { key: "payments", label: "Payments & Earnings" },
  review: { key: "reviews", label: "Reviews" },
  prescription: { key: "prescriptions", label: "Prescriptions" },
  report: { key: "clinical", label: "Clinical Reports" },
  doctor_verification: { key: "verification", label: "Verification" },
  subscription_update: { key: "subscription", label: "Subscription & Billing" },
  subscription_renewal_reminder: { key: "subscription", label: "Subscription & Billing" },
  invoice_generated: { key: "subscription", label: "Subscription & Billing" },
  document: { key: "documents", label: "Documents" },
  schedule: { key: "schedule", label: "Schedule" },
  admin_announcement: { key: "system", label: "System Alerts" },
  dashboard_sync: { key: "system", label: "System Alerts" },
  workflow_assigned: { key: "system", label: "System Alerts" },
  workflow_escalated: { key: "system", label: "System Alerts" },
  automation: { key: "automation", label: "Automation" },
  reminder: { key: "automation", label: "Automation" },
  chat: { key: "messages", label: "Messages" },
  insurance: { key: "insurance", label: "Insurance" },
};

const FALLBACK_CATEGORY = { key: "other", label: "Other" };

export function resolveCategory(notification) {
  return (
    CATEGORY_BY_ENTITY_TYPE[notification.entityType] ||
    CATEGORY_BY_TYPE[notification.type] ||
    FALLBACK_CATEGORY
  );
}

// STEP 3 — priority is derived only from real persisted state: severity
// (already set deterministically by every producer — see each emitter),
// plus a small set of entityType-specific overrides that use real batched
// context the controller resolved (never randomly/AI-assigned).
export const PRIORITY = {
  URGENT: "urgent",
  ACTION_REQUIRED: "action_required",
  INFORMATION: "information",
};

export function classifyPriority(notification, context = {}) {
  if (notification.severity === "critical") return PRIORITY.URGENT;

  if (notification.entityType === "appointment" && context.appointmentStatus === "pending") {
    return PRIORITY.ACTION_REQUIRED;
  }

  if (notification.entityType === "review" && context.reviewReplied === false) {
    return PRIORITY.ACTION_REQUIRED;
  }

  if (notification.severity === "warning") return PRIORITY.ACTION_REQUIRED;

  return PRIORITY.INFORMATION;
}

const PRIORITY_WEIGHT = {
  [PRIORITY.URGENT]: 0,
  [PRIORITY.ACTION_REQUIRED]: 1,
  [PRIORITY.INFORMATION]: 2,
};

export function priorityWeight(priority) {
  return PRIORITY_WEIGHT[priority] ?? 3;
}

// STEP 4 — every action below reuses an existing, already-shipped route
// convention (the exact same `/doctor/clinical?patientId=...&tab=history`
// pattern the Doctor Dashboard's Attention Center already uses). Where no
// real destination/context exists (automation/reminder/workflow/system
// broadcasts with no resolvable entity), this returns null rather than
// inventing a route — the item then renders as information-only.
export function resolveAction(notification, context = {}) {
  const entityType = notification.entityType;

  if (entityType === "appointment" && context.patientId) {
    return { label: "Open Patient", to: `/doctor/clinical?patientId=${context.patientId}&tab=history` };
  }
  if (entityType === "prescription" && context.patientId) {
    return { label: "Open Patient", to: `/doctor/clinical?patientId=${context.patientId}&tab=history` };
  }
  if (entityType === "report" && context.patientId) {
    return { label: "Open Patient", to: `/doctor/clinical?patientId=${context.patientId}&tab=history` };
  }
  if (entityType === "review") {
    return { label: "Reply", to: `/doctor/reviews?reviewId=${notification.entityId}` };
  }
  if (entityType === "payout") {
    return { label: "View Earnings", to: `/doctor/earnings?payoutId=${notification.entityId}` };
  }
  if (entityType === "DoctorDocument") {
    return { label: "Open Documents", to: `/doctor/documents?documentId=${notification.entityId}` };
  }
  if (entityType === "Doctor") {
    return { label: "Open Verification", to: "/doctor/verification" };
  }
  if (entityType === "Subscription" || entityType === "Invoice") {
    return { label: "Open Billing", to: "/doctor/billing" };
  }
  if (entityType === "LeaveRequest") {
    return { label: "Open Schedule", to: "/doctor/schedule" };
  }
  if (entityType === "lead") {
    return { label: "Open Leads", to: "/admin/leads" };
  }

  return null;
}

// STEP 11 — human-readable single-line summary of what the item needs, used
// only for empty/loading text and never fed back into stored data.
export function formatAttentionSummary({ urgent, actionRequired, unread }) {
  return { urgent, actionRequired, unread };
}

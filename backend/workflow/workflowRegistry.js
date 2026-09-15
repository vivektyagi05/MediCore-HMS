// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
// Workflow Registry (brief Step 3).
//
// AUDIT FINDING: the ten real, source-backed operation types A6.1 surfaces
// (doctor_verification, refund_request, insurance_claim, critical_report,
// payment_failure, webhook_failure, automation_failure, delayed_appointment,
// emergency_patient, unread_executive_alert) already had display metadata —
// TYPE_META, private to operationsAdminController.js. That object is the
// registry the brief asks for; it just wasn't a registry yet (not
// importable, no lifecycle/permission/dependency documentation attached).
// This module is that extraction, kept 1:1 with the existing values (no
// label/route/department was changed), plus the additional descriptive
// fields the brief's workflow definition asks for. operationsAdminController
// now imports TYPE_META from here instead of defining its own copy.
//
// This registry is metadata only — "what a workflow of this type IS and IS
// ALLOWED TO DO." It intentionally does not decide priority (Policy Engine,
// ./policies.js) or execute a transition (State Machine, ./workflowStateMachine.js
// + Execution Pipeline, ./workflowEngine.js). Keeping those separate is what
// lets a future workflow (Lab, Pharmacy, Billing, Inventory) plug in by
// adding one registry entry instead of touching engine code.
// ─────────────────────────────────────────────────────────────────────────

import { WORKFLOW_ACTIONS } from "./workflowStateMachine.js";

// Every action currently wired to a real controller/route for every type.
// (No workflow type in this phase has a narrower action set than another —
// documented explicitly here rather than silently assumed, so a future type
// that DOES need a narrower set has a clear place to declare it.)
const STANDARD_ACTIONS = Object.freeze([
  WORKFLOW_ACTIONS.CLAIM,
  WORKFLOW_ACTIONS.RELEASE,
  WORKFLOW_ACTIONS.ASSIGN,
  WORKFLOW_ACTIONS.ESCALATE,
  WORKFLOW_ACTIONS.RESOLVE,
  WORKFLOW_ACTIONS.CANCEL,
  WORKFLOW_ACTIONS.PIN,
]);

export const WORKFLOW_DEFINITIONS = Object.freeze({
  doctor_verification: {
    key: "doctor_verification",
    label: "Doctor Verification",
    department: "Doctor Onboarding",
    category: "onboarding",
    owner: "Admin — Doctor Onboarding",
    source: "Doctor",
    resolutionRoute: "/admin/doctors",
    resolutionLabel: "Review Doctor",
    priorityRule: "medium; escalates to high once pending 2+ days.",
    slaRule: "high -> 24h target; medium -> 3d target (see Policy Engine).",
    dependencies: ["Doctor.verificationStatus", "AdminActivityLog (doctor approval/rejection)"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  refund_request: {
    key: "refund_request",
    label: "Refund Approval",
    department: "Payments & Refunds",
    category: "finance",
    owner: "Admin — Payments & Refunds",
    source: "RefundRequest",
    resolutionRoute: "/admin/refunds",
    resolutionLabel: "Approve / Reject Refund",
    priorityRule: "medium; escalates to critical once pending 7+ days.",
    slaRule: "critical -> 4h target; medium -> 3d target.",
    dependencies: ["RefundRequest.status", "Payment (linked transaction)"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  insurance_claim: {
    key: "insurance_claim",
    label: "Insurance Claim",
    department: "Patient Insurance",
    category: "finance",
    owner: "Admin — Patient Insurance",
    source: "Insurance",
    resolutionRoute: "/admin/patients",
    resolutionLabel: "Review Claim",
    priorityRule: "medium while submitted/in_review; escalates to high if the policy also expires within 14 days.",
    slaRule: "high -> 24h target; medium -> 3d target.",
    dependencies: ["Insurance.claimStatus", "Insurance.validTill"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  critical_report: {
    key: "critical_report",
    label: "Critical Medical Report",
    department: "Clinical Oversight",
    category: "clinical",
    owner: "Admin — Clinical Oversight",
    source: "MedicalReport",
    resolutionRoute: "/admin/patients",
    resolutionLabel: "Review Report",
    priorityRule: "always critical (patient-safety item).",
    slaRule: "critical -> 4h target (fixed, never de-escalated).",
    dependencies: ["MedicalReport.severity", "MedicalReport.reviewedAt"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  payment_failure: {
    key: "payment_failure",
    label: "Failed Payment",
    department: "Payments",
    category: "finance",
    owner: "Admin — Payments",
    source: "Payment",
    resolutionRoute: "/admin/payments",
    resolutionLabel: "Review Payment",
    priorityRule: "medium for every failed payment in the last 7 days.",
    slaRule: "medium -> 3d target.",
    dependencies: ["Payment.status"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  webhook_failure: {
    key: "webhook_failure",
    label: "Webhook Failure",
    department: "Platform Infrastructure",
    category: "infrastructure",
    owner: "Admin — Platform Infrastructure",
    source: "WebhookEvent",
    resolutionRoute: "/admin/platform-health",
    resolutionLabel: "Review Webhook",
    priorityRule: "always high (risk of payment/refund state desync).",
    slaRule: "high -> 24h target.",
    dependencies: ["WebhookEvent.status", "WebhookEvent.failureReason"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  automation_failure: {
    key: "automation_failure",
    label: "Automation Failure",
    department: "Platform Infrastructure",
    category: "infrastructure",
    owner: "Admin — Platform Infrastructure",
    source: "CronRunLog",
    resolutionRoute: "/admin/platform-health",
    resolutionLabel: "Review Automation Job",
    priorityRule: "always high (same as the existing automation-job-failures alert).",
    slaRule: "high -> 24h target.",
    dependencies: ["CronRunLog.status", "CronRunLog.error"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  delayed_appointment: {
    key: "delayed_appointment",
    label: "Delayed Appointment",
    department: "Operations",
    category: "operations",
    owner: "Admin — Operations",
    source: "Appointment",
    resolutionRoute: "/admin/appointments",
    resolutionLabel: "Review Appointment",
    priorityRule: "medium if still within today; high once 1+ full day past its scheduled date.",
    slaRule: "high -> 24h target; medium -> 3d target.",
    dependencies: ["Appointment.status", "Appointment.date", "Appointment.timeSlot"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  emergency_patient: {
    key: "emergency_patient",
    label: "High-Risk Patient Today",
    department: "Clinical Oversight",
    category: "clinical",
    owner: "Admin — Clinical Oversight",
    source: "Appointment",
    resolutionRoute: "/admin/patients",
    resolutionLabel: "Review Patient",
    priorityRule: "always high (same rule as the Doctor Command Center's risk engine).",
    slaRule: "high -> 24h target.",
    dependencies: ["Appointment.painLevel", "User.patientProfile.medicalConditions"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
  unread_executive_alert: {
    key: "unread_executive_alert",
    label: "Unread Critical Alert",
    department: "Operations",
    category: "operations",
    owner: "Admin — Operations",
    source: "NotificationDelivery",
    resolutionRoute: "/admin/notifications",
    resolutionLabel: "Review Notification",
    priorityRule: "always critical (same as the existing unread-critical-notifications alert).",
    slaRule: "critical -> 4h target.",
    dependencies: ["NotificationDelivery.severity", "NotificationDelivery.readAt"],
    supportedActions: STANDARD_ACTIONS,
    permissions: ["manage_settings"],
    notifications: ["assign", "escalate"],
    realtimeEvents: ["dashboard:sync"],
    aiSupport: ["operationSummary", "workflowExplain"],
    auditActions: [
      "operations.claim",
      "operations.release",
      "operations.assign",
      "operations.escalate",
      "operations.resolve",
      "operations.cancel",
    ],
  },
});

// Back-compat alias: operationsAdminController.js previously defined this
// object itself (as `TYPE_META`, keyed the same way, same label/department/
// owner/resolutionRoute/resolutionLabel fields). It now imports this export
// instead, so nothing in A6.1's buildOperationItem()/getOperationsBusinessRules
// needed to change shape.
export const TYPE_META = WORKFLOW_DEFINITIONS;

export function getWorkflowDefinition(type) {
  return WORKFLOW_DEFINITIONS[type] || null;
}

export function listWorkflowDefinitions() {
  return Object.values(WORKFLOW_DEFINITIONS);
}

export function isKnownWorkflowType(type) {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_DEFINITIONS, type);
}

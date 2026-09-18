// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
// Automation Templates (brief Step 8): "NO fake templates. Every template
// must map to real APIs."
//
// Each template below uses only triggers from triggerRegistry.js and action
// types from actionExecutor.js. "Doctor Onboarding" and "Patient Welcome"
// from the brief's suggested list are omitted — this codebase has no
// "doctor onboarding started" or "patient welcome" trigger (registration
// covers new-account creation for both roles already, so a role-filtering
// condition on the real REGISTRATION trigger covers "Patient Welcome"
// instead of inventing a second trigger for the same event).
// ─────────────────────────────────────────────────────────────────────────

import { TRIGGER_TYPES } from "./triggerRegistry.js";

export const AUTOMATION_TEMPLATES = Object.freeze([
  {
    key: "patient_welcome",
    name: "Patient Welcome",
    description: "Send a welcome notification when a new patient account registers.",
    category: "identity",
    triggerType: TRIGGER_TYPES.REGISTRATION,
    conditions: { logic: "AND", rules: [{ field: "role", operator: "equals", value: "patient" }] },
    actions: [
      { id: "a1", type: "notify_user", label: "Welcome notification", config: { userIdField: "userId", title: "Welcome to MediCore", message: "Hi {{name}}, your account is ready. Book your first appointment anytime.", severity: "info" } },
    ],
  },
  {
    key: "refund_flow_escalation",
    name: "Refund Flow — Backlog Escalation",
    description: "Notify the Payments & Refunds admin team the moment a new refund is requested, so backlog never builds up silently.",
    category: "finance",
    triggerType: TRIGGER_TYPES.REFUND_REQUESTED,
    conditions: null,
    actions: [
      { id: "a1", type: "notify_role", label: "Alert admins", config: { role: "super_admin", title: "New refund request", message: "A refund of {{amount}} was requested: {{reason}}", severity: "warning" } },
      { id: "a2", type: "activity_log", label: "Log for audit", config: { action: "automation.refund_flow", resourceType: "RefundRequest" } },
    ],
  },
  {
    key: "insurance_flow",
    name: "Insurance Claim Intake",
    description: "Log and notify admins whenever a patient submits a new insurance claim.",
    category: "finance",
    triggerType: TRIGGER_TYPES.INSURANCE_SUBMITTED,
    conditions: null,
    actions: [
      { id: "a1", type: "notify_role", label: "Alert insurance team", config: { role: "super_admin", title: "Insurance claim submitted", message: "A new {{provider}} claim was submitted for review.", severity: "info" } },
    ],
  },
  {
    key: "critical_report_flow",
    name: "Critical Report Escalation",
    description: "Immediately notify all admins when a patient uploads a critical-severity medical report, in addition to the doctor's own existing notification.",
    category: "clinical",
    triggerType: TRIGGER_TYPES.CRITICAL_REPORT_UPLOADED,
    conditions: { logic: "AND", rules: [{ field: "severity", operator: "equals", value: "critical" }] },
    actions: [
      { id: "a1", type: "notify_admins", label: "Admin alert", config: { title: "Critical report uploaded", message: "A critical report \"{{title}}\" was uploaded and needs oversight.", severity: "critical" } },
      { id: "a2", type: "ai_insight", label: "AI context note", config: {} },
    ],
  },
  {
    key: "follow_up_reminder",
    name: "Post-Consultation Follow-up Note",
    description: "Send the patient an immediate follow-up note when their consultation is marked completed.",
    category: "clinical",
    triggerType: TRIGGER_TYPES.APPOINTMENT_COMPLETED,
    conditions: null,
    actions: [
      { id: "a1", type: "reminder_note", label: "Follow-up note", config: { userIdField: "patientId", title: "How did your visit go?", message: "Your consultation is complete. Review your visit summary and prescriptions anytime in your dashboard." } },
    ],
  },
  {
    key: "emergency_escalation",
    name: "Emergency Escalation — Webhook Relay",
    description: "Relay critical medical report events to an external on-call system via webhook, for hospitals wiring MediCore into a paging tool.",
    category: "clinical",
    triggerType: TRIGGER_TYPES.CRITICAL_REPORT_UPLOADED,
    conditions: { logic: "AND", rules: [{ field: "severity", operator: "equals", value: "critical" }] },
    actions: [{ id: "a1", type: "webhook", label: "Notify on-call system", config: { url: "" } }],
  },
  {
    key: "payment_failure_recovery",
    name: "Payment Failure Recovery Notice",
    description: "Notify the patient immediately when their payment fails, alongside the existing automatic retry scheduling.",
    category: "finance",
    triggerType: TRIGGER_TYPES.PAYMENT_FAILED,
    conditions: null,
    actions: [
      { id: "a1", type: "notify_user", label: "Payment failed notice", config: { userIdField: "userId", title: "Payment failed", message: "Your payment of {{amount}} did not go through. We'll retry automatically.", severity: "warning" } },
    ],
  },
  {
    key: "doctor_verification_notice",
    name: "Doctor Verified — Practice Team Alert",
    description: "Let the operations team know whenever a doctor is verified and goes live on the platform.",
    category: "onboarding",
    triggerType: TRIGGER_TYPES.DOCTOR_VERIFIED,
    conditions: null,
    actions: [
      { id: "a1", type: "notify_role", label: "Alert operations", config: { role: "super_admin", title: "Doctor verified", message: "Dr. {{name}} ({{specialization}}) is now verified and live.", severity: "info" } },
    ],
  },
]);

export function listTemplates() {
  return AUTOMATION_TEMPLATES;
}

export function getTemplate(key) {
  return AUTOMATION_TEMPLATES.find((t) => t.key === key) || null;
}

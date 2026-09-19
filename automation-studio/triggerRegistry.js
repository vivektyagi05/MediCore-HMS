// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.3 — Enterprise Automation Studio.
// Trigger Library (brief Step 3): "Real triggers only... DO NOT invent
// events."
//
// AUDIT FINDING: this codebase has NO in-process event bus for domain state
// changes (only workflowEvents.js's 6 lifecycle events for the fixed
// Operation Registry types, and paymentEmitter/appointmentEmitter/
// clinicalEmitter, which only fan out to sockets/notifications, not to any
// generic subscriber). Every trigger below was added as ONE additive
// `emitAutomationTrigger(...)` call at the exact real line where that state
// change already happens in an existing controller — never a new state
// change, never a synthetic/polled event pretending to be push-based. Each
// `wiredAt` comment names that real call site so this list can be verified
// against the diff.
//
// Triggers considered but NOT included (documented, not fabricated):
//   - "Insurance Approved": no code path in this codebase ever sets
//     Insurance.claimStatus = "approved" — claims are only ever closed via
//     the generic Operations Queue resolve/cancel action (A6.1), which does
//     not itself mutate claimStatus. Adding one would be inventing behavior
//     the brief didn't ask for, so this trigger is omitted rather than
//     faked.
//   - "AI Draft Generated", "Review Submitted", "Realtime Event",
//     "Notification Failed": each would need either a new write path
//     (AI drafts don't currently notify anyone) or is already ambiguous
//     with an included trigger (every socket emission IS a realtime event;
//     making "Realtime Event" its own trigger would double-fire everything
//     else here). Deferred.
//   - "Workflow Failed": this codebase's workflow lifecycle
//     (workflowEngine.js) has no failure mode of its own — transitions
//     either succeed or throw synchronously back to the HTTP caller, there
//     is nothing to trigger on asynchronously. Deferred.
// ─────────────────────────────────────────────────────────────────────────

export const TRIGGER_TYPES = Object.freeze({
  DOCTOR_VERIFIED: "doctor_verified",
  APPOINTMENT_CANCELLED: "appointment_cancelled",
  APPOINTMENT_COMPLETED: "appointment_completed",
  REFUND_REQUESTED: "refund_requested",
  REFUND_APPROVED: "refund_approved",
  PAYMENT_FAILED: "payment_failed",
  PAYMENT_SUCCESS: "payment_success",
  INSURANCE_SUBMITTED: "insurance_submitted",
  CRITICAL_REPORT_UPLOADED: "critical_report_uploaded",
  REGISTRATION: "registration",
  ROLE_CHANGED: "role_changed",
  FEATURE_TOGGLE_CHANGED: "feature_toggle_changed",
  WEBHOOK_FAILED: "webhook_failed",
  AUTOMATION_JOB_FAILED: "automation_job_failed",
});

export const TRIGGER_DEFINITIONS = Object.freeze({
  [TRIGGER_TYPES.DOCTOR_VERIFIED]: {
    key: TRIGGER_TYPES.DOCTOR_VERIFIED,
    label: "Doctor Verified",
    category: "onboarding",
    description: "Fires when an admin approves a doctor's verification.",
    payloadFields: ["doctorId", "userId", "name", "specialization"],
    wiredAt: "controllers/doctorController.js#approveDoctor",
  },
  [TRIGGER_TYPES.APPOINTMENT_CANCELLED]: {
    key: TRIGGER_TYPES.APPOINTMENT_CANCELLED,
    label: "Appointment Cancelled",
    category: "operations",
    description: "Fires when an appointment is cancelled by a patient, doctor, or admin.",
    payloadFields: ["appointmentId", "patientId", "doctorId", "date", "cancelledBy"],
    wiredAt: "controllers/appointmentController.js#cancelAppointment",
  },
  [TRIGGER_TYPES.APPOINTMENT_COMPLETED]: {
    key: TRIGGER_TYPES.APPOINTMENT_COMPLETED,
    label: "Appointment Completed",
    category: "clinical",
    description: "Fires when a consultation is finalized as completed.",
    payloadFields: ["appointmentId", "patientId", "doctorId", "date"],
    wiredAt: "controllers/appointmentController.js#updateAppointmentStatus",
  },
  [TRIGGER_TYPES.REFUND_REQUESTED]: {
    key: TRIGGER_TYPES.REFUND_REQUESTED,
    label: "Refund Requested",
    category: "finance",
    description: "Fires when a patient submits a refund request.",
    payloadFields: ["refundRequestId", "userId", "amount", "reason"],
    wiredAt: "controllers/refundController.js#createRefundRequest",
  },
  [TRIGGER_TYPES.REFUND_APPROVED]: {
    key: TRIGGER_TYPES.REFUND_APPROVED,
    label: "Refund Approved",
    category: "finance",
    description: "Fires when an admin approves a pending refund request.",
    payloadFields: ["refundRequestId", "userId", "amount"],
    wiredAt: "controllers/refundController.js#approveRefundRequest",
  },
  [TRIGGER_TYPES.PAYMENT_FAILED]: {
    key: TRIGGER_TYPES.PAYMENT_FAILED,
    label: "Payment Failed",
    category: "finance",
    description: "Fires when Razorpay reports a payment as failed.",
    payloadFields: ["paymentId", "userId", "amount"],
    wiredAt: "payments/webhookHandler.js#processEvent(payment.failed)",
  },
  [TRIGGER_TYPES.PAYMENT_SUCCESS]: {
    key: TRIGGER_TYPES.PAYMENT_SUCCESS,
    label: "Payment Success",
    category: "finance",
    description: "Fires when a payment is captured and its invoice is generated.",
    payloadFields: ["paymentId", "userId", "amount", "appointmentId"],
    wiredAt: "payments/webhookHandler.js#processEvent(payment.captured)",
  },
  [TRIGGER_TYPES.INSURANCE_SUBMITTED]: {
    key: TRIGGER_TYPES.INSURANCE_SUBMITTED,
    label: "Insurance Submitted",
    category: "finance",
    description: "Fires when a patient submits an insurance claim for review.",
    payloadFields: ["insuranceId", "userId", "provider"],
    wiredAt: "controllers/patient/patientWorkflowController.js#submitInsuranceClaim",
  },
  [TRIGGER_TYPES.CRITICAL_REPORT_UPLOADED]: {
    key: TRIGGER_TYPES.CRITICAL_REPORT_UPLOADED,
    label: "Critical Medical Report Uploaded",
    category: "clinical",
    description: "Fires when a patient uploads a report marked critical or urgent.",
    payloadFields: ["reportId", "patientId", "doctorId", "severity", "title"],
    wiredAt: "controllers/patient/patientWorkflowController.js#uploadReport",
  },
  [TRIGGER_TYPES.REGISTRATION]: {
    key: TRIGGER_TYPES.REGISTRATION,
    label: "New Registration",
    category: "identity",
    description: "Fires when a new account is created.",
    payloadFields: ["userId", "role", "name"],
    wiredAt: "controllers/authController.js#register",
  },
  [TRIGGER_TYPES.ROLE_CHANGED]: {
    key: TRIGGER_TYPES.ROLE_CHANGED,
    label: "Role Changed",
    category: "identity",
    description: "Fires when an admin changes a user's role.",
    payloadFields: ["userId", "previousRole", "newRole"],
    wiredAt: "controllers/admin/permissionAdminController.js#updateAdminRole",
  },
  [TRIGGER_TYPES.FEATURE_TOGGLE_CHANGED]: {
    key: TRIGGER_TYPES.FEATURE_TOGGLE_CHANGED,
    label: "Feature Toggle Changed",
    category: "infrastructure",
    description: "Fires when an admin enables, disables, or adjusts a feature toggle's rollout.",
    payloadFields: ["key", "isEnabled", "rolloutPercentage"],
    wiredAt: "controllers/admin/featureAdminController.js#updateFeatureToggle",
  },
  [TRIGGER_TYPES.WEBHOOK_FAILED]: {
    key: TRIGGER_TYPES.WEBHOOK_FAILED,
    label: "Webhook Failure",
    category: "infrastructure",
    description: "Fires when an inbound Razorpay webhook fails to process.",
    payloadFields: ["eventId", "eventType", "failureReason"],
    wiredAt: "payments/webhookHandler.js#razorpayWebhookHandler (catch branch — see AUDIT FINDING there)",
  },
  [TRIGGER_TYPES.AUTOMATION_JOB_FAILED]: {
    key: TRIGGER_TYPES.AUTOMATION_JOB_FAILED,
    label: "Automation / Cron Job Failed",
    category: "infrastructure",
    description:
      "Fires when any cron script or on-demand automation sub-job fails. This codebase tracks both through one shared helper (cronRunTracker.js), so \"Cron Failed\" and \"Automation Failed\" are modeled as this single real trigger rather than two synthetic ones.",
    payloadFields: ["jobName", "triggeredBy", "error"],
    wiredAt: "utils/cronRunTracker.js#trackRun (catch branch)",
  },
});

export function getTriggerDefinition(triggerType) {
  return TRIGGER_DEFINITIONS[triggerType] || null;
}

export function listTriggerDefinitions() {
  return Object.values(TRIGGER_DEFINITIONS);
}

export function isKnownTrigger(triggerType) {
  return Object.prototype.hasOwnProperty.call(TRIGGER_DEFINITIONS, triggerType);
}

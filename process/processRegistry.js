// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.1 — Enterprise Process Registry & Orchestration Core.
// Enterprise Process Registry (mission Part 1).
//
// AUDIT FIRST (see CHANGELOG-A6.3-enterprise-process-orchestration.md for
// the full write-up). Before adding a single entry here, the existing
// registry pattern was read end to end:
//   - workflowRegistry.js (A6.2.1) already catalogs the 10 real,
//     source-backed Operation Registry types (doctor_verification,
//     refund_request, insurance_claim, critical_report, payment_failure,
//     webhook_failure, automation_failure, delayed_appointment,
//     emergency_patient, unread_executive_alert) with label/department/
//     owner/permissions/aiSupport/auditActions metadata.
//   - triggerRegistry.js (A6.2.3) already catalogs the 14 real automation
//     triggers with their exact `wiredAt` call site.
//   - intelligenceRegistry.js (A6.2.5) already establishes the "registry is
//     metadata only, no DB calls at module scope" convention this file
//     follows.
//
// STOP CONDITION RESPECTED: this is NOT a second Workflow Engine, Process
// Engine, or Operation Registry. It is the SUPERSET catalog the mission
// brief asks for — it re-exports the 10 existing workflow types verbatim
// (via workflowRegistry.listWorkflowDefinitions(), never copy-pasted) and
// ADDS entries only for real, already-implemented processes that had no
// catalog entry anywhere: Patient Registration, Appointment Journey,
// Prescription Lifecycle, AI Draft Approval, Automation Flow, Workflow
// Assignment, Payment Retry, Notification Delivery, Analytics Generation,
// Monitoring Execution, Workflow Intelligence, and a documented composite
// "Admin Approval" view over the three approval-shaped workflow types.
//
// Every `entryPoints`/`realImplementationMapping` reference below was
// verified against the actual file in this codebase — nothing here is
// invented. Where a brief-requested concept has no real, independent
// implementation of its own (e.g. "Admin Approval" as a distinct engine),
// it is documented as a composite/aggregate view instead of being faked as
// having its own controller.
//
// Like workflowRegistry.js, this module is metadata only — it never
// queries the database and never decides/executes anything. Health scoring
// (real, derived from live data) lives in ./processHealth.js; orchestration
// planning lives in ./orchestrationEngine.js; graph generation lives in
// ./processGraph.js. Keeping those separate is exactly what lets this
// catalog be read synchronously from any of them without a circular
// dependency on database state.
// ─────────────────────────────────────────────────────────────────────────

import { listWorkflowDefinitions } from "../workflow/workflowRegistry.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";

// ── New (non-workflow-registry) process entries ──────────────────────────
// Every entry mirrors workflowRegistry.js's field shape, plus the extra
// descriptive fields the mission brief's Part 1 asks for (version,
// dependencies, child/parent processes, requiredModules, rollback/retry
// support, business/validation rules, realImplementationMapping).

const NEW_PROCESSES = Object.freeze({
  patient_registration: {
    id: "patient_registration",
    version: "1.0.0",
    label: "Patient Registration",
    category: "onboarding",
    owner: "Platform — Identity & Access",
    status: "active",
    documentation:
      "New account creation for patients, doctors, and staff. The single entry point every other process in this registry ultimately depends on a real User document existing.",
    entryPoints: [{ method: "POST", path: "/api/auth/register", controller: "controllers/authController.js#register" }],
    exitPoints: ["User document created", "FeatureToggle.registrations_paused gate checked (A5.3)"],
    dependencies: [],
    triggerSources: ["User model save"],
    triggerEvents: [TRIGGER_TYPES.REGISTRATION],
    permissions: [],
    requiredModules: ["models/User.js", "models/FeatureToggle.js"],
    aiUsage: [],
    automationUsage: { enabled: true, triggers: [TRIGGER_TYPES.REGISTRATION] },
    monitoringUsage: false,
    assignmentUsage: false,
    rollbackSupport: { supported: false, note: "No account-deletion rollback path exists in this codebase." },
    retrySupport: { supported: false, note: "Registration is a single synchronous write; no retry concept exists." },
    businessRules: ["Registration can be paused platform-wide via the FeatureToggle registrations_paused key (A5.3) without inventing a new role/permission."],
    validationRules: ["Email uniqueness enforced by the User schema's unique index.", "Role assignment restricted to the values in constants/roles.js."],
    realImplementationMapping: {
      controllers: ["controllers/authController.js"],
      routes: ["routes/authRoutes.js"],
      models: ["models/User.js"],
    },
  },

  appointment_journey: {
    id: "appointment_journey",
    version: "1.0.0",
    label: "Appointment Journey",
    category: "operations",
    owner: "Admin — Operations",
    status: "active",
    documentation:
      "The 8-step booking wizard (Phase A3) through the doctor's real payment_pending -> payment_completed -> consultation_started -> consultation_completed -> completed chain (doctorAppointmentWorkflow.js). Parent of Prescription Lifecycle, Payment Retry, and Notification Delivery for anything appointment-scoped.",
    entryPoints: [
      { method: "POST", path: "/api/appointments", controller: "controllers/appointmentController.js#createAppointment" },
      { method: "PATCH", path: "/api/doctor/appointments/:id/status", controller: "controllers/doctor/workflowController.js#doctorAppointmentWorkflow" },
    ],
    exitPoints: ["Appointment.status = completed | cancelled", "Certificate/Prescription eligible to be created"],
    dependencies: ["patient_registration"],
    triggerSources: ["controllers/appointmentController.js"],
    triggerEvents: [TRIGGER_TYPES.APPOINTMENT_CANCELLED, TRIGGER_TYPES.APPOINTMENT_COMPLETED],
    permissions: [],
    requiredModules: ["models/Appointment.js", "realtime/appointmentEmitter.js"],
    aiUsage: ["appointmentPrep"],
    automationUsage: { enabled: true, triggers: [TRIGGER_TYPES.APPOINTMENT_CANCELLED, TRIGGER_TYPES.APPOINTMENT_COMPLETED] },
    monitoringUsage: false,
    assignmentUsage: true,
    rollbackSupport: { supported: false, note: "No appointment-status rollback exists; cancellation is a forward transition, not an undo." },
    retrySupport: { supported: false, note: "No retry concept — a failed slot booking simply returns a validation error to the client." },
    businessRules: ["A delayed (past-due, non-terminal) appointment surfaces in the Operations Queue as the delayed_appointment workflow type (A6.1) — never duplicated here."],
    validationRules: ["Slot-conflict validation in the time-slot engine.", "Status transitions restricted to APPOINTMENT_STATUS / ACTIVE_STATUSES constants."],
    realImplementationMapping: {
      controllers: ["controllers/appointmentController.js", "controllers/doctor/workflowController.js"],
      routes: ["routes/appointmentRoutes.js", "routes/doctor/workflowRoutes.js"],
      models: ["models/Appointment.js"],
    },
  },

  prescription_lifecycle: {
    id: "prescription_lifecycle",
    version: "1.0.0",
    label: "Prescription Lifecycle",
    category: "clinical",
    owner: "Doctor — Clinical Workspace",
    status: "active",
    documentation:
      "Prescription creation is only permitted after consultation_completed (enforced in createPrescription), safety-checked against prescriptionSafety.js (duplicate medicine / rule-based warnings), then PDF-rendered.",
    entryPoints: [{ method: "POST", path: "/api/doctor/prescriptions", controller: "controllers/doctor/workflowController.js#createPrescription" }],
    exitPoints: ["Prescription document created", "PDF generated (createPrescriptionPdf)"],
    dependencies: ["appointment_journey"],
    triggerSources: [],
    triggerEvents: [],
    permissions: [],
    requiredModules: ["models/Prescription.js", "utils/prescriptionSafety.js"],
    aiUsage: ["prescriptionExplain", "prescriptionFollowUpSuggestion"],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: false,
    assignmentUsage: false,
    rollbackSupport: { supported: false, note: "No prescription-void path exists in this codebase." },
    retrySupport: { supported: false, note: "Single synchronous write; no retry concept." },
    businessRules: ["Can only be created once the linked Appointment has reached consultation_completed (real enforced precondition, not documentation-only)."],
    validationRules: ["findDuplicateMedicinesInDraft / runPrescriptionSafetyChecks run before save."],
    realImplementationMapping: {
      controllers: ["controllers/doctor/workflowController.js"],
      routes: ["routes/doctor/workflowRoutes.js"],
      models: ["models/Prescription.js"],
    },
  },

  ai_draft_approval: {
    id: "ai_draft_approval",
    version: "1.0.0",
    label: "AI Draft Approval",
    category: "ai",
    owner: "Shared — AI Orchestration Layer",
    status: "active",
    documentation:
      "Every AI-generated piece of content that could be saved into a real record is tracked as an AIDraft with a real draft -> approved | discarded status enum — nothing AI-generated is ever treated as final without this explicit step.",
    entryPoints: [{ method: "POST", path: "/api/ai/assist/:promptKey", controller: "controllers/aiAssistController.js" }],
    exitPoints: ["AIDraft.status = approved | discarded"],
    dependencies: [],
    triggerSources: [],
    triggerEvents: [],
    permissions: [],
    requiredModules: ["models/AIDraft.js", "ai/generativeAssistant.js", "ai/promptLibrary.js", "ai/providers/textGenerationProvider.js"],
    aiUsage: ["every promptKey in ai/promptLibrary.js"],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: false,
    assignmentUsage: false,
    rollbackSupport: { supported: true, note: "A draft can be discarded (AIDraft.status = discarded) instead of approved — the real rollback path." },
    retrySupport: { supported: false, note: "Generation is synchronous/deterministic (template engine); there is no async job to retry." },
    businessRules: ["Every prompt is grounded only in server-refetched real data — never a client-supplied field — per promptLibrary.js's own documented contract."],
    validationRules: ["approvedBy/approvedAt only set on an explicit approval action."],
    realImplementationMapping: {
      controllers: ["controllers/aiAssistController.js"],
      routes: ["routes/aiAssistRoutes.js"],
      models: ["models/AIDraft.js"],
    },
  },

  automation_flow: {
    id: "automation_flow",
    version: "1.0.0",
    label: "Automation Flow",
    category: "automation",
    owner: "Admin — Platform Infrastructure",
    status: "active",
    documentation:
      "Admin-authored trigger -> condition -> action definitions (Phase A6.2.3), executed by automationEventBus.js against the 14 real, wired trigger types in triggerRegistry.js.",
    entryPoints: [{ method: "POST", path: "/api/admin/automation-studio/flows", controller: "controllers/admin/automationStudioController.js" }],
    exitPoints: ["AutomationRunLog entry (success | failed | skipped)"],
    dependencies: [],
    triggerSources: Object.values(TRIGGER_TYPES),
    triggerEvents: Object.values(TRIGGER_TYPES),
    permissions: ["manage_settings"],
    requiredModules: ["models/AutomationFlow.js", "models/AutomationRunLog.js", "automation-studio/automationEventBus.js"],
    aiUsage: ["automationFlowExplain", "automationFlowAdvisor"],
    automationUsage: { enabled: true, triggers: Object.values(TRIGGER_TYPES) },
    monitoringUsage: true,
    assignmentUsage: false,
    rollbackSupport: { supported: true, note: "Flow versioning + rollback/clone already exist in Automation Studio (A6.2.3)." },
    retrySupport: { supported: false, note: "Flow runs are one-shot; no queue/retry concept exists for a flow run itself." },
    businessRules: ["A flow only runs while status === \"published\"; drafts never execute."],
    validationRules: ["conditionEvaluator.js validates the condition tree before any action step runs."],
    realImplementationMapping: {
      controllers: ["controllers/admin/automationStudioController.js"],
      routes: ["routes/admin/automationStudioRoutes.js"],
      models: ["models/AutomationFlow.js", "models/AutomationRunLog.js"],
    },
  },

  workflow_assignment: {
    id: "workflow_assignment",
    version: "1.0.0",
    label: "Workflow Assignment",
    category: "operations",
    owner: "Admin — Operations",
    status: "active",
    documentation:
      "Transparent weighted-scoring assignment/reassignment/auto-escalation sweep (Phase A6.2.2) over the Unified Operations Queue's OperationAssignment overlay.",
    entryPoints: [{ method: "POST", path: "/api/admin/assignment/recommendations", controller: "controllers/admin/assignmentAdminController.js" }],
    exitPoints: ["OperationAssignment.assignedTo set", "workflow:assigned / workflow:escalated event"],
    dependencies: [],
    triggerSources: ["cron/cronJobs.js (auto-assign/auto-escalate sweep)"],
    triggerEvents: [],
    permissions: ["manage_settings"],
    requiredModules: ["workflow/assignment/*.js", "models/OperationAssignment.js"],
    aiUsage: ["assignmentRecommendation", "workloadAdvisor", "reassignmentAdvisor", "slaAdvisor", "assignmentExplain"],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: false,
    assignmentUsage: true,
    rollbackSupport: { supported: true, note: "release() reopens an assignment back to open — the documented reopen path in workflowStateMachine.js." },
    retrySupport: { supported: false, note: "Recommendation-only per the brief's own scope note; no automatic-then-retried reassignment exists." },
    businessRules: ["Scoring weights: workload 25% / experience 20% / priority 15% / availability 15% / slaHistory 15% / escalation 10% (assignmentScoring.js)."],
    validationRules: ["AssignmentPolicy.isEligibleAssignee(userRole) gates every candidate."],
    realImplementationMapping: {
      controllers: ["controllers/admin/assignmentAdminController.js"],
      routes: ["routes/admin/assignmentAdminRoutes.js"],
      models: ["models/OperationAssignment.js"],
    },
  },

  payment_retry: {
    id: "payment_retry",
    version: "1.0.0",
    label: "Payment Retry",
    category: "finance",
    owner: "Admin — Payments",
    status: "active",
    documentation:
      "Reframed honestly in A6.2.4: Payment.retryCount/nextRetryAt/failedAt (paymentRetryService.js, MAX_RETRIES=3) is the real retry mechanism — there is no generic queue/dead-letter system, only this Payment-scoped one.",
    entryPoints: [{ method: "internal", path: "payments/paymentRetryService.js#scheduleRetry", controller: "payments/paymentRetryService.js" }],
    exitPoints: ["Payment.retryCount incremented", "Payment.retryResolvedAt/retryResolvedBy set on manual resolution (A6.2.4)"],
    dependencies: ["appointment_journey"],
    triggerSources: [],
    triggerEvents: [TRIGGER_TYPES.PAYMENT_FAILED, TRIGGER_TYPES.PAYMENT_SUCCESS],
    permissions: ["manage_settings"],
    requiredModules: ["payments/paymentRetryService.js", "models/Payment.js"],
    aiUsage: ["retryAdvisor"],
    automationUsage: { enabled: true, triggers: [TRIGGER_TYPES.PAYMENT_FAILED, TRIGGER_TYPES.PAYMENT_SUCCESS] },
    monitoringUsage: true,
    assignmentUsage: true,
    rollbackSupport: { supported: false, note: "No payment-reversal rollback exists here (refunds are their own separate process)." },
    retrySupport: { supported: true, note: "Real: up to MAX_RETRIES=3, exponential-by-count backoff via nextRetryAt." },
    businessRules: ["scheduleFailedPayment never actually re-attempts the gateway call today (documented gap, carried over from A6.2.4, not fixed here — out of this phase's scope)."],
    validationRules: ["retryCount < MAX_RETRIES gates any further retry attempt."],
    realImplementationMapping: {
      controllers: ["controllers/admin/monitoringController.js"],
      routes: ["routes/admin/monitoringRoutes.js"],
      models: ["models/Payment.js"],
    },
  },

  notification_delivery: {
    id: "notification_delivery",
    version: "1.0.0",
    label: "Notification Delivery",
    category: "operations",
    owner: "Platform — Realtime",
    status: "active",
    documentation:
      "The one shared notificationEmitter.js (emitToUser/emitToUsers/emitToRole/emitToAdmins/emitDashboardSync) every other process in this registry already reuses — never duplicated by any phase, including this one.",
    entryPoints: [{ method: "internal", path: "realtime/notificationEmitter.js", controller: "realtime/notificationEmitter.js" }],
    exitPoints: ["NotificationDelivery document created", "socket \"notification:new\" / \"dashboard:sync\" emitted"],
    dependencies: [],
    triggerSources: ["Every workflow/assignment/automation event listener in this codebase"],
    triggerEvents: [],
    permissions: [],
    requiredModules: ["realtime/notificationEmitter.js", "models/NotificationDelivery.js", "socket/roomManager.js"],
    aiUsage: [],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: true,
    assignmentUsage: false,
    rollbackSupport: { supported: false, note: "Deliveries are append-only; no unsend path." },
    retrySupport: { supported: false, note: "Best-effort fire-and-forget by design (see workflowEvents.js's own documented posture) — a failure here must never break the caller's transaction." },
    businessRules: ["eventKey-based dedup: a duplicate eventKey returns the existing delivery instead of creating a second one."],
    validationRules: ["severity restricted to the NotificationDelivery schema enum."],
    realImplementationMapping: {
      controllers: ["controllers/admin/activityAdminController.js"],
      routes: ["routes/admin/activityAdminRoutes.js"],
      models: ["models/NotificationDelivery.js"],
    },
  },

  analytics_generation: {
    id: "analytics_generation",
    version: "1.0.0",
    label: "Analytics Generation",
    category: "analytics",
    owner: "Admin — Executive Dashboard",
    status: "active",
    documentation:
      "buildPlatformAnalyticsData/buildPlatformOverviewData/buildExecutiveDashboardData (A5.1/A5.2) — the shared aggregate builders every widget, dashboard, and business-intelligence page reuses; this phase adds zero new aggregate computation.",
    entryPoints: [{ method: "GET", path: "/api/admin/overview/analytics", controller: "controllers/admin/overviewAdminController.js#buildPlatformAnalyticsData" }],
    exitPoints: ["Read-only aggregate response — no write side effects"],
    dependencies: [],
    triggerSources: [],
    triggerEvents: [],
    permissions: ["manage_settings"],
    requiredModules: ["controllers/admin/overviewAdminController.js"],
    aiUsage: ["executiveBrief", "metricExplain"],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: false,
    assignmentUsage: false,
    rollbackSupport: { supported: false, note: "Read-only — nothing to roll back." },
    retrySupport: { supported: false, note: "Synchronous aggregate query; no retry concept." },
    businessRules: ["Every widget/page reuses this one builder instead of re-querying (A5.2 audit finding, unchanged here)."],
    validationRules: ["days parameter clamped to a sane range by each caller."],
    realImplementationMapping: {
      controllers: ["controllers/admin/overviewAdminController.js", "controllers/admin/widgetsAdminController.js"],
      routes: ["routes/admin/overviewAdminRoutes.js", "routes/admin/widgetsAdminRoutes.js"],
      models: [],
    },
  },

  monitoring_execution: {
    id: "monitoring_execution",
    version: "1.0.0",
    label: "Monitoring Execution",
    category: "infrastructure",
    owner: "Admin — Platform Infrastructure",
    status: "active",
    documentation:
      "Phase A6.2.4's monitoringAggregates.js — live counters, execution KPIs, flow/cron health ranking, performance/failure intelligence, trigger fan-out, real payment retry-window split. This process's own dependency fan-out (buildDependencyFanout) is reused directly by the Integration Hub below, never recomputed.",
    entryPoints: [{ method: "GET", path: "/api/admin/monitoring/overview", controller: "controllers/admin/monitoringController.js#getOverview" }],
    exitPoints: ["Read-only aggregate response — no write side effects (except the one documented resolveDeadLetterPayment action)"],
    dependencies: ["automation_flow", "payment_retry"],
    triggerSources: [],
    triggerEvents: [],
    permissions: ["manage_settings"],
    requiredModules: ["monitoring/monitoringAggregates.js"],
    aiUsage: ["executionExplain", "failureExplain", "performanceAdvisor", "workflowHealthAdvisor", "retryAdvisor"],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: true,
    assignmentUsage: false,
    rollbackSupport: { supported: false, note: "Read-only aside from resolveDeadLetterPayment (a one-way manual resolution, not a rollback)." },
    retrySupport: { supported: false, note: "Monitoring observes retries (payment_retry); it does not itself retry anything." },
    businessRules: ["Monitoring must never break the thing it monitors — every call here is read-only or best-effort (documented posture carried from A6.2.4)."],
    validationRules: ["rangeDays clamped to max 90 (parseRangeDays)."],
    realImplementationMapping: {
      controllers: ["controllers/admin/monitoringController.js"],
      routes: ["routes/admin/monitoringRoutes.js"],
      models: ["models/AutomationRunLog.js", "models/CronRunLog.js"],
    },
  },

  workflow_intelligence: {
    id: "workflow_intelligence",
    version: "1.0.0",
    label: "Workflow Intelligence",
    category: "intelligence",
    owner: "Admin — Platform Infrastructure",
    status: "active",
    documentation:
      "Phase A6.2.5's prediction/anomaly/capacity/optimization/self-healing engines. Self-healing actions require explicit admin approval — nothing here auto-executes.",
    entryPoints: [{ method: "GET", path: "/api/admin/intelligence/overview", controller: "controllers/admin/intelligenceAdminController.js" }],
    exitPoints: ["IntelligenceActionLog entry on any approved/rejected healing action"],
    dependencies: ["monitoring_execution", "workflow_assignment"],
    triggerSources: [],
    triggerEvents: [],
    permissions: ["manage_settings"],
    requiredModules: ["workflow/intelligence/*.js"],
    aiUsage: ["predictionExplain", "anomalyExplain", "capacityAdvisor", "optimizationAdvisor", "selfHealingAdvisor", "platformIntelligenceSummary"],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: true,
    assignmentUsage: true,
    rollbackSupport: { supported: true, note: "Every self-healing action declares its own rollbackPossible flag (selfHealingEngine.js ALLOWED_ACTIONS)." },
    retrySupport: { supported: false, note: "A rejected/failed healing action is not auto-retried; it stays in the queue for a human decision." },
    businessRules: ["Only the 5 explicitly allowlisted self-healing actions can ever be queued (isActionAllowed guard) — no arbitrary action execution."],
    validationRules: ["approveAndExecute requires a real authenticated admin (req.user) as approver."],
    realImplementationMapping: {
      controllers: ["controllers/admin/intelligenceAdminController.js"],
      routes: ["routes/admin/intelligenceRoutes.js"],
      models: ["models/IntelligenceActionLog.js"],
    },
  },

  // Composite / aggregate entry — see module header. This is NOT a distinct
  // engine with its own controller; it is a documented view over the three
  // approval-shaped workflow types already in the registry. Building a
  // separate "Admin Approval" endpoint would duplicate doctor_verification/
  // refund_request/insurance_claim's real resolve actions — the stop
  // condition this phase must respect.
  admin_approval: {
    id: "admin_approval",
    version: "1.0.0",
    label: "Admin Approval (composite)",
    category: "onboarding",
    owner: "Admin",
    status: "composite",
    documentation:
      "Not a separate engine: a documented grouping of the three real workflow types whose lifecycle IS an approval decision (doctor_verification, refund_request, insurance_claim). Each already has its own real resolve/cancel action via workflowEngine.executeWorkflowTransition — this entry exists only so the Process Registry has one place that names the pattern, per the mission brief's own example list. It intentionally has no entryPoints of its own.",
    entryPoints: [],
    exitPoints: [],
    dependencies: ["doctor_verification", "refund_request", "insurance_claim"],
    triggerSources: [],
    triggerEvents: [],
    permissions: ["manage_settings"],
    requiredModules: [],
    aiUsage: [],
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: false,
    assignmentUsage: true,
    rollbackSupport: { supported: true, note: "Inherited from workflowStateMachine.js's resolved/cancelled -> open reopen path." },
    retrySupport: { supported: false, note: "Not applicable to a composite entry." },
    businessRules: ["Composite entries are never executable — orchestrationEngine.js refuses to plan a composite process directly (see its own validation)."],
    validationRules: [],
    realImplementationMapping: { controllers: [], routes: [], models: [] },
  },
});

// ── Adapt the 10 existing workflow-registry types into this superset's
// shape (adds the extra fields; every original field is passed through
// unchanged). Never a copy of their data — always live-read via
// listWorkflowDefinitions(). ────────────────────────────────────────────
function adaptWorkflowDefinition(def) {
  return {
    id: def.key,
    version: "1.0.0",
    label: def.label,
    category: def.category,
    owner: def.owner,
    status: "active",
    documentation: `${def.priorityRule} ${def.slaRule} (Operation Registry type, Phase A6.1/A6.2.1 — see workflowRegistry.js.)`,
    entryPoints: [{ method: "POST", path: `/api/admin/operations/:operationKey/:action`, controller: "controllers/admin/operationsAdminController.js" }],
    exitPoints: [`OperationAssignment.status transition via workflowEngine.executeWorkflowTransition`],
    dependencies: [],
    triggerSources: [def.source],
    triggerEvents: [],
    permissions: def.permissions,
    requiredModules: [`models/${def.source}.js`, "models/OperationAssignment.js"],
    aiUsage: def.aiSupport,
    automationUsage: { enabled: false, triggers: [] },
    monitoringUsage: false,
    assignmentUsage: true,
    rollbackSupport: { supported: true, note: "resolved/cancelled -> open via release (workflowStateMachine.js)." },
    retrySupport: { supported: false, note: "Not applicable — lifecycle transitions are synchronous and either succeed or are rejected." },
    businessRules: [def.priorityRule],
    validationRules: [def.slaRule],
    realImplementationMapping: {
      controllers: ["controllers/admin/operationsAdminController.js"],
      routes: ["routes/admin/operationsAdminRoutes.js"],
      models: [`models/${def.source}.js`],
    },
    _fromWorkflowRegistry: true,
  };
}

const WORKFLOW_PROCESSES = Object.fromEntries(listWorkflowDefinitions().map((def) => [def.key, adaptWorkflowDefinition(def)]));

export const PROCESS_DEFINITIONS = Object.freeze({ ...WORKFLOW_PROCESSES, ...NEW_PROCESSES });

// ── Derived parent/child links ───────────────────────────────────────────
// Computed once from `dependencies`, never hand-maintained twice (avoids
// the exact class of drift bug A6.2.2's audit found with duplicated
// eligibility checks).
function computeChildMap() {
  const childMap = {};
  for (const proc of Object.values(PROCESS_DEFINITIONS)) {
    for (const depId of proc.dependencies || []) {
      if (!childMap[depId]) childMap[depId] = [];
      childMap[depId].push(proc.id);
    }
  }
  return childMap;
}
const CHILD_MAP = computeChildMap();

export function getProcessDefinition(processId) {
  const base = PROCESS_DEFINITIONS[processId];
  if (!base) return null;
  return { ...base, parentProcesses: base.dependencies || [], childProcesses: CHILD_MAP[processId] || [] };
}

export function listProcessDefinitions() {
  return Object.keys(PROCESS_DEFINITIONS).map((id) => getProcessDefinition(id));
}

export function isKnownProcess(processId) {
  return Object.prototype.hasOwnProperty.call(PROCESS_DEFINITIONS, processId);
}

export function listProcessCategories() {
  return [...new Set(Object.values(PROCESS_DEFINITIONS).map((p) => p.category))];
}

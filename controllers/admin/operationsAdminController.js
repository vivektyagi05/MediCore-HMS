import Doctor from "../../models/Doctor.js";
import RefundRequest from "../../models/RefundRequest.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import WebhookEvent from "../../models/WebhookEvent.js";
import CronRunLog from "../../models/CronRunLog.js";
import Appointment from "../../models/Appointment.js";
import NotificationDelivery from "../../models/NotificationDelivery.js";
import AdminActivityLog from "../../models/AdminActivityLog.js";
import OperationAssignment from "../../models/OperationAssignment.js";
import { APPOINTMENT_STATUS, ACTIVE_STATUSES } from "../../constants/appointmentStatus.js";
import { ADMIN_ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { riskLevelFor, slotStartMinutes } from "../doctor/commandCenterController.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { TYPE_META, listWorkflowDefinitions } from "../../workflow/workflowRegistry.js";
import { getLifecycleGraph, listAllowedActions, getBlockedTransitions, WORKFLOW_ACTIONS } from "../../workflow/workflowStateMachine.js";
import { computeSla, buildSlaOverview } from "../../workflow/policies.js";
import { executeWorkflowTransition } from "../../workflow/workflowEngine.js";
import { paginateQueueItems } from "../../services/operationsQueuePagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
//
// This controller previously defined its own TYPE_META object and its own
// SLA_TARGET_MS/computeSla, and every claim/release/assign/escalate/resolve/
// cancel/pin handler called a local upsertOverlay() directly with no
// transition validation and no notification on assign/escalate. All of that
// has been extracted to backend/workflow/ (Registry, State Machine, Policy
// Engine, Event Bus, Execution Pipeline) so a future workflow type can reuse
// it — see the audit notes in each of those files for exactly what changed
// and why. This file's own request/response contract (routes, JSON shapes)
// is unchanged; it now delegates instead of duplicating.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.1 — Unified Operations Queue ("Hospital Operations Center").
//
// AUDIT FIRST (see CHANGELOG-A6.1.md for the full write-up). Before writing
// any code here, every existing admin queue/alert surface was read:
//   - missionControlAdminController.buildSmartAlerts() — real, condition-
//     based AGGREGATE alerts (counts only, no per-item id), consumed by the
//     Executive Dashboard / Mission Control KPI cards.
//   - platformHealthAdminController.buildOperationsQueue() — reused
//     buildSmartAlerts() and added 3 more aggregate entries (automation
//     failures, delayed appointments, failed payments today). This was the
//     ACTUAL duplicated queue the brief asks to find: it powered the
//     /admin/operations-center page but was itself just a re-packaging of
//     buildSmartAlerts with no click-through, no assignment, no per-item
//     identity — an admin could see "12 delayed appointments" but not act
//     on any single one from here.
//   - executiveActionController.buildActionCenterData() — enriches the same
//     aggregate alerts with owner/reason/impact/recommendedAction/deadline
//     for the Executive Action Center page.
//
// DECISION: rather than a 4th aggregate summary, this phase builds the ONE
// real, per-item, actionable queue every one of those aggregates was
// standing in for. Every item below is a real source document (never a
// synthesized count), reusing the exact same thresholds/conditions already
// established in buildSmartAlerts/buildOperationalHealth/commandCenter so
// "high risk" and "delayed" still mean one single thing platform-wide.
// buildSmartAlerts/buildActionCenterData themselves are left untouched —
// they remain the Executive Dashboard's summary widgets, a different
// surface than the operational work queue this phase replaces on the
// Operations Center page. No new AI, no new socket system, no new roles,
// no duplicate resolution endpoints: quick actions route to the existing
// approve/reject/review pages that already do the real work.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// TYPE_META, SLA_TARGET_MS, and computeSla previously lived here as private
// constants. They are now imported from backend/workflow/workflowRegistry.js
// and backend/workflow/policies.js respectively (Phase A6.2.1) — same
// values, same behavior, now reusable by future workflow types.

function ageMs(date) {
  return Date.now() - new Date(date).getTime();
}

function operationKey(type, sourceId) {
  return `${type}:${sourceId}`;
}

// ── Operation Builder (Step 13) ─────────────────────────────────────────
// Normalizes one real source document into the shared OperationItem shape.
// Nothing here fabricates a field: every value not explicitly computed
// below is copied straight from the real document passed in.
function buildOperationItem({ type, sourceId, priority, severity, createdAt, reason, businessImpact, recommendedAction, patient, doctor, department, source, extra = {} }) {
  const meta = TYPE_META[type];
  return {
    id: operationKey(type, sourceId),
    sourceId: String(sourceId),
    type,
    typeLabel: meta.label,
    priority,
    severity: severity || priority,
    owner: meta.owner,
    department: department || meta.department,
    createdAt,
    reason,
    businessImpact,
    recommendedAction,
    patient: patient || null,
    doctor: doctor || null,
    source,
    resolutionRoute: meta.resolutionRoute,
    resolutionLabel: meta.resolutionLabel,
    sla: computeSla(createdAt, priority, null),
    ...extra,
  };
}

// ── Audit: every pending workflow, real document only ───────────────────
async function fetchRawOperations() {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const sevenDaysAgo = new Date(now - 7 * DAY_MS);
  const fourteenDaysFromNow = new Date(now + 14 * DAY_MS);

  const [
    pendingDoctors,
    pendingRefunds,
    openInsuranceClaims,
    criticalReports,
    failedPayments,
    failedWebhooks,
    failedCronRuns,
    todaysAppointments,
    unreadCriticalNotifications,
  ] = await Promise.all([
    Doctor.find({ verificationStatus: "pending" })
      .select("createdAt userId")
      .populate("userId", "name email")
      .lean(),
    RefundRequest.find({ status: "pending" })
      .select("createdAt amount reason requestedBy paymentId")
      .populate("requestedBy", "name email")
      .lean(),
    Insurance.find({ claimStatus: { $in: ["submitted", "in_review"] } })
      .select("createdAt provider claimStatus validTill claimAmount userId")
      .populate("userId", "name email")
      .lean(),
    MedicalReport.find({ severity: "critical", reviewedAt: null })
      .select("createdAt title userId doctorId")
      .populate("userId", "name email")
      .populate("doctorId", "userId")
      .lean(),
    Payment.find({ status: PAYMENT_STATUS.FAILED, createdAt: { $gte: sevenDaysAgo } })
      .select("createdAt totalAmount userId doctorId appointmentId")
      .populate("userId", "name email")
      .lean(),
    WebhookEvent.find({ status: "failed", createdAt: { $gte: sevenDaysAgo } })
      .select("createdAt eventType provider failureReason")
      .lean(),
    CronRunLog.find({ status: "failed", createdAt: { $gte: sevenDaysAgo } })
      .select("createdAt jobName error")
      .lean(),
    Appointment.find({ date: { $gte: new Date(today.getTime() - 3 * DAY_MS) } })
      .select("patientId doctorId date reason symptoms painLevel timeSlot status")
      .populate("patientId", "name patientProfile.medicalConditions")
      .lean(),
    NotificationDelivery.find({ severity: "critical", readAt: null })
      .select("createdAt title message recipientId")
      .populate({ path: "recipientId", select: "role", match: { role: { $in: ADMIN_ROLES } } })
      .lean(),
  ]);

  const items = [];

  // 1. Doctor verification — reuses the exact 2-day threshold already used
  // by buildSmartAlerts' "doctor-verification-backlog".
  for (const d of pendingDoctors) {
    const age = ageMs(d.createdAt);
    items.push(
      buildOperationItem({
        type: "doctor_verification",
        sourceId: d._id,
        priority: age >= 2 * DAY_MS ? "high" : "medium",
        createdAt: d.createdAt,
        reason: "Doctor submitted credentials and is awaiting admin verification.",
        businessImpact: "New doctors cannot accept appointments until verified, reducing platform capacity.",
        recommendedAction: "Review submitted documents and verify or reject.",
        doctor: d.userId ? { id: d.userId._id, name: d.userId.name } : null,
        source: "Doctor",
      }),
    );
  }

  // 2. Refund request — reuses the exact 7-day threshold already used by
  // buildSmartAlerts' "refund-backlog".
  for (const r of pendingRefunds) {
    const age = ageMs(r.createdAt);
    items.push(
      buildOperationItem({
        type: "refund_request",
        sourceId: r._id,
        priority: age >= 7 * DAY_MS ? "critical" : "medium",
        createdAt: r.createdAt,
        reason: r.reason || "Refund requested by patient.",
        businessImpact: "Delayed refunds directly affect patient trust and may increase support/dispute volume.",
        recommendedAction: "Approve or reject the refund request.",
        patient: r.requestedBy ? { id: r.requestedBy._id, name: r.requestedBy.name } : null,
        source: "RefundRequest",
        extra: { amount: r.amount },
      }),
    );
  }

  // 3. Insurance claim — real "needs review" state (submitted/in_review),
  // not just the expiry proxy buildSmartAlerts uses. Escalated to high when
  // the policy also expires within 14 days (matches the existing
  // "insurance-expiring" threshold) so an expiring, still-open claim is
  // never under-prioritized.
  for (const i of openInsuranceClaims) {
    const expiringSoon = i.validTill && new Date(i.validTill).getTime() <= fourteenDaysFromNow.getTime();
    items.push(
      buildOperationItem({
        type: "insurance_claim",
        sourceId: i._id,
        priority: expiringSoon ? "high" : "medium",
        createdAt: i.createdAt,
        reason: `${i.provider} claim is ${i.claimStatus === "in_review" ? "in review" : "awaiting review"}${expiringSoon ? " and the policy expires within 14 days" : ""}.`,
        businessImpact: expiringSoon
          ? "The claim may be rejected if the policy lapses before processing completes."
          : "Patient reimbursement is on hold until this claim is reviewed.",
        recommendedAction: "Review the claim documents and update its status.",
        patient: i.userId ? { id: i.userId._id, name: i.userId.name } : null,
        source: "Insurance",
        extra: { claimAmount: i.claimAmount, validTill: i.validTill },
      }),
    );
  }

  // 4. Critical medical report — always critical (patient-safety), matches
  // buildSmartAlerts' "critical-reports" priority exactly.
  for (const m of criticalReports) {
    items.push(
      buildOperationItem({
        type: "critical_report",
        sourceId: m._id,
        priority: "critical",
        severity: "critical",
        createdAt: m.createdAt,
        reason: `Report "${m.title}" is marked critical and has not been reviewed.`,
        businessImpact: "Delayed review of a critical report is a direct patient-safety risk.",
        recommendedAction: "Open and review the report immediately.",
        patient: m.userId ? { id: m.userId._id, name: m.userId.name } : null,
        source: "MedicalReport",
      }),
    );
  }

  // 5. Payment failure — individual failed transactions from the last 7
  // days (the same window buildSmartAlerts' "payment-failures" aggregates).
  for (const p of failedPayments) {
    items.push(
      buildOperationItem({
        type: "payment_failure",
        sourceId: p._id,
        priority: "medium",
        createdAt: p.createdAt,
        reason: `Payment of ${p.totalAmount} failed.`,
        businessImpact: "Failed payments block appointment confirmation and directly reduce revenue.",
        recommendedAction: "Check the payment gateway status and this transaction's failure reason.",
        patient: p.userId ? { id: p.userId._id, name: p.userId.name } : null,
        source: "Payment",
        extra: { amount: p.totalAmount },
      }),
    );
  }

  // 6. Webhook failure — high priority: an unprocessed payment-provider
  // webhook can silently desync payment/refund state.
  for (const w of failedWebhooks) {
    items.push(
      buildOperationItem({
        type: "webhook_failure",
        sourceId: w._id,
        priority: "high",
        createdAt: w.createdAt,
        reason: `${w.provider} webhook (${w.eventType}) failed to process${w.failureReason ? `: ${w.failureReason}` : "."}`,
        businessImpact: "An unprocessed payment-provider webhook can leave payment/refund state out of sync.",
        recommendedAction: "Investigate and, if needed, manually reconcile the affected payment.",
        source: "WebhookEvent",
      }),
    );
  }

  // 7. Automation/cron failure — matches buildOperationsQueue's existing
  // "automation-job-failures" priority.
  for (const c of failedCronRuns) {
    items.push(
      buildOperationItem({
        type: "automation_failure",
        sourceId: c._id,
        priority: "high",
        createdAt: c.createdAt,
        reason: `Automation job "${c.jobName}" failed${c.error ? `: ${c.error}` : "."}`,
        businessImpact: "A silently failing automation job (reminders, renewals, reconciliation) degrades platform reliability.",
        recommendedAction: "Check the job's error and re-run it if needed.",
        source: "CronRunLog",
      }),
    );
  }

  // 8 & 9. Delayed appointments and today's high-risk patients — reuse the
  // exact same riskLevelFor/slotStartMinutes rules the Doctor Command
  // Center and Executive Action Center already use, so "high risk" and
  // "delayed" mean one single thing everywhere in the platform.
  const activeStatuses = [
    APPOINTMENT_STATUS.PENDING,
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.PAYMENT_COMPLETED,
    APPOINTMENT_STATUS.CONSULTATION_STARTED,
  ];
  for (const appt of todaysAppointments) {
    if (!activeStatuses.includes(appt.status)) continue;
    const apptDate = new Date(appt.date);
    const isToday = apptDate.toDateString() === today.toDateString();
    const isPastDate = apptDate < today;

    if (isToday) {
      const conditionCount = appt.patientId?.patientProfile?.medicalConditions?.length || 0;
      if (riskLevelFor(appt.painLevel, conditionCount) === "high") {
        items.push(
          buildOperationItem({
            type: "emergency_patient",
            sourceId: appt._id,
            priority: "high",
            createdAt: appt.date,
            reason: "Patient has a high pain level or 3+ recorded conditions (Command Center risk rule).",
            businessImpact: "High-risk patients waiting in an active queue may need priority handling.",
            recommendedAction: "Confirm the assigned doctor is prioritizing this patient.",
            patient: appt.patientId ? { id: appt.patientId._id, name: appt.patientId.name } : null,
            source: "Appointment",
          }),
        );
      }

      const slotStart = slotStartMinutes(appt.timeSlot);
      if (slotStart != null && slotStart < nowMinutes) {
        items.push(
          buildOperationItem({
            type: "delayed_appointment",
            sourceId: appt._id,
            priority: "medium",
            createdAt: appt.date,
            reason: `Scheduled time slot (${appt.timeSlot}) has passed without reaching a terminal status.`,
            businessImpact: "Platform-wide scheduling delays reduce patient satisfaction and doctor throughput.",
            recommendedAction: "Check with the assigned doctor for capacity or scheduling issues.",
            patient: appt.patientId ? { id: appt.patientId._id, name: appt.patientId.name } : null,
            source: "Appointment",
          }),
        );
      }
    } else if (isPastDate) {
      const delayDays = Math.floor(ageMs(apptDate) / DAY_MS);
      items.push(
        buildOperationItem({
          type: "delayed_appointment",
          sourceId: appt._id,
          priority: delayDays >= 1 ? "high" : "medium",
          createdAt: appt.date,
          reason: `Appointment date has passed (${delayDays} day(s) ago) without reaching a terminal status.`,
          businessImpact: "Platform-wide scheduling delays reduce patient satisfaction and doctor throughput.",
          recommendedAction: "Check with the assigned doctor for capacity or scheduling issues.",
          patient: appt.patientId ? { id: appt.patientId._id, name: appt.patientId.name } : null,
          source: "Appointment",
        }),
      );
    }
  }

  // 10. Unread critical alert (admin-targeted only) — matches
  // buildSmartAlerts' "unread-critical-notifications" priority.
  for (const n of unreadCriticalNotifications) {
    if (!n.recipientId) continue; // populate match filtered out non-admin recipients
    items.push(
      buildOperationItem({
        type: "unread_executive_alert",
        sourceId: n._id,
        priority: "critical",
        createdAt: n.createdAt,
        reason: n.title,
        businessImpact: "Unread critical alerts may indicate an unresolved operational issue.",
        recommendedAction: "Open and review the notification.",
        source: "NotificationDelivery",
      }),
    );
  }

  return items;
}

// ── Assignment System (Step 4) — overlay merge ──────────────────────────
async function attachAssignments(items) {
  const keys = items.map((i) => i.id);
  const overlays = await OperationAssignment.find({ operationKey: { $in: keys } })
    .populate("assignedTo", "name email")
    .populate("escalatedTo", "name email")
    .lean();
  const overlayByKey = new Map(overlays.map((o) => [o.operationKey, o]));

  return items.map((item) => {
    const overlay = overlayByKey.get(item.id);
    if (!overlay) {
      return { ...item, status: "open", assignedTo: null, escalatedTo: null, pinned: false, timeline: [] };
    }
    return {
      ...item,
      status: overlay.status,
      assignedTo: overlay.assignedTo ? { id: overlay.assignedTo._id, name: overlay.assignedTo.name } : null,
      escalatedTo: overlay.escalatedTo ? { id: overlay.escalatedTo._id, name: overlay.escalatedTo.name } : null,
      pinned: overlay.pinned,
      resolutionNote: overlay.resolutionNote,
      resolvedAt: overlay.resolvedAt,
      timeline: overlay.timeline || [],
      sla: computeSla(item.createdAt, item.priority, overlay.resolvedAt),
    };
  });
}

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ─────────────────────────────────────────────────────────────────────────
// REAL BUG FOUND during the Phase A6.2.2 audit (documented per the brief's
// own rule: "If you identify a real bug during the audit, fix it and
// clearly document the root cause before continuing").
//
// ROOT CAUSE: fetchRawOperations() only ever queries source collections for
// their PENDING/open state (Doctor{verificationStatus:"pending"},
// RefundRequest{status:"pending"}, etc. — see that function). The moment an
// item is resolved, its source record leaves that filter entirely. Every
// "resolved"/"all" status filter on GET /admin/operations (both the query
// param AND the frontend's own status dropdown, which has offered a
// "Resolved" option since A6.1) was therefore silently returning zero
// resolved items no matter what — not a missing feature, a query that could
// never match anything.
//
// FIX: for resolved/cancelled items, hydrate directly from the
// OperationAssignment overlay itself using sourceCreatedAt/sourcePriority
// (the fields added earlier in this same phase for analytics — this is
// their second real use) instead of re-querying the now-changed source
// collection. Overlays created before this phase (if any exist in an
// existing deployment) won't have those two fields yet and are skipped
// rather than shown with guessed values — never fabricated data.
// ─────────────────────────────────────────────────────────────────────────
async function fetchResolvedOverlayItems() {
  const overlays = await OperationAssignment.find({ status: { $in: ["resolved", "cancelled"] }, sourceCreatedAt: { $ne: null } })
    .populate("assignedTo", "name email")
    .populate("resolvedBy", "name email")
    .lean();

  return overlays.map((overlay) => {
    const def = TYPE_META[overlay.type] || {};
    const sourceId = overlay.operationKey.slice(overlay.type.length + 1);
    return {
      id: overlay.operationKey,
      type: overlay.type,
      typeLabel: def.label || overlay.type,
      department: def.department || "Operations",
      priority: overlay.sourcePriority || "medium",
      createdAt: overlay.sourceCreatedAt,
      sourceId,
      reason: overlay.resolutionNote || `${def.label || overlay.type} ${overlay.status}`,
      businessImpact: def.businessImpact || "",
      recommendedAction: "",
      source: "OperationAssignment",
      status: overlay.status,
      assignedTo: overlay.assignedTo ? { id: overlay.assignedTo._id, name: overlay.assignedTo.name } : null,
      escalatedTo: null,
      pinned: false,
      resolutionNote: overlay.resolutionNote,
      resolvedAt: overlay.resolvedAt,
      resolvedBy: overlay.resolvedBy ? { id: overlay.resolvedBy._id, name: overlay.resolvedBy.name } : null,
      timeline: overlay.timeline || [],
      sla: computeSla(overlay.sourceCreatedAt, overlay.sourcePriority || "medium", overlay.resolvedAt),
      relatedCount: 0,
    };
  });
}

async function buildUnifiedQueue(filters = {}) {
  const raw = await fetchRawOperations();
  const withAssignments = await attachAssignments(raw);

  const includeResolved = filters.status === "all" || filters.status === "resolved" || filters.status === "cancelled";
  let items = includeResolved
    ? [...withAssignments, ...(await fetchResolvedOverlayItems())]
    : withAssignments.filter((i) => i.status !== "resolved" && i.status !== "cancelled");

  if (filters.type) items = items.filter((i) => i.type === filters.type);
  if (filters.priority) items = items.filter((i) => i.priority === filters.priority);
  if (filters.status && filters.status !== "all") items = items.filter((i) => i.status === filters.status);
  if (filters.department) items = items.filter((i) => i.department === filters.department);
  if (filters.assignedTo) items = items.filter((i) => i.assignedTo?.id?.toString() === filters.assignedTo);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    items = items.filter(
      (i) =>
        i.reason?.toLowerCase().includes(q) ||
        i.typeLabel.toLowerCase().includes(q) ||
        i.patient?.name?.toLowerCase().includes(q) ||
        i.doctor?.name?.toLowerCase().includes(q),
    );
  }

  // Cross Module Intelligence (Step 9): attach cheap in-memory "related
  // operations" — other open items touching the same real patient/doctor.
  items = items.map((item) => {
    if (!item.patient && !item.doctor) return { ...item, relatedCount: 0 };
    const related = withAssignments.filter(
      (other) =>
        other.id !== item.id &&
        other.status !== "resolved" &&
        other.status !== "cancelled" &&
        ((item.patient && other.patient?.id?.toString() === item.patient.id.toString()) ||
          (item.doctor && other.doctor?.id?.toString() === item.doctor.id.toString())),
    );
    return { ...item, relatedCount: related.length, relatedIds: related.slice(0, 5).map((r) => r.id) };
  });

  // Pinned first, then priority, then oldest first within a priority.
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  const counts = {
    total: items.length,
    critical: items.filter((i) => i.priority === "critical").length,
    high: items.filter((i) => i.priority === "high").length,
    medium: items.filter((i) => i.priority === "medium").length,
    low: items.filter((i) => i.priority === "low").length,
    overdue: items.filter((i) => i.sla.state === "overdue").length,
    atRisk: items.filter((i) => i.sla.state === "at_risk").length,
    unassigned: items.filter((i) => !i.assignedTo && i.status === "open").length,
  };

  const byDepartment = {};
  for (const item of items) {
    byDepartment[item.department] = (byDepartment[item.department] || 0) + 1;
  }

  return { items, counts, byDepartment };
}

// ── SLA Command Center (Phase UI-11, Part K) ──────────────────────────────
// AUDIT FINDING: computeSla() already classifies every open item as
// on_track/at_risk/overdue and every resolved item as "completed" — but
// nothing combined open + resolved into the five buckets Part K asks for
// (On Track / At Risk / Overdue / Resolved Within SLA / Resolved Late).
// buildSlaOverview() itself lives in policies.js, colocated with computeSla;
// this just wires the real data (fetchRawOperations / attachAssignments /
// fetchResolvedOverlayItems — all pre-existing, reused as-is) into it.
export const getSlaOverview = asyncHandler(async (req, res) => {
  const open = (await attachAssignments(await fetchRawOperations())).filter((i) => i.status !== "resolved" && i.status !== "cancelled");
  const resolved = await fetchResolvedOverlayItems();
  const overview = buildSlaOverview([...open, ...resolved]);
  res.status(200).json({ success: true, data: overview, message: "SLA overview fetched successfully" });
});

export const getOperationsQueueUnified = asyncHandler(async (req, res) => {
  const data = await buildUnifiedQueue({
    type: req.query.type,
    priority: req.query.priority,
    status: req.query.status,
    department: req.query.department,
    assignedTo: req.query.assignedTo,
    search: req.query.search,
  });

  const { pageItems, pagination } = paginateQueueItems(data.items, req.query.page, req.query.pageSize);

  res.status(200).json({
    success: true,
    data: { items: pageItems, counts: data.counts, byDepartment: data.byDepartment, pagination },
    message: "Unified operations queue fetched successfully",
  });
});

async function findOperationItem(operationKey) {
  const items = await attachAssignments(await fetchRawOperations());
  const item = items.find((i) => i.id === operationKey);
  if (!item) throw new AppError("Operation not found or no longer open", 404);
  return item;
}

// ── Operations Workspace (Step 5) ───────────────────────────────────────
// ── Per-operation State Machine Visualization (Phase UI-11, Part C) ──────
// AUDIT FINDING: workflowStateMachine.js already exposed listAllowedActions()
// (used by executeWorkflowTransition() to validate every mutation
// server-side) and getLifecycleGraph() (already powers the registry-level
// Lifecycle Viewer in AdminWorkflowEngine.jsx) — but no endpoint ever
// surfaced, for ONE specific operation, which actions are blocked from its
// CURRENT status and why. getBlockedTransitions() (added to
// workflowStateMachine.js itself, so it shares the transition graph with no
// duplication) closes that gap.
export const getOperationDetail = asyncHandler(async (req, res) => {
  const { operationKey: key } = req.params;
  const item = await findOperationItem(key);

  const [assignmentDoc, activityLogs] = await Promise.all([
    OperationAssignment.findOne({ operationKey: key })
      .populate("assignedTo", "name email")
      .populate("escalatedTo", "name email")
      .populate("timeline.actorId", "name")
      .lean(),
    AdminActivityLog.find({ resourceId: item.sourceId })
      .select("action resourceType createdAt severity metadata")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const allItems = await attachAssignments(await fetchRawOperations());
  const related = allItems.filter(
    (other) =>
      other.id !== item.id &&
      ((item.patient && other.patient?.id?.toString() === item.patient.id.toString()) ||
        (item.doctor && other.doctor?.id?.toString() === item.doctor.id.toString())),
  );

  res.status(200).json({
    success: true,
    data: {
      ...item,
      timeline: assignmentDoc?.timeline || [],
      activityLog: activityLogs,
      relatedOperations: related.map((r) => ({ id: r.id, typeLabel: r.typeLabel, priority: r.priority, reason: r.reason })),
      stateMachine: {
        current: item.status,
        allowedActions: listAllowedActions(item.status),
        blockedTransitions: getBlockedTransitions(item.status),
      },
    },
    message: "Operation detail fetched successfully",
  });
});

// ── Execution Pipeline actions (Phase A6.2.1, brief Step 8) ─────────────
// Every handler below now does exactly one thing: resolve the real
// OperationItem (Operation Registry, unchanged from A6.1 — findOperationItem
// already attaches the current overlay `status` via attachAssignments), then
// hand off to executeWorkflowTransition() (backend/workflow/workflowEngine.js),
// which runs validation, business rules, the state machine, persistence,
// event emission, and audit logging in one place. No handler touches
// OperationAssignment directly anymore.
export const claimOperation = asyncHandler(async (req, res) => {
  const item = await findOperationItem(req.params.operationKey);
  await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.CLAIM });
  res.status(200).json({ success: true, data: null, message: "Operation claimed" });
});

export const releaseOperation = asyncHandler(async (req, res) => {
  const item = await findOperationItem(req.params.operationKey);
  await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.RELEASE });
  res.status(200).json({ success: true, data: null, message: "Operation released" });
});

export const assignOperation = asyncHandler(async (req, res) => {
  // Phase A6.2.2: `note` is optional and, when the frontend's Smart
  // Recommendation card is what triggered this call, carries the
  // Assignment Engine's own transparent reason string — same endpoint,
  // same contract, nothing duplicated for the "recommended assign" path.
  const { userId, note } = req.body;
  const item = await findOperationItem(req.params.operationKey);
  const result = await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.ASSIGN, targetUserId: userId, note });
  res.status(200).json({
    success: true,
    data: { notification: result.notification },
    message: result.notification.delivered
      ? "Operation assigned"
      : "Operation assigned successfully, but the assignee could not be notified. They may not see this until they check the queue.",
  });
});

export const escalateOperation = asyncHandler(async (req, res) => {
  const { userId, note } = req.body;
  const item = await findOperationItem(req.params.operationKey);
  const result = await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.ESCALATE, targetUserId: userId, note });
  res.status(200).json({
    success: true,
    data: { notification: result.notification },
    message: result.notification.delivered
      ? "Operation escalated"
      : "Operation escalated successfully, but the escalation target could not be notified. They may not see this until they check the queue.",
  });
});

export const resolveOperation = asyncHandler(async (req, res) => {
  const { note } = req.body;
  const item = await findOperationItem(req.params.operationKey);
  await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.RESOLVE, note });
  res.status(200).json({
    success: true,
    data: null,
    message:
      "Operation marked resolved in the queue. This does not change the underlying record — use the linked page for the real approve/reject/review action if you haven't already.",
  });
});

export const cancelOperation = asyncHandler(async (req, res) => {
  const { note } = req.body;
  const item = await findOperationItem(req.params.operationKey);
  await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.CANCEL, note });
  res.status(200).json({ success: true, data: null, message: "Operation cancelled" });
});

export const pinOperation = asyncHandler(async (req, res) => {
  const { pinned } = req.body;
  const item = await findOperationItem(req.params.operationKey);
  await executeWorkflowTransition({ req, item, action: WORKFLOW_ACTIONS.PIN, pinned });
  res.status(200).json({ success: true, data: null, message: pinned ? "Operation pinned" : "Operation unpinned" });
});

// ── AI Operations Summary (Step 12) ─────────────────────────────────────
// Reuses the existing promptLibrary/templateProvider/generativeAssistant
// pipeline — no new AI system. Grounded only in the real item context the
// controller itself re-fetches server-side.
export const getOperationAiSummary = asyncHandler(async (req, res) => {
  const { operationKey: key } = req.params;
  const item = await findOperationItem(key);
  const result = await generativeAssistant.operationSummary({
    typeLabel: item.typeLabel,
    priority: item.priority,
    reason: item.reason,
    businessImpact: item.businessImpact,
    recommendedAction: item.recommendedAction,
    slaState: item.sla.state,
    elapsedHours: Math.round(item.sla.elapsedMs / (60 * 60 * 1000)),
    relatedCount: item.relatedCount || 0,
  });
  res.status(200).json({ success: true, data: result, message: "Operation summary generated" });
});

// ── Business Rules extension (Step 6/7 documentation) ───────────────────
// Extends the existing getBusinessRules surface (executiveActionController)
// conceptually — kept as its own read here so the Operations Inbox can
// fetch it without depending on the Executive Action Center route.
//
// Phase A6.2.1: the priorityRules/slaTargets text below was previously
// hand-typed a second time in this function, duplicating the same strings
// already in workflowRegistry.js's per-type `priorityRule`/`slaRule` fields.
// It is now generated FROM the registry so there is exactly one place this
// wording is authored. The response shape (slaTargets/priorityRules/
// assignmentModel keys) is unchanged so no frontend caller needed updates.
export const getOperationsBusinessRules = asyncHandler(async (_req, res) => {
  const priorityRules = {};
  for (const def of listWorkflowDefinitions()) {
    priorityRules[def.key] = def.priorityRule;
  }
  res.status(200).json({
    success: true,
    data: {
      slaTargets: {
        critical: "4 hours from creation",
        high: "24 hours from creation",
        medium: "3 days from creation",
        low: "7 days from creation",
      },
      priorityRules,
      assignmentModel: "Reuses the existing Permission/role model — assignable users are any admin or super_admin, no new roles were introduced.",
    },
    message: "Operations business rules fetched successfully",
  });
});

// ── Workflow Registry Viewer (Step 9) ────────────────────────────────────
// Read-only: returns the full Workflow Registry (backend/workflow/
// workflowRegistry.js) for the new Workflow Engine Inspector frontend.
export const getWorkflowRegistry = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: { workflows: listWorkflowDefinitions() },
    message: "Workflow registry fetched successfully",
  });
});

// ── Lifecycle Viewer (Step 9) ─────────────────────────────────────────────
// Read-only: the one shared lifecycle graph (backend/workflow/
// workflowStateMachine.js) every workflow type in the registry uses.
export const getWorkflowLifecycle = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: getLifecycleGraph(),
    message: "Workflow lifecycle graph fetched successfully",
  });
});

// ── AI Workflow Explain (Step 12) ─────────────────────────────────────────
// New AI capability (workflowExplain), via the existing promptLibrary/
// templateProvider/generativeAssistant pipeline — no new AI system. Unlike
// getOperationAiSummary (operationSummary — a short operational summary of
// one item), this explains the ENGINE's own reasoning for that item: which
// registry definition applies, why the current lifecycle state/available
// actions are what they are, and what real dependency fields drove its
// priority/SLA. Grounded only in the real registry entry + item context the
// controller re-fetches server-side; never invents a policy that isn't in
// the registry.
export const getWorkflowExplain = asyncHandler(async (req, res) => {
  const { operationKey: key } = req.params;
  const item = await findOperationItem(key);
  const def = TYPE_META[item.type];
  if (!def) throw new AppError(`Unknown workflow type "${item.type}"`, 400);

  const result = await generativeAssistant.workflowExplain({
    typeLabel: def.label,
    department: def.department,
    category: def.category,
    priorityRule: def.priorityRule,
    slaRule: def.slaRule,
    dependencies: def.dependencies,
    currentStatus: item.status,
    allowedActions: listAllowedActions(item.status),
    priority: item.priority,
    reason: item.reason,
    businessImpact: item.businessImpact,
    recommendedAction: item.recommendedAction,
    slaState: item.sla.state,
    relatedCount: item.relatedCount || 0,
  });
  res.status(200).json({ success: true, data: result, message: "Workflow explanation generated" });
});

// Phase A6.2.2: findOperationItem added to this export so the Assignment
// Engine can resolve a single item by key exactly the way every existing
// lifecycle handler already does — never a second, parallel lookup.
export const _internal = { buildUnifiedQueue, fetchRawOperations, findOperationItem };

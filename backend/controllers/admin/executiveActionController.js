import Doctor from "../../models/Doctor.js";
import RefundRequest from "../../models/RefundRequest.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import Appointment from "../../models/Appointment.js";
import AIDraft from "../../models/AIDraft.js";
import AdminActivityLog from "../../models/AdminActivityLog.js";
import CronRunLog from "../../models/CronRunLog.js";
import FeatureToggle from "../../models/FeatureToggle.js";
import { APPOINTMENT_STATUS } from "../../constants/appointmentStatus.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { notificationEmitter } from "../../realtime/notificationEmitter.js";
import { ROLE_VALUES } from "../../constants/roles.js";
import { buildSmartAlerts, buildExecutiveDashboardData } from "./missionControlAdminController.js";
import { buildPlatformAnalyticsData } from "./overviewAdminController.js";
import { riskLevelFor, slotStartMinutes, EMERGENCY_PATTERN } from "../doctor/commandCenterController.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase A5.3 — Executive Action Center.
//
// AUDIT FINDINGS this phase is built on (see CHANGELOG-A5.3.md for the full
// list):
//   1. buildSmartAlerts() (A5.1) already produces real, condition-based
//      alerts with priority + link, but no owner/reason/impact/recommended
//      action/deadline — those are added here without re-querying anything
//      buildSmartAlerts already computed.
//   2. The platform-wide equivalents of "high risk patient" and "delayed
//      appointment" never existed — only the per-doctor Command Center had
//      them (commandCenterController.riskLevelFor/slotStartMinutes). Those
//      are now exported and reused verbatim at platform scope, so "high
//      risk" and "delayed" mean the exact same thing everywhere.
//   3. Doctor approvals/rejections and refund approvals/rejections were
//      never written to AdminActivityLog, so no single query could ever
//      produce a real cross-module timeline. Rather than retrofitting
//      writeAdminLog into those controllers (out of scope/risk for this
//      phase), the timeline below reads the real source-of-truth
//      collections directly and merges them — every event is a real
//      document, not a synthesized one.
//   4. notificationEmitter.emitToRole already exists and is a real
//      broadcast-to-role capability — it was just never exposed as an
//      admin action. The broadcast endpoint below reuses it directly.
//   5. There was no way to pause new registrations short of taking the
//      whole API down. FeatureToggle already exists and is a generic
//      key/isEnabled store — reused for a `registrations_paused` key that
//      authController.register now honors.
//   6. No structured failure/refund-reason taxonomy exists anywhere in the
//      data model (RefundRequest.reason is free text, Payment has no
//      failure-reason field). Recommendations below are therefore built
//      only from real counts/rates that ARE computed elsewhere
//      (buildPlatformAnalyticsData, buildExecutiveDashboardData) — no
//      invented "top reason" categorization.
// ─────────────────────────────────────────────────────────────────────────

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// ── Executive Action Center (Step 2) ────────────────────────────────────
// Static metadata registry keyed by the exact alert `key` buildSmartAlerts()
// already produces. Nothing here invents a new condition — it only adds the
// context (owner/reason/impact/recommendedAction/deadline/actionButton) an
// executive needs to act on an alert that already exists.
const ALERT_METADATA = {
  "doctor-verification-backlog": {
    owner: "Admin — Doctor Onboarding",
    reason: "Doctor verification requests have been waiting more than 2 days.",
    impact: "New doctors cannot accept appointments until verified, reducing platform capacity.",
    recommendedAction: "Review and verify pending doctor documents.",
    actionButton: { label: "Verify Doctor", route: "/admin/doctors" },
  },
  "refund-backlog": {
    owner: "Admin — Payments & Refunds",
    reason: "Refund requests have been pending for more than 7 days.",
    impact: "Delayed refunds directly affect patient trust and may increase support/dispute volume.",
    recommendedAction: "Approve or reject the oldest pending refund requests first.",
    actionButton: { label: "Approve Refund", route: "/admin/refunds" },
  },
  "insurance-expiring": {
    owner: "Admin — Patient Insurance",
    reason: "Insurance policies with an open claim expire within 14 days.",
    impact: "Claims may be rejected if the policy lapses before processing completes.",
    recommendedAction: "Review affected claims and notify patients to renew coverage.",
    actionButton: { label: "Review Insurance", route: "/admin/patients" },
  },
  "payment-failures": {
    owner: "Admin — Payments",
    reason: "Elevated payment failures in the last 7 days.",
    impact: "Failed payments block appointment confirmation and directly reduce revenue.",
    recommendedAction: "Check payment gateway status and review failed transaction patterns.",
    actionButton: { label: "Review Payments", route: "/admin/payments" },
  },
  "critical-reports": {
    owner: "Admin — Clinical Oversight",
    reason: "Medical reports marked critical have not been reviewed.",
    impact: "Delayed review of critical reports is a direct patient-safety risk.",
    recommendedAction: "Review critical reports immediately.",
    actionButton: { label: "Review Critical Reports", route: "/admin/patients" },
  },
  "unread-critical-notifications": {
    owner: "Admin — Operations",
    reason: "Critical system notifications have not been read.",
    impact: "Unread critical alerts may indicate an unresolved operational issue.",
    recommendedAction: "Review the notification center.",
    actionButton: { label: "Review Notifications", route: "/admin/notifications" },
  },
  "database-warning": {
    owner: "Admin — Platform Infrastructure",
    reason: "The database connection is not in a healthy state.",
    impact: "The platform may be degraded or fully unavailable for all users.",
    recommendedAction: "Check database connectivity immediately.",
    actionButton: { label: "Platform Health", route: "/admin/platform-health" },
  },
};

function deadlineFor(priority) {
  const now = Date.now();
  if (priority === "critical") return new Date(now + 4 * 60 * 60 * 1000); // 4h
  if (priority === "high") return new Date(now + 24 * 60 * 60 * 1000); // 1 day
  return new Date(now + 3 * 24 * 60 * 60 * 1000); // 3 days
}

export const buildActionCenterData = async () => {
  const today = startOfToday();
  const { alerts, counts } = await buildSmartAlerts();

  const enrichedAlerts = alerts.map((alert) => {
    const meta = ALERT_METADATA[alert.key] || {
      owner: "Admin",
      reason: alert.title,
      impact: "Requires admin attention.",
      recommendedAction: "Review and resolve.",
      actionButton: alert.link ? { label: "Review", route: alert.link } : null,
    };
    return {
      ...alert,
      ...meta,
      deadline: deadlineFor(alert.priority),
    };
  });

  // Platform-wide reuse of the exact Command Center risk/delay rules —
  // not a second definition of "high risk" or "delayed".
  const todaysAppointments = await Appointment.find({ date: { $gte: today } })
    .select("patientId reason symptoms painLevel timeSlot status")
    .populate("patientId", "name patientProfile.medicalConditions")
    .lean();

  const activeStatuses = [
    APPOINTMENT_STATUS.PENDING,
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.PAYMENT_COMPLETED,
    APPOINTMENT_STATUS.CONSULTATION_STARTED,
  ];
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const highRiskToday = todaysAppointments.filter((appt) => {
    const conditionCount = appt.patientId?.patientProfile?.medicalConditions?.length || 0;
    return riskLevelFor(appt.painLevel, conditionCount) === "high" && activeStatuses.includes(appt.status);
  });

  const delayedToday = todaysAppointments.filter((appt) => {
    const slotStart = slotStartMinutes(appt.timeSlot);
    return slotStart != null && slotStart < nowMinutes && activeStatuses.includes(appt.status);
  });

  const unreadAIDrafts = await AIDraft.countDocuments({ scope: { $in: ["admin", "shared"] }, status: "draft" });

  if (highRiskToday.length) {
    enrichedAlerts.push({
      key: "high-risk-patients-today",
      priority: "high",
      title: "High-risk patients on today's schedule",
      count: highRiskToday.length,
      link: "/admin/patients",
      owner: "Admin — Clinical Oversight",
      reason: "Patients today have a high pain level or 3+ recorded conditions (same rule used in the Doctor Command Center).",
      impact: "High-risk patients waiting in an active queue may need priority handling.",
      recommendedAction: "Confirm these patients are being prioritized by their doctor.",
      actionButton: { label: "Review Patients", route: "/admin/patients" },
      deadline: deadlineFor("high"),
    });
  }

  if (delayedToday.length) {
    enrichedAlerts.push({
      key: "delayed-appointments-today",
      priority: delayedToday.length > 10 ? "high" : "medium",
      title: "Appointments past their scheduled slot, still not completed",
      count: delayedToday.length,
      link: "/admin/appointments",
      owner: "Admin — Operations",
      reason: "These appointments' scheduled time slot has already passed without reaching a terminal status.",
      impact: "Platform-wide scheduling delays reduce patient satisfaction and doctor throughput.",
      recommendedAction: "Check with affected doctors for capacity or scheduling issues.",
      actionButton: { label: "Review Appointments", route: "/admin/appointments" },
      deadline: deadlineFor(delayedToday.length > 10 ? "high" : "medium"),
    });
  }

  if (unreadAIDrafts > 0) {
    enrichedAlerts.push({
      key: "unread-ai-drafts",
      priority: "low",
      title: "AI-drafted communications awaiting review",
      count: unreadAIDrafts,
      link: "/admin/notifications",
      owner: "Admin — Communications",
      reason: "AI-generated drafts require explicit human approval before anything is sent (no draft is ever auto-sent).",
      impact: "Drafts left unreviewed delay time-sensitive communications.",
      recommendedAction: "Review and approve or discard pending AI drafts.",
      actionButton: { label: "Review Drafts", route: "/admin/notifications" },
      deadline: deadlineFor("low"),
    });
  }

  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  enrichedAlerts.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return {
    cards: enrichedAlerts,
    counts: {
      ...counts,
      total: enrichedAlerts.length,
    },
  };
};

export const getActionCenter = asyncHandler(async (_req, res) => {
  const data = await buildActionCenterData();
  res.status(200).json({ success: true, data, message: "Executive action center fetched successfully" });
});

// ── Executive Recommendations (Step 4) + Decision Cards (Step 8) ───────
// Every recommendation is a deterministic, rule-based read of real data
// already produced by buildPlatformAnalyticsData / buildExecutiveDashboardData.
// No AI call, no invented category — "confidence" reflects real sample size,
// not a model's self-reported certainty.
export const buildExecutiveRecommendations = async () => {
  const [analytics, dashboard] = await Promise.all([buildPlatformAnalyticsData(14), buildExecutiveDashboardData()]);

  const recommendations = [];

  const revenueDays = analytics.revenuePerDay || [];
  const half = Math.floor(revenueDays.length / 2) || 1;
  const firstHalfTotal = revenueDays.slice(0, half).reduce((s, d) => s + d.total, 0);
  const secondHalfTotal = revenueDays.slice(half).reduce((s, d) => s + d.total, 0);
  const revenueDelta = firstHalfTotal ? Number((((secondHalfTotal - firstHalfTotal) / firstHalfTotal) * 100).toFixed(1)) : null;

  if (revenueDelta != null && revenueDelta < -10 && analytics.cancellationRate > 10) {
    recommendations.push({
      key: "revenue-cancellation-risk",
      priority: "high",
      title: "Revenue trending down alongside elevated cancellations",
      reason: `Revenue fell ${Math.abs(revenueDelta)}% over the last two 7-day windows, while the appointment cancellation rate is ${analytics.cancellationRate}% (over the 14-day window).`,
      businessImpact: "Sustained revenue decline compounds if cancellations continue at this rate.",
      confidence: revenueDays.length >= 14 ? "high" : "medium",
      recommendedAction: "Review the doctors/time-slots with the highest cancellation share and consider opening additional slots in high-demand specialties.",
    });
  }

  const [pendingRefunds, resolvedRefundsLast7d] = await Promise.all([
    RefundRequest.countDocuments({ status: "pending" }),
    RefundRequest.countDocuments({ status: { $in: ["approved", "rejected", "processed"] }, updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
  ]);

  if (pendingRefunds > resolvedRefundsLast7d) {
    recommendations.push({
      key: "refund-backlog-growth",
      priority: pendingRefunds > resolvedRefundsLast7d * 2 ? "critical" : "high",
      title: "Refund backlog is growing faster than it is being processed",
      reason: `${pendingRefunds} refund request(s) are currently pending, versus ${resolvedRefundsLast7d} resolved (approved/rejected/processed) in the last 7 days.`,
      businessImpact: "A growing backlog increases average resolution time and patient dissatisfaction.",
      confidence: resolvedRefundsLast7d >= 5 ? "high" : "medium",
      recommendedAction: "Allocate additional admin time to refund review, prioritizing the oldest requests first.",
    });
  }

  if (dashboard.platformHealth.paymentFailureRate > 5) {
    recommendations.push({
      key: "payment-failure-rate",
      priority: "medium",
      title: "Payment failure rate above the healthy threshold",
      reason: `Payment failure rate over the last 7 days is ${dashboard.platformHealth.paymentFailureRate}%, above the 5% threshold used in the platform health score.`,
      businessImpact: "Failed payments block appointment confirmation, directly reducing completed bookings.",
      confidence: "high",
      recommendedAction: "Review recent failed transactions for a common gateway or card-network pattern.",
    });
  }

  return recommendations;
};

export const getExecutiveRecommendations = asyncHandler(async (_req, res) => {
  const data = await buildExecutiveRecommendations();
  res.status(200).json({ success: true, data, message: "Executive recommendations fetched successfully" });
});

export const getDecisionCards = asyncHandler(async (_req, res) => {
  const [dashboard, recommendations, { counts }] = await Promise.all([
    buildExecutiveDashboardData(),
    buildExecutiveRecommendations(),
    buildSmartAlerts(),
  ]);

  const cards = recommendations.map((r) => ({
    key: r.key,
    priority: r.priority,
    title: r.title,
    detail: r.reason,
    recommendedAction: r.recommendedAction,
    confidence: r.confidence,
  }));

  if (!cards.length && counts.critical === 0 && counts.high === 0) {
    cards.push({
      key: "platform-stable",
      priority: "info",
      title: "Platform stable",
      detail: `Platform health score is ${dashboard.platformHealth.score}/100 with no critical or high-priority alerts open.`,
      recommendedAction: "No action needed.",
      confidence: "high",
    });
  }

  res.status(200).json({
    success: true,
    data: { healthScore: dashboard.platformHealth.score, cards },
    message: "Decision cards fetched successfully",
  });
});

// ── Executive Timeline (Step 7) ─────────────────────────────────────────
// Real events only, merged from the actual source-of-truth collections
// (see audit finding #3 above) rather than a synthetic event log.
export const buildExecutiveTimeline = async (limit = 50) => {
  const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    adminLogs,
    doctorDecisions,
    refundDecisions,
    criticalReports,
    insuranceSubmissions,
    failedCronRuns,
    failedPayments,
    aiDrafts,
  ] = await Promise.all([
    AdminActivityLog.find({ createdAt: { $gte: since } }).select("action resourceType createdAt severity").sort({ createdAt: -1 }).limit(boundedLimit).lean(),
    Doctor.find({ verificationStatus: { $in: ["approved", "rejected"] }, updatedAt: { $gte: since } }).select("verificationStatus updatedAt userId").sort({ updatedAt: -1 }).limit(boundedLimit).populate("userId", "name").lean(),
    RefundRequest.find({ status: { $in: ["approved", "rejected"] }, updatedAt: { $gte: since } }).select("status amount updatedAt").sort({ updatedAt: -1 }).limit(boundedLimit).lean(),
    MedicalReport.find({ severity: "critical", createdAt: { $gte: since } }).select("title createdAt").sort({ createdAt: -1 }).limit(boundedLimit).lean(),
    Insurance.find({ createdAt: { $gte: since } }).select("provider createdAt claimStatus").sort({ createdAt: -1 }).limit(boundedLimit).lean(),
    CronRunLog.find({ status: "failed", createdAt: { $gte: since } }).select("jobName createdAt error").sort({ createdAt: -1 }).limit(boundedLimit).lean(),
    Payment.countDocuments({ status: PAYMENT_STATUS.FAILED, createdAt: { $gte: since } }) > 0
      ? Payment.find({ status: PAYMENT_STATUS.FAILED, createdAt: { $gte: since } }).select("createdAt totalAmount").sort({ createdAt: -1 }).limit(boundedLimit).lean()
      : [],
    AIDraft.find({ createdAt: { $gte: since } }).select("promptKey scope createdAt status").sort({ createdAt: -1 }).limit(boundedLimit).lean(),
  ]);

  const events = [
    ...adminLogs.map((l) => ({ type: "Admin Action", label: `${l.action} (${l.resourceType})`, at: l.createdAt, severity: l.severity })),
    ...doctorDecisions.map((d) => ({ type: d.verificationStatus === "approved" ? "Doctor Approved" : "Doctor Rejected", label: d.userId?.name || "Doctor", at: d.updatedAt, severity: "info" })),
    ...refundDecisions.map((r) => ({ type: r.status === "approved" ? "Refund Approved" : "Refund Rejected", label: `Amount: ${r.amount}`, at: r.updatedAt, severity: "info" })),
    ...criticalReports.map((m) => ({ type: "Critical Report Uploaded", label: m.title, at: m.createdAt, severity: "critical" })),
    ...insuranceSubmissions.map((i) => ({ type: "Insurance Submitted", label: `${i.provider} (${i.claimStatus})`, at: i.createdAt, severity: "info" })),
    ...failedCronRuns.map((c) => ({ type: "Cron Failed", label: `${c.jobName}: ${c.error || "unknown error"}`, at: c.createdAt, severity: "critical" })),
    ...failedPayments.map((p) => ({ type: "Payment Failed", label: `Amount: ${p.totalAmount}`, at: p.createdAt, severity: "high" })),
    ...aiDrafts.map((a) => ({ type: "AI Generated", label: `${a.promptKey} (${a.scope})`, at: a.createdAt, severity: "info" })),
  ]
    .filter((e) => e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, boundedLimit);

  return events;
};

export const getExecutiveTimeline = asyncHandler(async (req, res) => {
  const data = await buildExecutiveTimeline(req.query.limit);
  res.status(200).json({ success: true, data, message: "Executive timeline fetched successfully" });
});

// ── Business Rules (Step 11) ────────────────────────────────────────────
// Static documentation of the real formulas/thresholds already implemented
// in code — nothing here is a description of a rule that doesn't exist.
export const getBusinessRules = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      platformHealthScore: {
        formula: "Starts at 100. -1 per % cancellation rate above 10%. -1 per % payment failure rate above 5%. -10 if database is unhealthy. -5 per unresolved critical alert (capped at -25). Floored at 0.",
        source: "missionControlAdminController.computeHealthScore",
      },
      patientRiskLevel: {
        formula: "high: pain level >= 7 OR 3+ recorded conditions. medium: pain level >= 4 OR 1+ recorded conditions. low: otherwise.",
        source: "commandCenterController.riskLevelFor",
      },
      smartAlertThresholds: {
        doctorVerificationBacklog: "Verification pending more than 2 days.",
        refundBacklog: "Refund request pending more than 7 days.",
        insuranceExpiring: "Policy with open claim expiring within 14 days.",
        criticalReports: "Medical report marked critical, not yet reviewed.",
      },
      recommendationThresholds: {
        revenueCancellationRisk: "Revenue down >10% over two 7-day windows AND cancellation rate >10% over 14 days.",
        refundBacklogGrowth: "Pending refunds exceed refunds resolved in the last 7 days.",
        paymentFailureRate: "Payment failure rate over the last 7 days exceeds 5%.",
      },
    },
    message: "Business rules fetched successfully",
  });
});

// ── Quick Actions: Broadcast Announcement (Step 5) ──────────────────────
// Reuses the existing notificationEmitter.emitToRole — no new notification
// pipeline. Every recipient role must be a real role in this codebase.
export const broadcastAnnouncement = asyncHandler(async (req, res) => {
  const { roles, title, message, severity } = req.body;
  if (!title || !message) throw new AppError("title and message are required", 400);

  const targetRoles = Array.isArray(roles) && roles.length ? roles : ROLE_VALUES.filter((r) => r !== "admin" && r !== "super_admin");
  const invalid = targetRoles.filter((r) => !ROLE_VALUES.includes(r));
  if (invalid.length) throw new AppError(`Unknown role(s): ${invalid.join(", ")}`, 400);

  const results = await Promise.all(
    targetRoles.map((role) =>
      notificationEmitter.emitToRole(role, {
        type: "admin_announcement",
        title,
        message,
        severity: severity || "info",
        actorId: req.user._id,
      }),
    ),
  );

  await writeAdminLog({
    req,
    action: "executive.broadcast_announcement",
    resourceType: "announcement",
    resourceId: null,
    metadata: { roles: targetRoles, title },
  });

  res.status(200).json({
    success: true,
    data: { rolesNotified: targetRoles, recipientCount: results.reduce((s, r) => s + r.length, 0) },
    message: "Announcement broadcast successfully",
  });
});

// ── Quick Actions: Pause / Resume Registrations (Step 5) ────────────────
// Reuses the existing generic FeatureToggle model — no new schema.
export const setRegistrationsPaused = asyncHandler(async (req, res) => {
  const paused = Boolean(req.body.paused);
  const feature = await FeatureToggle.findOneAndUpdate(
    { key: "registrations_paused" },
    {
      key: "registrations_paused",
      label: "Pause New Registrations",
      description: "When enabled, new account registrations (patient and doctor) are blocked platform-wide.",
      isEnabled: paused,
      updatedBy: req.user._id,
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  );

  await writeAdminLog({
    req,
    action: paused ? "executive.registrations_paused" : "executive.registrations_resumed",
    resourceType: "feature_toggle",
    resourceId: "registrations_paused",
  });

  res.status(200).json({ success: true, data: { feature }, message: `Registrations ${paused ? "paused" : "resumed"} successfully` });
});

// ── AI Explain Everything (Step 10) ─────────────────────────────────────
// Whitelisted, server-recomputed metrics only — the client cannot pass in
// numbers to "explain"; every explanation is grounded in a fresh call to the
// same builder that produced the number shown on screen.
const EXPLAINABLE_METRICS = new Set(["healthScore", "cancellationRate", "paymentFailureRate", "refundBacklog"]);

export const explainMetric = asyncHandler(async (req, res) => {
  const { metricKey } = req.params;
  if (!EXPLAINABLE_METRICS.has(metricKey)) throw new AppError(`Metric "${metricKey}" is not explainable`, 400);

  const dashboard = await buildExecutiveDashboardData();
  let context;

  if (metricKey === "healthScore") {
    context = { metricKey, value: dashboard.platformHealth.score, breakdown: dashboard.platformHealth.breakdown };
  } else if (metricKey === "cancellationRate") {
    context = { metricKey, value: dashboard.platformHealth.cancellationRate, threshold: 10 };
  } else if (metricKey === "paymentFailureRate") {
    context = { metricKey, value: dashboard.platformHealth.paymentFailureRate, threshold: 5 };
  } else if (metricKey === "refundBacklog") {
    const pendingRefunds = await RefundRequest.countDocuments({ status: "pending" });
    context = { metricKey, value: pendingRefunds };
  }

  const result = await generativeAssistant.metricExplain(context);
  res.status(200).json({ success: true, data: result, message: "Metric explanation generated" });
});

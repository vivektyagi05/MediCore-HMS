import mongoose from "mongoose";
import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import User from "../../models/User.js";
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import Review from "../../models/Review.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import AIDraft from "../../models/AIDraft.js";
import OnlineSession from "../../models/OnlineSession.js";
import NotificationDelivery from "../../models/NotificationDelivery.js";
import ReminderLog from "../../models/ReminderLog.js";
import { ROLES } from "../../constants/roles.js";
import { APPOINTMENT_STATUS } from "../../constants/appointmentStatus.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getIO } from "../../socket/socketServer.js";
import { onlineFilter } from "../../socket/presenceQuery.js";
import { emailService } from "../../services/emailService.js";
import { buildPlatformOverviewData } from "./overviewAdminController.js";
import { EMERGENCY_PATTERN } from "../doctor/commandCenterController.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase A5.1 — Executive Dashboard + Live Platform (Mission Control) +
// Smart Alert Center.
//
// Every builder below is ADDITIVE: it reuses buildPlatformOverviewData()
// (the same aggregate the existing /admin/overview endpoint and the AI
// executive brief both already depend on) and layers new, independently
// real aggregates on top. Nothing here re-derives revenue, appointment, or
// pending-approval counts a second time — those still come from exactly
// one place.
//
// Every KPI documents its own computation inline. Where the original
// A5.1 brief asked for a signal this codebase has no real data source for
// (e.g. "late arrivals" distinct from "delayed", a dedicated complaint
// system, RBAC roles named Finance/Support/Operations, a background job
// queue, an SMS provider), it is intentionally left out rather than
// fabricated — see CHANGELOG-A5.1.md for the full list of documented gaps.
// ─────────────────────────────────────────────────────────────────────────

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfLastWeek = () => {
  const d = startOfToday();
  d.setDate(d.getDate() - 7);
  return d;
};

// Mongoose connection.readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
const DB_STATUS_LABELS = ["disconnected", "connected", "connecting", "disconnecting"];

function dbStatus() {
  const state = mongoose.connection.readyState;
  return {
    state: DB_STATUS_LABELS[state] || "unknown",
    healthy: state === 1,
  };
}

function socketStatus() {
  const io = getIO();
  if (!io) return { healthy: false, connectedClients: 0 };
  return {
    healthy: true,
    // Real live connected-socket count from the actual Socket.IO engine —
    // not a random or cached number.
    connectedClients: io.engine?.clientsCount ?? io.sockets?.sockets?.size ?? 0,
  };
}

// Real, currently-integrated notification channels only. SMS has no
// provider wired into this codebase (ReminderLog only has an unused
// "sms_ready" channel enum) — reported as not integrated rather than
// faked as online.
function channelStatus() {
  return {
    email: { healthy: emailService.isConfigured(), configured: emailService.isConfigured() },
    sms: { healthy: false, configured: false, note: "No SMS provider is integrated in this codebase yet" },
  };
}

// ── Platform Health Score ───────────────────────────────────────────────
// Transparent, fully-explained composite out of 100. Every card that shows
// it must be able to show this same breakdown — no hidden weighting.
//   - Starts at 100
//   - -1 point per percentage point of 7-day cancellation rate above 10%
//   - -1 point per percentage point of 7-day payment-failure rate above 5%
//   - -10 points if the database is not in a healthy connected state
//   - -5 points per unresolved critical alert (capped at -25)
// Floored at 0.
function computeHealthScore({ cancellationRate, paymentFailureRate, dbHealthy, criticalAlertCount }) {
  let score = 100;
  const explain = [];

  const cancellationOver = Math.max(0, cancellationRate - 10);
  if (cancellationOver > 0) {
    score -= cancellationOver;
    explain.push(`-${cancellationOver.toFixed(1)} for cancellation rate ${cancellationRate.toFixed(1)}% (>10% threshold)`);
  }

  const failureOver = Math.max(0, paymentFailureRate - 5);
  if (failureOver > 0) {
    score -= failureOver;
    explain.push(`-${failureOver.toFixed(1)} for payment failure rate ${paymentFailureRate.toFixed(1)}% (>5% threshold)`);
  }

  if (!dbHealthy) {
    score -= 10;
    explain.push("-10 for database not in a healthy connected state");
  }

  const criticalPenalty = Math.min(25, criticalAlertCount * 5);
  if (criticalPenalty > 0) {
    score -= criticalPenalty;
    explain.push(`-${criticalPenalty} for ${criticalAlertCount} unresolved critical alert(s)`);
  }

  return { score: Math.max(0, Math.round(score)), explain };
}

// ── Executive Dashboard ─────────────────────────────────────────────────
export const buildExecutiveDashboardData = async () => {
  const today = startOfToday();
  const lastWeek = startOfLastWeek();

  const [
    overview,
    liveConsultations,
    insuranceQueueCount,
    aiRequestsToday,
    criticalReportsPending,
    ratingAgg,
    newDoctorsToday,
    newPatientsToday,
    newReviewsToday,
    patientsThisWeek,
    patientsLastWeek,
    doctorsThisWeek,
    doctorsLastWeek,
    todaysAppointmentsForEmergencyScan,
    paymentFailuresLast7d,
    paymentAttemptsLast7d,
    repeatPatientAgg,
    onlineDoctors,
    onlinePatients,
  ] = await Promise.all([
    buildPlatformOverviewData(),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.CONSULTATION_STARTED }),
    Insurance.countDocuments({ claimStatus: { $in: ["submitted", "in_review"] } }),
    AIDraft.countDocuments({ createdAt: { $gte: today } }),
    MedicalReport.countDocuments({ severity: "critical", reviewedAt: null }),
    Review.aggregate([
      { $match: { adminDeleted: { $ne: true } } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]),
    Doctor.countDocuments({ createdAt: { $gte: today } }),
    User.countDocuments({ role: ROLES.PATIENT, createdAt: { $gte: today } }),
    Review.countDocuments({ createdAt: { $gte: today }, adminDeleted: { $ne: true } }),
    User.countDocuments({ role: ROLES.PATIENT, createdAt: { $gte: lastWeek } }),
    User.countDocuments({ role: ROLES.PATIENT, createdAt: { $gte: new Date(lastWeek.getTime() - 7 * 86400000), $lt: lastWeek } }),
    Doctor.countDocuments({ createdAt: { $gte: lastWeek } }),
    Doctor.countDocuments({ createdAt: { $gte: new Date(lastWeek.getTime() - 7 * 86400000), $lt: lastWeek } }),
    Appointment.find({ date: { $gte: today } }).select("reason symptoms").lean(),
    Payment.countDocuments({ status: PAYMENT_STATUS.FAILED, createdAt: { $gte: lastWeek } }),
    Payment.countDocuments({ createdAt: { $gte: lastWeek } }),
    Appointment.aggregate([
      { $match: { status: { $in: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE] } } },
      { $group: { _id: "$patientId", visits: { $sum: 1 } } },
      { $match: { visits: { $gte: 2 } } },
      { $count: "repeatPatients" },
    ]),
    OnlineSession.countDocuments(onlineFilter({ role: ROLES.DOCTOR })),
    OnlineSession.countDocuments(onlineFilter({ role: ROLES.PATIENT })),
  ]);

  const emergencyToday = todaysAppointmentsForEmergencyScan.filter((appt) =>
    EMERGENCY_PATTERN.test(`${appt.reason || ""} ${(appt.symptoms || []).join(" ")}`),
  ).length;

  // Platform-wide cancellation rate across all appointments (not just
  // today's), derived from the same statusBreakdown buildPlatformOverviewData
  // already computes — no second aggregate query.
  const statusBreakdown = overview.appointments.statusBreakdown || {};
  const totalAppointmentCount = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);
  const cancellationRate = totalAppointmentCount ? ((statusBreakdown.cancelled || 0) / totalAppointmentCount) * 100 : 0;

  const paymentFailureRate = paymentAttemptsLast7d ? (paymentFailuresLast7d / paymentAttemptsLast7d) * 100 : 0;

  const db = dbStatus();

  // Weekly patient/doctor growth % — real week-over-week comparison, "0%"
  // (not hidden) when the prior week had zero to divide by.
  const patientGrowthPct = patientsLastWeek ? Number((((patientsThisWeek - patientsLastWeek) / patientsLastWeek) * 100).toFixed(1)) : null;
  const doctorGrowthPct = doctorsLastWeek ? Number((((doctorsThisWeek - doctorsLastWeek) / doctorsLastWeek) * 100).toFixed(1)) : null;

  // Uses the same unreviewed-critical-report count as its "unresolved
  // critical alert" proxy (the fuller, multi-condition alert list lives in
  // buildSmartAlerts — re-running all of those queries here just to score
  // health would duplicate work for a number this dashboard doesn't display
  // item-by-item anyway).
  const { score: platformHealthScore, explain: healthScoreBreakdown } = computeHealthScore({
    cancellationRate,
    paymentFailureRate,
    dbHealthy: db.healthy,
    criticalAlertCount: criticalReportsPending,
  });

  return {
    ...overview,
    liveConsultations,
    insuranceQueue: insuranceQueueCount,
    aiRequestsToday,
    criticalReportsPending,
    emergencyToday,
    averageRating: ratingAgg[0]?.avg ? Number(ratingAgg[0].avg.toFixed(2)) : null,
    ratedReviewCount: ratingAgg[0]?.count || 0,
    today: {
      newDoctors: newDoctorsToday,
      newPatients: newPatientsToday,
      newReviews: newReviewsToday,
    },
    growth: {
      patientsWeekOverWeek: patientGrowthPct,
      doctorsWeekOverWeek: doctorGrowthPct,
    },
    repeatPatients: repeatPatientAgg[0]?.repeatPatients || 0,
    presence: {
      doctorsOnline: onlineDoctors,
      patientsOnline: onlinePatients,
    },
    system: {
      database: db,
      socket: socketStatus(),
      channels: channelStatus(),
    },
    platformHealth: {
      score: platformHealthScore,
      breakdown: healthScoreBreakdown,
      cancellationRate: Number(cancellationRate.toFixed(1)),
      paymentFailureRate: Number(paymentFailureRate.toFixed(1)),
    },
  };
};

export const getExecutiveDashboard = asyncHandler(async (_req, res) => {
  const data = await buildExecutiveDashboardData();
  res.status(200).json({
    success: true,
    data,
    message: "Executive dashboard fetched successfully",
  });
});

// ── Live Platform / Mission Control ─────────────────────────────────────
export const buildMissionControlData = async () => {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [
    doctorsOnline,
    patientsOnline,
    activeSessions,
    liveConsultations,
    livePaymentsLastHour,
    pendingRefunds,
    recentAIActivity,
    notificationsLast15Min,
    lastAutomationRun,
  ] = await Promise.all([
    OnlineSession.countDocuments(onlineFilter({ role: ROLES.DOCTOR })),
    OnlineSession.countDocuments(onlineFilter({ role: ROLES.PATIENT })),
    OnlineSession.countDocuments(onlineFilter()),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.CONSULTATION_STARTED }),
    Payment.countDocuments({ status: PAYMENT_STATUS.CAPTURED, paidAt: { $gte: oneHourAgo } }),
    RefundRequest.countDocuments({ status: "pending" }),
    AIDraft.countDocuments({ createdAt: { $gte: fifteenMinutesAgo } }),
    NotificationDelivery.countDocuments({ createdAt: { $gte: fifteenMinutesAgo } }),
    ReminderLog.findOne({}).sort({ createdAt: -1 }).select("createdAt").lean(),
  ]);

  return {
    presence: {
      doctorsOnline,
      patientsOnline,
      activeSessions,
    },
    liveConsultations,
    livePaymentsLastHour,
    pendingRefunds,
    // There is no background job queue (Bull/Agenda/etc.) in this codebase.
    // The AI automation pipeline (backend/automation/cronJobs.js) is
    // triggered on demand via POST /api/ai/automation/run, not on a
    // schedule — reported honestly here rather than invented as a
    // "running jobs" counter.
    aiActivityLast15Min: recentAIActivity,
    notificationsLast15Min,
    automation: {
      triggerModel: "on-demand (no scheduler configured)",
      lastRunAt: lastAutomationRun?.createdAt || null,
    },
    system: {
      database: dbStatus(),
      socket: socketStatus(),
      channels: channelStatus(),
    },
  };
};

export const getMissionControl = asyncHandler(async (_req, res) => {
  const data = await buildMissionControlData();
  res.status(200).json({
    success: true,
    data,
    message: "Mission control data fetched successfully",
  });
});

// ── Smart Alert Center ───────────────────────────────────────────────────
// Every alert below is generated from a real, queryable condition. Grouped
// by priority; each entry links to the existing admin page that already
// handles it (no new resolution UI duplicated).
export const buildSmartAlerts = async () => {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysFromNow = new Date(now + 14 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);

  const [
    staleDoctorVerifications,
    staleRefunds,
    expiringInsurance,
    recentFailedPayments,
    criticalUnreviewedReports,
    unreadCriticalNotifications,
  ] = await Promise.all([
    Doctor.find({ verificationStatus: "pending", createdAt: { $lte: twoDaysAgo } }).select("createdAt").lean(),
    RefundRequest.find({ status: "pending", createdAt: { $lte: sevenDaysAgo } }).select("createdAt amount").lean(),
    Insurance.find({
      validTill: { $gte: new Date(now), $lte: fourteenDaysFromNow },
      claimStatus: { $nin: ["approved", "rejected"] },
    })
      .select("validTill provider")
      .lean(),
    Payment.countDocuments({ status: PAYMENT_STATUS.FAILED, createdAt: { $gte: sevenDaysAgo } }),
    MedicalReport.find({ severity: "critical", reviewedAt: null }).select("title createdAt").lean(),
    NotificationDelivery.countDocuments({ severity: "critical", readAt: null }),
  ]);

  const alerts = [];

  if (staleDoctorVerifications.length) {
    alerts.push({
      key: "doctor-verification-backlog",
      priority: "high",
      title: "Doctor verifications waiting over 2 days",
      count: staleDoctorVerifications.length,
      link: "/admin/doctors",
    });
  }

  if (staleRefunds.length) {
    alerts.push({
      key: "refund-backlog",
      priority: "critical",
      title: "Refund requests pending over 7 days",
      count: staleRefunds.length,
      link: "/admin/refunds",
    });
  }

  if (expiringInsurance.length) {
    alerts.push({
      key: "insurance-expiring",
      priority: "medium",
      title: "Insurance policies expiring within 14 days with open claims",
      count: expiringInsurance.length,
      link: "/admin/patients",
    });
  }

  if (recentFailedPayments > 0) {
    alerts.push({
      key: "payment-failures",
      priority: recentFailedPayments > 5 ? "high" : "medium",
      title: "Payment failures in the last 7 days",
      count: recentFailedPayments,
      link: "/admin/payments",
    });
  }

  if (criticalUnreviewedReports.length) {
    alerts.push({
      key: "critical-reports",
      priority: "critical",
      title: "Critical medical reports awaiting review",
      count: criticalUnreviewedReports.length,
      link: "/admin/patients",
    });
  }

  if (unreadCriticalNotifications > 0) {
    alerts.push({
      key: "unread-critical-notifications",
      priority: "critical",
      title: "Unread critical admin notifications",
      count: unreadCriticalNotifications,
      link: "/admin/notifications",
    });
  }

  const db = dbStatus();
  if (!db.healthy) {
    alerts.push({
      key: "database-warning",
      priority: "critical",
      title: `Database connection is ${db.state}, not connected`,
      count: 1,
      link: null,
    });
  }

  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return {
    alerts,
    counts: {
      critical: alerts.filter((a) => a.priority === "critical").length,
      high: alerts.filter((a) => a.priority === "high").length,
      medium: alerts.filter((a) => a.priority === "medium").length,
      low: alerts.filter((a) => a.priority === "low").length,
    },
  };
};

export const getSmartAlerts = asyncHandler(async (_req, res) => {
  const data = await buildSmartAlerts();
  res.status(200).json({
    success: true,
    data,
    message: "Smart alerts fetched successfully",
  });
});

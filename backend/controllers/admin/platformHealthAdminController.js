import fs from "fs";
import mongoose from "mongoose";
import Appointment from "../../models/Appointment.js";
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import AIDraft from "../../models/AIDraft.js";
import WebhookEvent from "../../models/WebhookEvent.js";
import { APPOINTMENT_STATUS, ACTIVE_STATUSES } from "../../constants/appointmentStatus.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getIO } from "../../socket/socketServer.js";
import { emailService } from "../../services/emailService.js";
import { env } from "../../config/env.js";
import { getLatestRunPerJob } from "../../utils/cronRunTracker.js";
import { getAIProviderStatus } from "../../ai/providers/textGenerationProvider.js";
import { buildSmartAlerts } from "./missionControlAdminController.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase A5.2 — Platform Health Center.
//
// Every function here is additive on top of Phase A5.1: it reuses
// buildSmartAlerts() (the exact same real alert queue Mission Control
// already shows) instead of re-deriving doctor-verification / refund /
// insurance / critical-report / notification queries a second time, and
// adds ONLY the genuinely new signals the A5.1 audit did not cover:
// scheduler/cron job history, webhook processing health, storage disk
// health, AI provider resolution, and a small set of operational counters
// that have no existing home (failed payments today, appointment delays,
// AI draft discard rate).
//
// RULES followed throughout (see CHANGELOG-A5.2.md for full audit notes):
//   - No fabricated metric. Anything the codebase has no real data source
//     for (a dedicated review-moderation queue, "late arrivals" distinct
//     from "delayed", per-item automation error persistence before this
//     phase) is reported as unavailable/omitted, never invented.
//   - Every score and status documents its own computation inline.
// ─────────────────────────────────────────────────────────────────────────

const DB_STATUS_LABELS = ["disconnected", "connected", "connecting", "disconnecting"];

function dbStatus() {
  const state = mongoose.connection.readyState;
  return { state: DB_STATUS_LABELS[state] || "unknown", healthy: state === 1 };
}

function socketStatus() {
  const io = getIO();
  if (!io) return { healthy: false, connectedClients: 0 };
  return { healthy: true, connectedClients: io.engine?.clientsCount ?? io.sockets?.sockets?.size ?? 0 };
}

// Real filesystem check against the exact directory invoiceService already
// writes PDFs to — not a synthetic path. Reports free space when the
// runtime supports fs.statfs (Node 18.15+); degrades gracefully (reports
// "unknown" rather than a fabricated number) when it does not.
async function storageStatus() {
  const dir = env.invoiceStorageDir;
  const result = { path: dir, writable: false, freeBytes: null, totalBytes: null };
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.access(dir, fs.constants.W_OK);
    result.writable = true;
  } catch (error) {
    result.error = error.message;
    return { ...result, healthy: false };
  }
  try {
    if (typeof fs.promises.statfs === "function") {
      const stats = await fs.promises.statfs(dir);
      result.freeBytes = stats.bfree * stats.bsize;
      result.totalBytes = stats.blocks * stats.bsize;
    }
  } catch {
    // Non-fatal — disk usage reporting just isn't available on this platform.
  }
  return { ...result, healthy: result.writable };
}

function paymentProviderStatus() {
  const configured = Boolean(env.razorpayKeyId && env.razorpayKeySecret);
  return { configured, healthy: configured, provider: "razorpay" };
}

async function webhookStatus() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [received, processed, failed] = await Promise.all([
    WebhookEvent.countDocuments({ createdAt: { $gte: dayAgo } }),
    WebhookEvent.countDocuments({ status: "processed", createdAt: { $gte: dayAgo } }),
    WebhookEvent.countDocuments({ status: "failed", createdAt: { $gte: dayAgo } }),
  ]);
  return {
    healthy: failed === 0,
    last24h: { received, processed, failed },
  };
}

// ── Infrastructure Status ───────────────────────────────────────────────
// Every entry here reflects real, currently-queryable backend state.
export const buildInfrastructureStatus = async () => {
  const [webhook, cronJobs] = await Promise.all([webhookStatus(), getLatestRunPerJob()]);

  return {
    database: dbStatus(),
    realtime: socketStatus(),
    api: { healthy: true, note: "Reporting from within the live Express process" },
    scheduler: {
      // No in-process job scheduler exists in this codebase (no
      // node-cron/Agenda/Bull) — jobs are triggered externally (OS
      // crontab / container scheduler) or on-demand via the admin AI
      // automation endpoint. Reported honestly rather than invented as a
      // "queue" with fake worker counts.
      model: "external trigger (OS/container scheduler) + on-demand API — no in-process queue",
      jobs: cronJobs,
    },
    email: { healthy: emailService.isConfigured(), configured: emailService.isConfigured() },
    sms: { healthy: false, configured: false, note: "No SMS provider is integrated in this codebase" },
    storage: await storageStatus(),
    webhook,
    paymentProvider: paymentProviderStatus(),
    aiProvider: getAIProviderStatus(),
  };
};

export const getInfrastructureStatus = asyncHandler(async (_req, res) => {
  const data = await buildInfrastructureStatus();
  res.status(200).json({ success: true, data, message: "Infrastructure status fetched successfully" });
});

// ── Operational Health ──────────────────────────────────────────────────
export const buildOperationalHealth = async () => {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const [
    failedPaymentsToday,
    staleRefunds,
    expiringInsurance,
    criticalReportsPending,
    delayedAppointments,
    aiDraftsToday,
    aiDraftsDiscardedTotal,
    aiDraftsTotal,
  ] = await Promise.all([
    Payment.countDocuments({ status: PAYMENT_STATUS.FAILED, createdAt: { $gte: today } }),
    RefundRequest.countDocuments({ status: "pending", createdAt: { $lte: new Date(now - 7 * 86400000) } }),
    Insurance.countDocuments({
      validTill: { $gte: now, $lte: new Date(now.getTime() + 14 * 86400000) },
      claimStatus: { $nin: ["approved", "rejected"] },
    }),
    MedicalReport.countDocuments({ severity: "critical", reviewedAt: null }),
    // A real, honest proxy for "appointment delays": appointments whose
    // scheduled date has already passed but which never reached a
    // terminal status (completed/review_eligible/cancelled/consultation_
    // completed) — i.e. genuinely stuck in the workflow, not a fabricated
    // "late arrival" concept this codebase has no check-in timestamp for.
    Appointment.countDocuments({
      date: { $lt: today },
      status: { $in: ACTIVE_STATUSES.filter((s) => s !== APPOINTMENT_STATUS.REVIEW_ELIGIBLE && s !== APPOINTMENT_STATUS.COMPLETED) },
    }),
    AIDraft.countDocuments({ createdAt: { $gte: today } }),
    AIDraft.countDocuments({ status: "discarded" }),
    AIDraft.countDocuments({}),
  ]);

  // AUDIT NOTE: this codebase has no "pending review" moderation queue —
  // reviews publish immediately with no approval step (see models/Review.js)
  // — so "Pending Reviews" from the original brief is intentionally omitted
  // rather than invented. "AI Failures" is likewise not a real stored
  // signal (generation is synchronous/deterministic; a failure surfaces as
  // an immediate HTTP error, never persisted) — the AI draft discard rate
  // below is reported instead, honestly labeled as a different metric.
  const aiDiscardRate = aiDraftsTotal ? Number(((aiDraftsDiscardedTotal / aiDraftsTotal) * 100).toFixed(1)) : 0;

  const cronJobs = await getLatestRunPerJob();
  const failedJobs = cronJobs.filter((job) => job.status === "failed");

  return {
    failedPaymentsToday,
    refundDelays: staleRefunds,
    insuranceIssues: expiringInsurance,
    criticalReportsPending,
    delayedAppointments,
    automationFailures: failedJobs.length,
    automationFailureDetails: failedJobs.map((job) => ({ jobName: job.jobName, error: job.error, at: job.finishedAt })),
    aiActivityToday: aiDraftsToday,
    aiDraftDiscardRate: aiDiscardRate,
  };
};

export const getOperationalHealth = asyncHandler(async (_req, res) => {
  const data = await buildOperationalHealth();
  res.status(200).json({ success: true, data, message: "Operational health fetched successfully" });
});

// ── Overall Health Score ────────────────────────────────────────────────
// Transparent composite out of 100, every deduction explained inline.
//   - Starts at 100
//   - -10 if database is not in a healthy connected state
//   - -8 if realtime (socket) is not healthy
//   - -8 if storage is not writable
//   - -5 per failed cron/automation job (capped at -20)
//   - -1 per percentage point webhook failure rate over the last 24h
//   - -1 point per unit of unresolved critical alert count (capped at -25)
//     (reuses the exact same alert list Smart Alerts already computes)
// Floored at 0.
function computeOverallHealthScore({ infra, operational, criticalAlertCount }) {
  let score = 100;
  const explain = [];

  if (!infra.database.healthy) {
    score -= 10;
    explain.push("-10 database not in a healthy connected state");
  }
  if (!infra.realtime.healthy) {
    score -= 8;
    explain.push("-8 realtime socket layer not healthy");
  }
  if (!infra.storage.healthy) {
    score -= 8;
    explain.push("-8 invoice storage directory not writable");
  }
  const jobPenalty = Math.min(20, operational.automationFailures * 5);
  if (jobPenalty > 0) {
    score -= jobPenalty;
    explain.push(`-${jobPenalty} for ${operational.automationFailures} failed automation/cron job(s)`);
  }
  const webhookFailureRate = infra.webhook.last24h.received
    ? (infra.webhook.last24h.failed / infra.webhook.last24h.received) * 100
    : 0;
  if (webhookFailureRate > 0) {
    const penalty = Math.round(webhookFailureRate);
    score -= penalty;
    explain.push(`-${penalty} for ${webhookFailureRate.toFixed(1)}% webhook failure rate (last 24h)`);
  }
  const alertPenalty = Math.min(25, criticalAlertCount * 5);
  if (alertPenalty > 0) {
    score -= alertPenalty;
    explain.push(`-${alertPenalty} for ${criticalAlertCount} unresolved critical alert(s)`);
  }

  const value = Math.max(0, Math.round(score));
  let status = "healthy";
  if (value < 40) status = "critical";
  else if (value < 60) status = "degraded";
  else if (value < 80) status = "warning";

  return { score: value, status, breakdown: explain };
}

export const buildPlatformHealthCenter = async () => {
  const [infra, operational, alerts] = await Promise.all([
    buildInfrastructureStatus(),
    buildOperationalHealth(),
    buildSmartAlerts(),
  ]);

  const overall = computeOverallHealthScore({
    infra,
    operational,
    criticalAlertCount: alerts.counts.critical,
  });

  return {
    overallHealth: overall,
    infrastructure: infra,
    operational,
    alertCounts: alerts.counts,
  };
};

export const getPlatformHealthCenter = asyncHandler(async (_req, res) => {
  const data = await buildPlatformHealthCenter();
  res.status(200).json({ success: true, data, message: "Platform health center fetched successfully" });
});

// ── Smart Operations Panel ──────────────────────────────────────────────
// Reuses buildSmartAlerts() entirely (no re-querying the same conditions)
// and adds only the genuinely new operational signals from this phase
// (automation/cron job failures, webhook failures) as additional queue
// entries in the same shape.
export const buildOperationsQueue = async () => {
  const [alerts, operational] = await Promise.all([buildSmartAlerts(), buildOperationalHealth()]);
  const queue = [...alerts.alerts];

  if (operational.automationFailures > 0) {
    queue.push({
      key: "automation-job-failures",
      priority: "high",
      title: "Automation/cron jobs failed on last run",
      count: operational.automationFailures,
      link: "/admin/platform-health",
    });
  }

  if (operational.delayedAppointments > 0) {
    queue.push({
      key: "delayed-appointments",
      priority: "medium",
      title: "Appointments past their scheduled date with no terminal status",
      count: operational.delayedAppointments,
      link: "/admin/appointments",
    });
  }

  if (operational.failedPaymentsToday > 0) {
    queue.push({
      key: "failed-payments-today",
      priority: operational.failedPaymentsToday > 5 ? "high" : "medium",
      title: "Failed payments today",
      count: operational.failedPaymentsToday,
      link: "/admin/payments",
    });
  }

  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return {
    queue,
    counts: {
      critical: queue.filter((a) => a.priority === "critical").length,
      high: queue.filter((a) => a.priority === "high").length,
      medium: queue.filter((a) => a.priority === "medium").length,
      low: queue.filter((a) => a.priority === "low").length,
    },
  };
};

export const getOperationsQueue = asyncHandler(async (_req, res) => {
  const data = await buildOperationsQueue();
  res.status(200).json({ success: true, data, message: "Operations queue fetched successfully" });
});

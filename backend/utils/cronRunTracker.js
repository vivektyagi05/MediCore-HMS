import os from "os";
import CronRunLog from "../models/CronRunLog.js";
import { logger } from "./logger.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";

// One shared helper, reused by every cron script and every automation
// sub-job (see cron/*.js and automation/cronJobs.js) — the run-tracking AND
// distributed-locking logic itself is written exactly once.
//
// Deliberately best-effort on the LOGGING side: if writing the log record
// itself fails (e.g. no DB connection yet), the underlying job still runs
// and its real success/failure still propagates to the caller. Monitoring
// must never be able to break the thing it monitors. The LOCK itself is
// not best-effort -- see acquireLock() below.

// A "running" row with no finishedAt older than this is almost certainly a
// process that crashed or was killed mid-run, not a job that is genuinely
// still working. It is reclaimed (marked "timed_out") so a crashed process
// can never hold the lock forever. None of these jobs legitimately run this
// long; this is a safety ceiling, not a tuning knob per job.
const STALE_LOCK_MS = 30 * 60 * 1000;
const isDuplicateKeyError = (error) => error?.code === 11000;

function summarize(result) {
  if (result == null) return null;
  if (Array.isArray(result)) return { count: result.length };
  if (typeof result === "object") return result;
  return { result };
}

/**
 * DISTRIBUTED LOCK: at most one "running" row per jobName can exist,
 * enforced by CronRunLog's partial unique index (models/CronRunLog.js) --
 * the database itself is the arbiter, not a check-then-act race in this
 * process. Returns the new log's id, or null if the job is genuinely
 * already running elsewhere (the caller should skip, not run).
 */
async function acquireLock(jobName, startedAt, triggeredBy, { staleLockMs = STALE_LOCK_MS } = {}) {
  try {
    const log = await CronRunLog.create({
      jobName,
      status: "running",
      startedAt,
      triggeredBy,
      host: os.hostname(),
      pid: process.pid,
    });
    return log._id;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    // Someone else holds the lock. Is it actually still alive, or a crashed
    // process that never released it?
    const holder = await CronRunLog.findOne({ jobName, status: "running" });
    const holderAge = holder ? Date.now() - new Date(holder.startedAt).getTime() : Infinity;
    if (!holder || holderAge <= staleLockMs) {
      return null; // genuinely running elsewhere -- caller must skip
    }

    // Reclaim: the previous holder is stale. This update is itself
    // conditioned on the row still being "running" (a third process could
    // reclaim it between our findOne and here), so at most one reclaimer
    // wins; the loser's create() below will hit E11000 again and its
    // single retry (see trackRun) simply reports "already running".
    const reclaimed = await CronRunLog.findOneAndUpdate(
      { _id: holder._id, status: "running" },
      { status: "timed_out", finishedAt: new Date(), error: `Reclaimed: exceeded ${Math.round(staleLockMs / 60000)}-minute stale-lock threshold` },
    );
    if (!reclaimed) return null; // someone else reclaimed it first; treat as still contended for this attempt

    try {
      const log = await CronRunLog.create({
        jobName,
        status: "running",
        startedAt,
        triggeredBy,
        host: os.hostname(),
        pid: process.pid,
      });
      return log._id;
    } catch (retryError) {
      if (isDuplicateKeyError(retryError)) return null; // another process won the race right after our reclaim
      throw retryError;
    }
  }
}

export async function trackRun(jobName, fn, { triggeredBy = "cron-script", staleLockMs } = {}) {
  const startedAt = new Date();
  const start = Date.now();
  let logId;

  try {
    logId = await acquireLock(jobName, startedAt, triggeredBy, { staleLockMs });
  } catch (error) {
    logger.warn("cronRunTracker: failed to acquire job lock (running unlocked)", { jobName, message: error?.message });
    logId = null;
  }

  if (logId === null) {
    // acquireLock only returns null when a lock genuinely exists (running
    // elsewhere) or the DB is unreachable AND that specific failure was a
    // duplicate-key contention already resolved above -- either way the job
    // must NOT run twice. A DB-unreachable *other* error already fell
    // through to the warn-and-run-unlocked path above with logId
    // undefined, which is intentionally different from this explicit skip.
    logger.info("cronRunTracker: skipping run, job already in progress elsewhere", { jobName, triggeredBy });
    return { skipped: true, reason: "already-running", jobName };
  }

  try {
    const result = await fn();
    if (logId) {
      await CronRunLog.findByIdAndUpdate(logId, {
        status: "success",
        finishedAt: new Date(),
        durationMs: Date.now() - start,
        summary: summarize(result),
      }).catch((error) => logger.warn("cronRunTracker: failed to write success log entry", { jobName, message: error?.message }));
    }
    return result;
  } catch (error) {
    if (logId) {
      await CronRunLog.findByIdAndUpdate(logId, {
        status: "failed",
        finishedAt: new Date(),
        durationMs: Date.now() - start,
        error: error?.message || "Unknown error",
      }).catch(() => {});
    }
    // Phase A6.2.3 — Automation Studio real trigger. This one hook covers
    // every standalone cron script AND every on-demand automation sub-job,
    // since both already go through this exact function — see the real
    // trigger definition's note in triggerRegistry.js for why "Cron
    // Failed"/"Automation Failed" are modeled as one trigger here.
    await emitAutomationTrigger(TRIGGER_TYPES.AUTOMATION_JOB_FAILED, {
      jobName,
      triggeredBy,
      error: error?.message || "Unknown error",
    });
    throw error;
  }
}

// Returns the single most recent run per distinct jobName — used by the
// Platform Health Center to show real last-run status for every job
// without the caller needing to know the full list of job names up front.
export async function getLatestRunPerJob() {
  return CronRunLog.aggregate([
    { $sort: { startedAt: -1 } },
    {
      $group: {
        _id: "$jobName",
        jobName: { $first: "$jobName" },
        status: { $first: "$status" },
        triggeredBy: { $first: "$triggeredBy" },
        startedAt: { $first: "$startedAt" },
        finishedAt: { $first: "$finishedAt" },
        durationMs: { $first: "$durationMs" },
        summary: { $first: "$summary" },
        error: { $first: "$error" },
      },
    },
    { $project: { _id: 0 } },
    { $sort: { jobName: 1 } },
  ]);
}

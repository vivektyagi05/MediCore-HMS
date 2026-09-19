import CronRunLog from "../models/CronRunLog.js";
import { logger } from "./logger.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";

// One shared helper, reused by every cron script and every automation
// sub-job (see cron/*.js and automation/cronJobs.js) — the run-tracking
// logic itself is written exactly once.
//
// Deliberately best-effort: if writing the log record itself fails (e.g. no
// DB connection yet), the underlying job still runs and its real
// success/failure still propagates to the caller. Monitoring must never be
// able to break the thing it monitors.
function summarize(result) {
  if (result == null) return null;
  if (Array.isArray(result)) return { count: result.length };
  if (typeof result === "object") return result;
  return { result };
}

export async function trackRun(jobName, fn, { triggeredBy = "cron-script" } = {}) {
  const startedAt = new Date();
  const start = Date.now();
  let logId = null;

  try {
    const log = await CronRunLog.create({ jobName, status: "running", startedAt, triggeredBy });
    logId = log._id;
  } catch (error) {
    logger.warn("cronRunTracker: failed to write starting log entry", { jobName, message: error?.message });
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

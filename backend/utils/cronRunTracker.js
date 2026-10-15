import os from "os";
import { randomUUID } from "crypto";
import CronRunLog from "../models/CronRunLog.js";
import { logger } from "./logger.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";

// One shared helper, reused by every cron script and every automation
// sub-job (see cron/*.js and automation/cronJobs.js) -- the run-tracking AND
// distributed-locking logic itself is written exactly once.
//
// N-002 lock model (lease + fencing):
//   * The lock is a CronRunLog row with status:"running". The partial unique
//     index {jobName} where status:"running" makes MongoDB the arbiter. That
//     index is VERIFIED (verifyLockIndex) -- if it is missing the lock would
//     arbitrate nothing, so trackRun refuses to run (fail-closed).
//   * Every row carries ownerToken + leaseExpiresAt. The holder heartbeats the
//     lease while the job runs. A holder whose lease has expired is dead and
//     may be reclaimed (marked timed_out).
//   * heartbeat / complete / release are all conditioned on
//     {_id, ownerToken, status:"running"} (fencing). A stale worker that
//     finishes after being reclaimed cannot overwrite the newer owner or the
//     timed_out row; its completion is rejected and logged.
//   * Lock infrastructure errors are FAIL-CLOSED: the job is skipped and an
//     error is logged. It never runs unlocked.
//   * drainInFlightRuns() lets shutdown wait (bounded) for running jobs and
//     marks any unfinished run timed_out -- never success.

export const DEFAULT_LEASE_MS = 2 * 60 * 1000;
// Legacy rows written before leases existed have no leaseExpiresAt; they fall
// back to startedAt + this ceiling.
const LEGACY_STALE_LOCK_MS = 30 * 60 * 1000;
const isDuplicateKeyError = (error) => error?.code === 11000;

function summarize(result) {
  if (result == null) return null;
  if (Array.isArray(result)) return { count: result.length };
  if (typeof result === "object") return result;
  return { result };
}

// ── lock index verification ─────────────────────────────────────────────

export const isLockIndex = (index) =>
  Boolean(index)
  && index.unique === true
  && Object.keys(index.key || {}).length === 1
  && index.key.jobName === 1
  && index.partialFilterExpression?.status === "running";

let lockIndexVerified = false;
let lockIndexCheck = async () => {
  const indexes = await CronRunLog.collection.indexes();
  return indexes.some(isLockIndex);
};

/** Returns true when the unique partial lock index exists. Caches success only. */
export async function verifyLockIndex({ force = false } = {}) {
  if (lockIndexVerified && !force) return true;
  let present;
  try {
    present = await lockIndexCheck();
  } catch (error) {
    logger.error("cronRunTracker: could not read CronRunLog indexes", { message: error?.message });
    return false;
  }
  lockIndexVerified = present;
  return present;
}

/** Test seam: replace the index lookup (the unit suite has no live MongoDB). */
export function setLockIndexCheckForTesting(fn) {
  lockIndexCheck = fn || (async () => (await CronRunLog.collection.indexes()).some(isLockIndex));
  lockIndexVerified = false;
}

// ── in-flight tracking (graceful shutdown) ──────────────────────────────

const inFlight = new Map(); // logId(string) -> { jobName, ownerToken, promise }

export function getInFlightRuns() {
  return [...inFlight.entries()].map(([id, run]) => ({ id, jobName: run.jobName }));
}

/**
 * Wait up to timeoutMs for running jobs. Any run still unfinished is fenced to
 * timed_out ("interrupted by shutdown") so it is never reported as success and
 * the lock is released for the next owner.
 */
export async function drainInFlightRuns({ timeoutMs = 10_000 } = {}) {
  const runs = [...inFlight.entries()];
  if (runs.length === 0) return { drained: 0, abandoned: [] };
  let timer;
  const timedOut = Symbol("timeout");
  const outcome = await Promise.race([
    Promise.allSettled(runs.map(([, run]) => run.promise)).then(() => "done"),
    new Promise((resolve) => { timer = setTimeout(() => resolve(timedOut), timeoutMs); }),
  ]);
  clearTimeout(timer);
  if (outcome !== timedOut) return { drained: runs.length, abandoned: [] };

  const abandoned = [];
  for (const [id, run] of runs) {
    if (!inFlight.has(id)) continue; // finished while we waited
    run.abandoned = true;
    abandoned.push(run.jobName);
    await CronRunLog.findOneAndUpdate(
      { _id: run.logId, ownerToken: run.ownerToken, status: "running" },
      { status: "timed_out", finishedAt: new Date(), error: "Interrupted by shutdown before completion" },
    ).catch((error) => logger.warn("cronRunTracker: could not release lock at shutdown", { jobName: run.jobName, message: error?.message }));
  }
  logger.warn("cronRunTracker: shutdown abandoned unfinished jobs", { abandoned });
  return { drained: runs.length - abandoned.length, abandoned };
}

// ── lock acquisition ────────────────────────────────────────────────────

const newRunDoc = (jobName, startedAt, triggeredBy, ownerToken, leaseMs) => ({
  jobName,
  status: "running",
  startedAt,
  triggeredBy,
  host: os.hostname(),
  pid: process.pid,
  ownerToken,
  heartbeatAt: startedAt,
  leaseExpiresAt: new Date(startedAt.getTime() + leaseMs),
});

const holderIsDead = (holder, now, staleLockMs) => {
  if (!holder) return true;
  if (holder.leaseExpiresAt) return new Date(holder.leaseExpiresAt).getTime() <= now;
  return now - new Date(holder.startedAt).getTime() > staleLockMs; // legacy row, no lease
};

/**
 * Returns { logId } on success, null when the job is genuinely running
 * elsewhere. Throws on any other error (caller treats that as fail-closed).
 */
async function acquireLock(jobName, startedAt, triggeredBy, ownerToken, { leaseMs, staleLockMs }) {
  const doc = () => newRunDoc(jobName, startedAt, triggeredBy, ownerToken, leaseMs);
  try {
    const log = await CronRunLog.create(doc());
    return { logId: log._id };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const holder = await CronRunLog.findOne({ jobName, status: "running" });
  if (!holder) {
    // The holder released between our create and findOne: one retry.
    try {
      const log = await CronRunLog.create(doc());
      return { logId: log._id };
    } catch (retry) {
      if (isDuplicateKeyError(retry)) return null;
      throw retry;
    }
  }
  if (!holderIsDead(holder, Date.now(), staleLockMs)) return null; // live lease elsewhere

  // Reclaim, fenced on the exact holder we inspected so at most one reclaimer wins.
  const fence = { _id: holder._id, status: "running" };
  if (holder.ownerToken) fence.ownerToken = holder.ownerToken;
  const reclaimed = await CronRunLog.findOneAndUpdate(fence, {
    status: "timed_out",
    finishedAt: new Date(),
    error: "Reclaimed: lease expired without heartbeat (holder presumed dead)",
  });
  if (!reclaimed) return null;

  try {
    const log = await CronRunLog.create(doc());
    return { logId: log._id };
  } catch (retryError) {
    if (isDuplicateKeyError(retryError)) return null;
    throw retryError;
  }
}

// ── trackRun ────────────────────────────────────────────────────────────

export async function trackRun(jobName, fn, {
  triggeredBy = "cron-script",
  staleLockMs = LEGACY_STALE_LOCK_MS,
  leaseMs = DEFAULT_LEASE_MS,
  heartbeatMs = Math.max(10, Math.floor(leaseMs / 3)),
} = {}) {
  const startedAt = new Date();
  const start = Date.now();
  const ownerToken = randomUUID();

  // FAIL-CLOSED lock infrastructure: no verified lock index, no lock, no run.
  if (!(await verifyLockIndex())) {
    logger.error("cronRunTracker: CronRunLog unique lock index is missing; refusing to run job (run migration 011)", { jobName });
    return { skipped: true, reason: "lock-index-missing", jobName };
  }

  let acquired;
  try {
    acquired = await acquireLock(jobName, startedAt, triggeredBy, ownerToken, { leaseMs, staleLockMs });
  } catch (error) {
    logger.error("cronRunTracker: failed to acquire job lock; skipping run (never runs unlocked)", { jobName, message: error?.message });
    return { skipped: true, reason: "lock-unavailable", jobName };
  }

  if (!acquired) {
    logger.info("cronRunTracker: skipping run, job already in progress elsewhere", { jobName, triggeredBy });
    return { skipped: true, reason: "already-running", jobName };
  }

  const { logId } = acquired;
  const fence = { _id: logId, ownerToken, status: "running" };
  const run = { jobName, ownerToken, logId, abandoned: false, leaseLost: false };
  const idKey = String(logId);

  // Heartbeat: extend the lease; if the fenced update matches nothing, the
  // lease was lost to a reclaimer.
  const heartbeat = setInterval(async () => {
    try {
      const now = new Date();
      const updated = await CronRunLog.findOneAndUpdate(fence, {
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
      });
      if (!updated && !run.leaseLost) {
        run.leaseLost = true;
        logger.error("cronRunTracker: lease lost (row reclaimed or released); job result will be fenced", { jobName });
      }
    } catch (error) {
      logger.warn("cronRunTracker: heartbeat write failed", { jobName, message: error?.message });
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  const execution = (async () => {
    try {
      const result = await fn({ isLeaseValid: () => !run.leaseLost && !run.abandoned });
      if (run.abandoned) return result; // shutdown already marked the row timed_out
      const done = await CronRunLog.findOneAndUpdate(fence, {
        status: "success",
        finishedAt: new Date(),
        durationMs: Date.now() - start,
        summary: summarize(result),
      }).catch((error) => {
        logger.warn("cronRunTracker: failed to write success log entry", { jobName, message: error?.message });
        return undefined;
      });
      if (done === null) {
        logger.error("cronRunTracker: completion fenced out -- lease was reclaimed by another owner; result NOT recorded", { jobName });
      }
      return result;
    } catch (error) {
      if (!run.abandoned) {
        await CronRunLog.findOneAndUpdate(fence, {
          status: "failed",
          finishedAt: new Date(),
          durationMs: Date.now() - start,
          error: error?.message || "Unknown error",
        }).catch(() => {});
      }
      // Phase A6.2.3 -- Automation Studio real trigger (every cron script and
      // on-demand sub-job already goes through this function).
      await emitAutomationTrigger(TRIGGER_TYPES.AUTOMATION_JOB_FAILED, {
        jobName,
        triggeredBy,
        error: error?.message || "Unknown error",
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      inFlight.delete(idKey);
    }
  })();

  run.promise = execution.catch(() => {});
  inFlight.set(idKey, run);
  return execution;
}

// Returns the single most recent run per distinct jobName -- used by the
// Platform Health Center to show real last-run status for every job.
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
        host: { $first: "$host" },
        heartbeatAt: { $first: "$heartbeatAt" },
        leaseExpiresAt: { $first: "$leaseExpiresAt" },
      },
    },
    { $project: { _id: 0 } },
    { $sort: { jobName: 1 } },
  ]);
}

// F-015 / N-002: in-process scheduler for the financial jobs.
//
// Topology (see config/productionGuards.js SERVICE_ROLE):
//   web    -> never starts this scheduler
//   worker -> backend/worker.js owns it (exactly one service)
//   all    -> single-instance deployments / development
// Cross-process safety does NOT depend on that choice. Every job runs under
// trackRun(), whose CronRunLog lease (ownerToken + leaseExpiresAt + heartbeat,
// backed by a VERIFIED unique partial index) guarantees one live owner per
// job, fences stale workers, and fails closed when the lock cannot be taken.
//
// Startup verifies the lock index and refuses to start without it, so a
// production DB that never ran migration 011 produces a loud error instead of
// an unlocked scheduler. stopFinancialScheduler() clears the boot timeout and
// interval timers, refuses new ticks, and waits (bounded) for in-flight jobs;
// anything still unfinished is recorded timed_out, never success.
import { runExpirePaymentWindows } from "./expirePaymentWindows.js";
import { runRetryFailedPayments } from "./retryFailedPayments.js";
import { runRecoverPaymentEvents } from "./recoverPaymentEvents.js";
import { runReconciliationCron } from "./reconciliationCron.js";
import { runSubscriptionRenewals } from "./subscriptionRenewals.js";
import { runProcessEmailOutbox } from "./processEmailOutbox.js";
import { runAppointmentLifecycleSweep } from "./appointmentLifecycleSweep.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { drainInFlightRuns, verifyLockIndex } from "../utils/cronRunTracker.js";

const MINUTE = 60 * 1000;
export const FINANCIAL_JOBS = Object.freeze([
  { name: "processEmailOutbox", everyMs: 1 * MINUTE, run: runProcessEmailOutbox },
  { name: "expirePaymentWindows", everyMs: 1 * MINUTE, run: runExpirePaymentWindows },
  { name: "recoverPaymentEvents", everyMs: 1 * MINUTE, run: runRecoverPaymentEvents },
  { name: "retryFailedPayments", everyMs: 5 * MINUTE, run: runRetryFailedPayments },
  { name: "appointmentLifecycleSweep", everyMs: 5 * MINUTE, run: runAppointmentLifecycleSweep },
  { name: "reconciliation", everyMs: 15 * MINUTE, run: runReconciliationCron },
  { name: "subscriptionRenewals", everyMs: 60 * MINUTE, run: runSubscriptionRenewals },
]);

const state = new Map(); // name -> { lastStartedAt, lastFinishedAt, lastOk, lastError, running }
let timers = [];
let bootTimer = null;
let stopping = false;
const activeTicks = new Set();

export const getSchedulerStatus = () => ({
  enabled: timers.length > 0,
  stopping,
  jobs: FINANCIAL_JOBS.map((job) => ({ name: job.name, everyMs: job.everyMs, ...(state.get(job.name) || {}) })),
});

const tick = async (job) => {
  if (stopping) return; // shutdown in progress: no new work
  const current = state.get(job.name) || {};
  if (current.running) return; // never overlap within one process
  state.set(job.name, { ...current, running: true, lastStartedAt: new Date() });
  const startedAt = state.get(job.name).lastStartedAt;
  try {
    const result = await job.run();
    // trackRun reports a lock skip as a resolved value; surface it honestly
    // instead of recording a fake success.
    if (result?.skipped) {
      state.set(job.name, { running: false, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastOk: result.reason === "already-running", lastSkipped: result.reason });
      return;
    }
    state.set(job.name, { running: false, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastOk: true });
  } catch (error) {
    logger.error("Scheduled financial job failed", { job: job.name, message: error?.message });
    state.set(job.name, { running: false, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastOk: false, lastError: String(error?.message || error).slice(0, 200) });
  }
};

const launchTick = (job) => {
  const promise = tick(job).finally(() => activeTicks.delete(promise));
  activeTicks.add(promise);
};

/**
 * Starts the scheduler. Returns false when disabled by role/config, and
 * REJECTS (throws) when enabled but the lock index is missing -- an enabled
 * scheduler that cannot lock must be loud, not silent.
 */
export const startFinancialScheduler = async ({ enabled = env.schedulerEnabled, verifyIndex = verifyLockIndex } = {}) => {
  if (!enabled) {
    logger.info("In-process financial scheduler not started for this process", { serviceRole: env.serviceRole });
    return false;
  }
  if (timers.length > 0) return true; // duplicate registration is a no-op
  if (!(await verifyIndex({ force: true }))) {
    const error = new Error("Financial scheduler NOT started: CronRunLog unique lock index (jobName, status=running) is missing. Run `npm run migrate:indexes` before starting the worker.");
    logger.error(error.message);
    throw error;
  }
  if (timers.length > 0) return true; // a concurrent start won while we verified
  stopping = false;
  timers = FINANCIAL_JOBS.map((job) => {
    const timer = setInterval(() => launchTick(job), job.everyMs);
    timer.unref?.();
    return timer;
  });
  // First pass shortly after boot so a restart recovers backlog without waiting a full interval.
  bootTimer = setTimeout(() => { bootTimer = null; FINANCIAL_JOBS.forEach(launchTick); }, 15 * 1000);
  bootTimer.unref?.();
  logger.info("In-process financial scheduler started", { jobs: FINANCIAL_JOBS.map((j) => j.name), serviceRole: env.serviceRole });
  return true;
};

/**
 * Graceful stop. Timers are cleared synchronously; the returned promise
 * resolves once in-flight jobs finished or were fenced as timed_out.
 */
export const stopFinancialScheduler = ({ timeoutMs = 10_000 } = {}) => {
  stopping = true;
  timers.forEach(clearInterval);
  timers = [];
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  return (async () => {
    let waiter;
    await Promise.race([
      Promise.allSettled([...activeTicks]),
      new Promise((resolve) => { waiter = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(waiter);
    const drained = await drainInFlightRuns({ timeoutMs: 0 });
    stopping = false;
    return drained;
  })();
};

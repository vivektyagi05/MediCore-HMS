import mongoose from "mongoose";

// Phase A5.2 — Platform Health Center.
//
// AUDIT FINDING: none of the 4 standalone cron scripts (reconciliationCron,
// expirePaymentWindows, subscriptionRenewals, retryFailedPayments) nor the
// on-demand AI automation runner (automation/cronJobs.js) persisted any
// record of when they last ran, whether they succeeded, or what they did.
// They only wrote to console via `logger`, which is not queryable by the
// application. There is also no in-process scheduler anywhere in this
// codebase (no node-cron/Agenda/Bull) — these scripts are invoked
// externally (OS crontab / container scheduler), so the API had zero real
// visibility into automation health. This model is the fix: every run of
// every job now writes a real, queryable record here (see
// backend/utils/cronRunTracker.js), and the Platform Health Center reads
// straight from it — nothing about "last run" or "success/failure" is
// fabricated.
const cronRunLogSchema = new mongoose.Schema(
  {
    jobName: { type: String, required: true, index: true },
    // "timed_out": a "running" row that trackRun() itself detected as stale
    // (older than STALE_LOCK_MS with no finishedAt -- almost always a
    // process that crashed or was killed mid-run) and reclaimed so the lock
    // below doesn't block that job forever.
    status: { type: String, enum: ["running", "success", "failed", "timed_out"], default: "running", index: true },
    triggeredBy: { type: String, enum: ["cron-script", "on-demand-api"], default: "cron-script" },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
    durationMs: Number,
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
    error: String,
    // Which process holds the lock -- purely informative (ops
    // investigation of a stuck job), never used to decide locking itself.
    host: String,
    pid: Number,
  },
  { timestamps: true },
);

cronRunLogSchema.index({ jobName: 1, startedAt: -1 });
// DISTRIBUTED LOCK (Phase 14): at most one "running" row per jobName can
// exist at a time, enforced by MongoDB itself via a partial unique index --
// this is what actually prevents two backend instances (or a manual
// on-demand rerun overlapping a scheduled run) from executing the SAME job
// concurrently. trackRun() below relies on the resulting E11000 duplicate-key
// error to detect "already running" atomically; it is not a check-then-act
// race because the uniqueness is enforced by the database, not application
// code.
cronRunLogSchema.index(
  { jobName: 1 },
  { unique: true, partialFilterExpression: { status: "running" } },
);
// Phase A6.2.4 — Enterprise Monitoring Platform. Cron Health ranking reads
// across ALL jobs by recency, not one job at a time.
cronRunLogSchema.index({ status: 1, startedAt: -1 });

const CronRunLog = mongoose.model("CronRunLog", cronRunLogSchema);

export default CronRunLog;

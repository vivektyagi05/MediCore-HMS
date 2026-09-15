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
    status: { type: String, enum: ["running", "success", "failed"], default: "running", index: true },
    triggeredBy: { type: String, enum: ["cron-script", "on-demand-api"], default: "cron-script" },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
    durationMs: Number,
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
    error: String,
  },
  { timestamps: true },
);

cronRunLogSchema.index({ jobName: 1, startedAt: -1 });
// Phase A6.2.4 — Enterprise Monitoring Platform. Cron Health ranking reads
// across ALL jobs by recency, not one job at a time.
cronRunLogSchema.index({ status: 1, startedAt: -1 });

const CronRunLog = mongoose.model("CronRunLog", cronRunLogSchema);

export default CronRunLog;

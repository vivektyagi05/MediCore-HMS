import { appointmentReminder } from "./appointmentReminder.js";
import { paymentReminder } from "./paymentReminder.js";
import { followUpReminder } from "./followUpReminder.js";
import { insuranceExpiryReminder } from "./insuranceExpiryReminder.js";
import { prescriptionRenewalReminder } from "./prescriptionRenewalReminder.js";
import { missedFollowUpReminder } from "./missedFollowUpReminder.js";
import { aiInsights } from "../ai/aiInsights.js";
import { runSweep as runAssignmentSweep } from "../workflow/assignment/assignmentScheduler.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

// AUDIT FINDING (Phase A5.2): runAll() previously used Promise.all across
// all 7 sub-jobs. Promise.all rejects as soon as any ONE promise rejects,
// so a single failing job (e.g. a bad document reference inside
// prescriptionRenewalReminder) would make the whole POST
// /api/ai/automation/run request return a 500 with no indication of which
// job failed or whether the others succeeded — and nothing was persisted
// anywhere. Each job below now runs independently (one failing does not
// stop the rest) and every job's own success/failure is written to
// CronRunLog via the same trackRun() helper the standalone cron scripts
// use, so the Platform Health Center can show real per-job status.
const JOBS = [
  { key: "appointmentReminders", jobName: "automation:appointmentReminder", run: () => appointmentReminder.run() },
  { key: "paymentReminders", jobName: "automation:paymentReminder", run: () => paymentReminder.run() },
  { key: "followUpReminders", jobName: "automation:followUpReminder", run: () => followUpReminder.run() },
  { key: "insuranceExpiryReminders", jobName: "automation:insuranceExpiryReminder", run: () => insuranceExpiryReminder.run() },
  { key: "prescriptionRenewalReminders", jobName: "automation:prescriptionRenewalReminder", run: () => prescriptionRenewalReminder.run() },
  { key: "missedFollowUpReminders", jobName: "automation:missedFollowUpReminder", run: () => missedFollowUpReminder.run() },
  { key: "insights", jobName: "automation:aiInsights", run: () => aiInsights.generateAdminInsights() },
  // Phase A6.2.2 — Smart Assignment Engine sweep. Registered as one more
  // job in this exact list rather than a new scheduling mechanism (see
  // assignmentScheduler.js's audit note on why this is the honest
  // equivalent of "on arrival" in a codebase with no operation-created
  // event hook).
  { key: "smartAssignmentSweep", jobName: "automation:smartAssignmentSweep", run: () => runAssignmentSweep() },
];

export const automationCronJobs = {
  async runAll() {
    const outcomes = await Promise.all(
      JOBS.map(async (job) => {
        try {
          const result = await trackRun(job.jobName, job.run, { triggeredBy: "on-demand-api" });
          // Phase A6.2.2: the new sweep job returns a summary object
          // (assigned/escalated/skipped), not an array like the reminder
          // jobs — counted explicitly here rather than forcing it into the
          // array-shaped return every other job uses for no real reason.
          const count = Array.isArray(result)
            ? result.length
            : (result?.autoAssignedCount || 0) + (result?.autoEscalatedCount || 0);
          return { key: job.key, ok: true, count };
        } catch (error) {
          logger.error("Automation sub-job failed", { jobName: job.jobName, message: error?.message });
          return { key: job.key, ok: false, count: 0, error: error?.message || "Unknown error" };
        }
      }),
    );

    const summary = {};
    const failures = [];
    for (const outcome of outcomes) {
      summary[outcome.key] = outcome.count;
      if (!outcome.ok) failures.push({ job: outcome.key, error: outcome.error });
    }
    if (failures.length) summary.failures = failures;

    logger.info("AI automation cron completed", summary);
    return summary;
  },
};

// SCHEDULER FIX (Phase 14): before this, automationCronJobs.runAll() had NO
// standalone entrypoint at all -- unlike cron/expirePaymentWindows.js,
// cron/reconciliationCron.js, cron/retryFailedPayments.js and
// cron/subscriptionRenewals.js (each runnable as `node cron/<name>.js`),
// this file could ONLY be invoked through the admin on-demand API. That
// meant every reminder it drives (appointment/payment/follow-up/insurance-
// expiry/prescription-renewal/missed-follow-up), AI insights, and the smart
// assignment sweep never ran unless an admin manually clicked a button --
// there was no automatic path at all. See docs/SCHEDULER-ARCHITECTURE.md
// for how this is wired into production.
import { connectDB } from "../config/db.js";

if (process.argv[1]?.endsWith("cronJobs.js")) {
  connectDB()
    .then(() => automationCronJobs.runAll())
    .then((summary) => {
      logger.info("automation/cronJobs.js standalone run completed", summary);
      process.exit(0);
    })
    .catch((error) => {
      logger.error("automation/cronJobs.js standalone run failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

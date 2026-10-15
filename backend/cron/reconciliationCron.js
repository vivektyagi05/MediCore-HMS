import { connectDB } from "../config/db.js";
import { reconciliationService } from "../payments/reconciliationService.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";
import RefundRequest from "../models/RefundRequest.js";
import { reconcileRefundRequest } from "../controllers/refundController.js";

// Resolves refunds left pending/unconfirmed at the provider. Bounded, idempotent
// (settle is keyed per refund), per-item isolated. Only refunds idle for a
// couple of minutes are touched so it never races the request that created them.
export const reconcilePendingRefunds = async ({ now = new Date(), batchSize = 25, minIdleMs = 2 * 60 * 1000 } = {}) => {
  const stale = await RefundRequest.find({
    refundState: { $in: ["gateway_processing", "reconciliation_required"] },
    lastAttemptAt: { $lt: new Date(now.getTime() - minIdleMs) },
  }).sort({ lastAttemptAt: 1 }).limit(batchSize).select("_id").lean();
  const results = { checked: stale.length, settled: 0, stillPending: 0, errors: 0 };
  for (const { _id } of stale) {
    try {
      const outcome = await reconcileRefundRequest(_id);
      if (outcome.settled) results.settled += 1; else results.stillPending += 1;
    } catch (error) {
      results.errors += 1;
      logger.warn("Refund reconciliation attempt failed", { refundRequestId: String(_id), message: error?.message });
    }
  }
  return results;
};

export const runReconciliationCron = async () => {
  await connectDB();
  return trackRun("reconciliation", () => runReconciliationCronBody());
};

const runReconciliationCronBody = async () => {
  const report = await reconciliationService.generateReport();
  logger.info("Reconciliation cron completed", {
    checked: report.checked,
    issueCount: report.issues.length,
  });

  const repairResults = await reconciliationService.repairIncompletePayments();
  const repaired = repairResults.filter((r) => r.repaired).length;
  const stillBroken = repairResults.filter((r) => !r.repaired);
  if (repairResults.length > 0) {
    logger.info("Reconciliation cron repaired incomplete payments", {
      attempted: repairResults.length,
      repaired,
      stillBroken: stillBroken.length,
    });
  }
  if (stillBroken.length > 0) {
    logger.error("Reconciliation cron could not repair some payments — needs manual review", {
      paymentIds: stillBroken.map((r) => r.paymentId.toString()),
    });
  }

  const refunds = await reconcilePendingRefunds();
  if (refunds.checked > 0) logger.info("Refund reconciliation pass", refunds);

  return { checked: report.checked, issues: report.issues.length, repaired, stillBroken: stillBroken.length, refunds };
};

if (process.argv[1]?.endsWith("reconciliationCron.js")) {
  runReconciliationCron()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Reconciliation cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

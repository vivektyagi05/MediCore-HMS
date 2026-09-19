import { connectDB } from "../config/db.js";
import { reconciliationService } from "../payments/reconciliationService.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

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

  return { checked: report.checked, issues: report.issues.length, repaired, stillBroken: stillBroken.length };
};

if (process.argv[1]?.endsWith("reconciliationCron.js")) {
  runReconciliationCron()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Reconciliation cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

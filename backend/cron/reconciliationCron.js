import { connectDB } from "../config/db.js";
import { reconciliationService } from "../payments/reconciliationService.js";
import { logger } from "../utils/logger.js";

export const runReconciliationCron = async () => {
  await connectDB();
  const report = await reconciliationService.generateReport();
  logger.info("Reconciliation cron completed", {
    checked: report.checked,
    issueCount: report.issues.length,
  });
  return report;
};

if (process.argv[1]?.endsWith("reconciliationCron.js")) {
  runReconciliationCron()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Reconciliation cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

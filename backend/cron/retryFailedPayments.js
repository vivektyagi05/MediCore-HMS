import { connectDB } from "../config/db.js";
import { paymentRetryService } from "../payments/paymentRetryService.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

export const runRetryFailedPayments = async () => {
  await connectDB();
  return trackRun("retryFailedPayments", async () => {
    const results = await paymentRetryService.retryDuePayments();
    logger.info("Failed payment retry cron completed", { processed: results.filter(Boolean).length });
    return { processed: results.filter(Boolean).length, attempted: results.length };
  });
};

if (process.argv[1]?.endsWith("retryFailedPayments.js")) {
  runRetryFailedPayments()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Failed payment retry cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

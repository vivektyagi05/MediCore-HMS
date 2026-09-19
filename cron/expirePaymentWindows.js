import { connectDB } from "../config/db.js";
import { expireStalePaymentWindows } from "../services/appointmentExpiryService.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

export const runExpirePaymentWindows = async () => {
  await connectDB();
  return trackRun("expirePaymentWindows", async () => {
    const expired = await expireStalePaymentWindows();
    logger.info("Payment window expiry cron completed", { expiredCount: expired.length });
    return { expiredCount: expired.length };
  });
};

if (process.argv[1]?.endsWith("expirePaymentWindows.js")) {
  runExpirePaymentWindows()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Payment window expiry cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

import { connectDB } from "../config/db.js";
import { processEmailOutbox } from "../services/emailOutboxService.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

export const runProcessEmailOutbox = async () => {
  await connectDB();
  return trackRun("processEmailOutbox", async () => {
    const stats = await processEmailOutbox();
    logger.info("Email outbox processed", stats);
    return stats;
  });
};

if (process.argv[1]?.endsWith("processEmailOutbox.js")) {
  runProcessEmailOutbox().then(() => process.exit(0)).catch((error) => {
    logger.error("Email outbox cron failed", { message: error.message });
    process.exit(1);
  });
}

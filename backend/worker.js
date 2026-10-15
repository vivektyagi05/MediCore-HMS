// N-002: dedicated background worker. Owns the financial scheduler; serves no
// HTTP. Deploy exactly one of these (SERVICE_ROLE=worker) alongside any number
// of SERVICE_ROLE=web replicas. Even if two workers ever ran, the CronRunLog
// lease makes every job single-owner -- this process split is about clarity
// and about not running jobs on every web replica, not about correctness.
process.env.SERVICE_ROLE ||= "worker";

const { env } = await import("./config/env.js");
const { connectDB, disconnectDB } = await import("./config/db.js");
const { logger } = await import("./utils/logger.js");
const { startFinancialScheduler, stopFinancialScheduler } = await import("./cron/financialScheduler.js");
const { registerProcessSafety } = await import("./utils/processResilience.js");

if (env.serviceRole === "web") {
  console.error("worker.js refuses to run with SERVICE_ROLE=web");
  process.exit(1);
}

registerProcessSafety({
  getServer: () => undefined,
  getIO: () => undefined,
  disconnectDB,
  beforeShutdown: () => stopFinancialScheduler(),
});

try {
  await connectDB();
  const started = await startFinancialScheduler({ enabled: true });
  logger.info("HMS worker running", { serviceRole: env.serviceRole, schedulerStarted: started });
} catch (error) {
  logger.error("HMS worker failed to start", { message: error?.message });
  process.exit(1);
}

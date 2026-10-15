import http from "http";
import { env } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import app from "./app.js";
import { initSocketServer, getIO } from "./socket/socketServer.js";
import { presenceManager } from "./socket/presenceManager.js";
import { logger } from "./utils/logger.js";
import { startFinancialScheduler, stopFinancialScheduler } from "./cron/financialScheduler.js";
import { registerProcessSafety } from "./utils/processResilience.js";

let server;

// Registered before startServer() runs so that even a failure during
// startup (e.g. connectDB() rejecting) is caught by the same bounded
// shutdown path instead of an ad-hoc handler.
registerProcessSafety({
  getServer: () => server,
  getIO,
  disconnectDB,
  // N-002: stop ticking and let in-flight jobs finish (or be fenced as
  // timed_out) before sockets and the DB connection close.
  beforeShutdown: () => stopFinancialScheduler(),
});

const startServer = async () => {
  await connectDB();

  // Clears out any OnlineSession documents orphaned in "online" status by
  // a previous process (see presenceQuery.js) before anything reads
  // presence counts or a new socket can connect.
  const reconciledCount = await presenceManager.reconcileOnBoot();
  if (reconciledCount > 0) {
    logger.info("Reconciled stale online-presence sessions on boot", { reconciledCount });
  }

  server = http.createServer(app);
  initSocketServer(server);

  server.listen(env.port, () => {
    logger.info("HMS backend server started", {
      port: env.port,
      environment: env.nodeEnv,
    });
    // N-002: role web never starts it; worker/all do. A missing lock index
    // makes this throw -> logged, process keeps serving HTTP but the
    // operator sees a hard error rather than a silently unlocked scheduler.
    startFinancialScheduler().catch((error) => {
      logger.error("Financial scheduler failed to start", { message: error?.message });
      if (env.isProduction && env.serviceRole !== "web") process.exitCode = 1;
    });
  });
};

startServer().catch((error) => {
  logger.error("Failed to start server", { message: error?.message, stack: error?.stack });
  process.exit(1);
});

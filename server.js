import http from "http";
import { env } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import app from "./app.js";
import { initSocketServer, getIO } from "./socket/socketServer.js";
import { presenceManager } from "./socket/presenceManager.js";
import { logger } from "./utils/logger.js";
import { registerProcessSafety } from "./utils/processResilience.js";

let server;

// Registered before startServer() runs so that even a failure during
// startup (e.g. connectDB() rejecting) is caught by the same bounded
// shutdown path instead of an ad-hoc handler.
registerProcessSafety({
  getServer: () => server,
  getIO,
  disconnectDB,
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
  });
};

startServer().catch((error) => {
  logger.error("Failed to start server", { message: error?.message, stack: error?.stack });
  process.exit(1);
});

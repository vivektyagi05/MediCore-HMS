import http from "http";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import app from "./app.js";
import { initSocketServer } from "./socket/socketServer.js";
import { logger } from "./utils/logger.js";

let server;

const startServer = async () => {
  await connectDB();

  server = http.createServer(app);
  initSocketServer(server);

  server.listen(env.port, () => {
    logger.info("HMS backend server started", {
      port: env.port,
      environment: env.nodeEnv,
    });
  });
};

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: reason?.message || reason });
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on("SIGTERM", () => {
  logger.warn("SIGTERM received. Shutting down gracefully");
  if (server) server.close(() => process.exit(0));
});

startServer();

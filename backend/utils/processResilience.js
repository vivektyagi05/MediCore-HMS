import { logger } from "./logger.js";

const DEFAULT_FORCE_EXIT_MS = Number(process.env.SHUTDOWN_FORCE_EXIT_MS || 10_000);

// BUGFIX (backend stability - see socket/asyncSocketHandler.js for the other
// half of this fix):
//
// The previous unhandledRejection handler in server.js did:
//   server.close(() => process.exit(1))
// on ANY unhandled rejection anywhere in the process. server.close() does
// not force-close existing connections -- it waits for them to end
// naturally. Long-lived Socket.IO/WebSocket connections don't naturally
// end, so if the rejection came from (or coincided with) an open realtime
// connection, that callback -- and the process.exit(1) inside it -- could
// simply never run. The process would stay alive but stop accepting new
// HTTP connections, which looks exactly like "the backend stops
// responding" and explains why only a manual kill+restart recovered it.
//
// Most of the actual sources of stray rejections in this app (every
// socket.io event handler) are now caught at the source and can no longer
// reach here at all. What's registered below is the last line of defense
// for genuinely unexpected errors (uncaughtException, or an unhandled
// rejection from somewhere not yet wrapped) -- and it is now bounded: if
// a graceful close doesn't finish within forceExitMs, we force-exit
// instead of waiting forever.
export const registerProcessSafety = ({
  getServer,
  getIO,
  disconnectDB,
  forceExitMs = DEFAULT_FORCE_EXIT_MS,
  exit = (code) => process.exit(code),
} = {}) => {
  let shuttingDown = false;

  const shutdown = (reason, meta = {}) => {
    if (shuttingDown) {
      logger.error("Additional fatal error while already shutting down", { reason, ...meta });
      return;
    }
    shuttingDown = true;
    logger.error(`Fatal error detected (${reason}) - starting bounded shutdown`, meta);

    const forceTimer = setTimeout(() => {
      logger.error("Graceful shutdown did not complete in time - forcing process exit", { forceExitMs });
      exit(1);
    }, forceExitMs);
    forceTimer.unref?.();

    const finish = () => {
      clearTimeout(forceTimer);
      Promise.resolve()
        .then(() => disconnectDB?.())
        .catch((error) => logger.error("Error closing DB connection during shutdown", { message: error?.message }))
        .finally(() => exit(1));
    };

    try {
      getIO?.()?.close();
    } catch (error) {
      logger.error("Error closing Socket.IO server during shutdown", { message: error?.message });
    }

    const server = getServer?.();
    if (server) {
      server.close(finish);
    } else {
      finish();
    }
  };

  process.on("uncaughtException", (error) => {
    shutdown("uncaughtException", { message: error?.message, stack: error?.stack });
  });

  process.on("unhandledRejection", (reason) => {
    shutdown("unhandledRejection", {
      message: reason?.message || String(reason),
      stack: reason?.stack,
    });
  });

  const gracefulSignalShutdown = (signal) => {
    logger.warn(`${signal} received - shutting down gracefully`);
    if (shuttingDown) return;
    shuttingDown = true;

    const forceTimer = setTimeout(() => {
      logger.warn("Graceful signal shutdown did not complete in time - forcing process exit");
      exit(0);
    }, forceExitMs);
    forceTimer.unref?.();

    const finish = () => {
      clearTimeout(forceTimer);
      Promise.resolve()
        .then(() => disconnectDB?.())
        .catch((error) => logger.error("Error closing DB connection during shutdown", { message: error?.message }))
        .finally(() => exit(0));
    };

    try {
      getIO?.()?.close();
    } catch {
      // best-effort
    }

    const server = getServer?.();
    if (server) {
      server.close(finish);
    } else {
      finish();
    }
  };

  process.on("SIGTERM", () => gracefulSignalShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulSignalShutdown("SIGINT"));

  return { shutdown };
};

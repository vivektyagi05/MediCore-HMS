import { logger } from "../utils/logger.js";

// ROOT CAUSE FIX (backend stability):
//
// Every socket.on("event", async (...) => {...}) handler in this app used to
// run completely unguarded. Socket.IO does not catch rejected promises
// returned from its listeners -- if a handler throws (a malformed payload
// destructured with no validation, a transient DB error, a bad ObjectId,
// etc.) the rejection escapes as a process-level "unhandledRejection".
//
// That alone would just be a bug per-request, except server.js's
// unhandledRejection handler called `server.close(() => process.exit(1))`
// on ANY such rejection anywhere in the app. server.close() waits for all
// open connections to drain before firing its callback, and open
// WebSocket connections don't naturally close -- so under real traffic,
// the first edge-case error in *any* socket handler would push the whole
// HTTP+Socket.IO server into limbo: no longer accepting new requests, but
// never actually exiting either, since the close() callback (and the
// process.exit inside it) was waiting on connections that would never
// drop. That is the "stops responding until manually restarted" symptom.
//
// This wrapper catches the error at the source instead: it logs the
// failure, tells the caller (via ack, if provided) that this specific
// request failed, and emits a scoped error event to the socket -- without
// ever letting the failure reach process-level handlers or take down
// any other connection.
export const wrapAsyncSocketHandler = (socket, eventName, handler) => {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      logger.error("Socket event handler failed", {
        event: eventName,
        socketId: socket.id,
        userId: socket.user?._id?.toString?.(),
        message: error?.message,
        stack: error?.stack,
      });

      // If the client passed an ack callback (always the last arg in this
      // codebase's convention), resolve it with a failure instead of
      // leaving the client's promise/callback hanging forever.
      const possibleAck = args[args.length - 1];
      if (typeof possibleAck === "function") {
        try {
          possibleAck({ success: false, message: "Something went wrong processing that request" });
        } catch {
          // The ack itself failed (e.g. socket already disconnected) --
          // nothing more we can safely do here.
        }
      }

      try {
        socket.emit("realtime:error", {
          event: eventName,
          message: "Something went wrong processing that request",
        });
      } catch {
        // Socket may already be gone; safe to ignore.
      }
    }
  };
};

// Same idea, applied to the top-level io.on("connection", ...) handler,
// which has no ack and no eventName -- a failure here (e.g. a DB hiccup
// while computing default rooms) must not crash or wedge the server for
// every other connected client either.
export const wrapAsyncConnectionHandler = (handler) => {
  return async (socket, ...rest) => {
    try {
      await handler(socket, ...rest);
    } catch (error) {
      logger.error("Socket connection handler failed", {
        socketId: socket?.id,
        userId: socket?.user?._id?.toString?.(),
        message: error?.message,
        stack: error?.stack,
      });
      try {
        socket.emit("socket:error", { message: "Failed to initialize realtime connection" });
        socket.disconnect(true);
      } catch {
        // Socket may already be gone; safe to ignore.
      }
    }
  };
};

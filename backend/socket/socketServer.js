import { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { registerEventHandlers } from "./eventHandlers.js";
import { presenceManager } from "./presenceManager.js";
import { roomManager } from "./roomManager.js";
import { socketAuth } from "./socketAuth.js";
import { wrapAsyncConnectionHandler, wrapAsyncSocketHandler } from "./asyncSocketHandler.js";

let io;

export const initSocketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigin,
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(socketAuth);

  // PHASE 2-D — Socket.IO diagnostics bugfix (see socketAuth.js for the
  // handshake-rejection half of this). engine.io's own "connection_error"
  // event fires for transport-level failures that never reach io.use()
  // at all (a CORS origin mismatch on the handshake request, a malformed
  // upgrade request, etc.) and was previously not observed anywhere --
  // another way the reported "connection closes before establishment"
  // symptom could happen with zero server-side trace of why.
  io.engine.on("connection_error", (err) => {
    logger.warn("Socket.IO transport-level connection error", {
      code: err.code,
      message: err.message,
      context: err.context,
    });
  });

  io.on("connection", wrapAsyncConnectionHandler(async (socket) => {
    const rooms = await roomManager.defaultRoomsForUser(socket.user);
    await Promise.all(rooms.map((room) => socket.join(room)));
    await presenceManager.markOnline(io, socket);

    socket.emit("socket:ready", {
      userId: socket.user._id,
      role: socket.user.role,
      rooms,
      onlineUsers: presenceManager.snapshotFor(socket.user),
    });

    registerEventHandlers(io, socket);

    socket.on("disconnect", wrapAsyncSocketHandler(socket, "disconnect", async (reason) => {
      await presenceManager.markOffline(io, socket);
      logger.info("Socket disconnected", { socketId: socket.id, reason });
    }));

    logger.info("Socket connected", {
      socketId: socket.id,
      userId: socket.user._id.toString(),
      role: socket.user.role,
    });
  }));

  logger.info("Socket.IO server initialized");
  return io;
};

export const getIO = () => io;

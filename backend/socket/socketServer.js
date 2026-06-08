import { Server } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { registerEventHandlers } from "./eventHandlers.js";
import { presenceManager } from "./presenceManager.js";
import { roomManager } from "./roomManager.js";
import { socketAuth } from "./socketAuth.js";

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

  io.on("connection", async (socket) => {
    const rooms = await roomManager.defaultRoomsForUser(socket.user);
    await Promise.all(rooms.map((room) => socket.join(room)));
    await presenceManager.markOnline(io, socket);

    socket.emit("socket:ready", {
      userId: socket.user._id,
      role: socket.user.role,
      rooms,
      onlineUsers: presenceManager.snapshot(),
    });

    registerEventHandlers(io, socket);

    socket.on("disconnect", async (reason) => {
      await presenceManager.markOffline(io, socket);
      logger.info("Socket disconnected", { socketId: socket.id, reason });
    });

    logger.info("Socket connected", {
      socketId: socket.id,
      userId: socket.user._id.toString(),
      role: socket.user.role,
    });
  });

  logger.info("Socket.IO server initialized");
  return io;
};

export const getIO = () => io;

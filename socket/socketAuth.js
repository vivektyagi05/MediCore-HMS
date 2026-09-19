import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import { logger } from "../utils/logger.js";

const getToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake.headers?.authorization;
  if (header?.startsWith("Bearer ")) return header.split(" ")[1];
  return null;
};

// PHASE 2-D — Socket.IO diagnostics bugfix: every rejection path in this
// middleware previously called next(new Error(...)) with no logging at
// all. Socket.IO responds to a middleware rejection by refusing the
// handshake and closing the transport immediately -- which, from the
// browser, looks exactly like "the WebSocket connection closed before it
// was established" with nothing in the server logs to explain why (bad
// token, expired token, deactivated account, DB hiccup looking up the
// user -- all indistinguishable from the outside). This was the actual
// reason the reported symptom was undiagnosable: the failure was real,
// just invisible. Logging it here does not change the reported failure
// mode (a genuinely missing/expired/invalid token still, correctly,
// closes the connection) but makes the reason visible in server logs
// instead of only ever surfacing as a generic connect_error in the
// browser.
export const socketAuth = async (socket, next) => {
  try {
    const token = getToken(socket);
    if (!token) {
      logger.warn("Socket handshake rejected: no auth token provided", { socketId: socket.id });
      return next(new Error("Socket authentication token is required"));
    }

    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch (error) {
      logger.warn("Socket handshake rejected: invalid or expired token", {
        socketId: socket.id,
        errorName: error.name,
      });
      return next(new Error("Invalid or expired socket token"));
    }

    const user = await User.findById(payload.userId).select("-password");
    if (!user || !user.isActive) {
      logger.warn("Socket handshake rejected: user not found or inactive", {
        socketId: socket.id,
        userId: payload.userId,
      });
      return next(new Error("Authenticated user is no longer active"));
    }

    socket.user = user;
    socket.session = {
      userId: user._id.toString(),
      role: user.role,
      connectedAt: new Date(),
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers["user-agent"],
    };

    return next();
  } catch (error) {
    logger.error("Socket handshake failed unexpectedly", {
      socketId: socket.id,
      message: error?.message,
      stack: env.isProduction ? undefined : error?.stack,
    });
    return next(new Error("Invalid or expired socket token"));
  }
};

import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";

const getToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake.headers?.authorization;
  if (header?.startsWith("Bearer ")) return header.split(" ")[1];
  return null;
};

export const socketAuth = async (socket, next) => {
  try {
    const token = getToken(socket);
    if (!token) return next(new Error("Socket authentication token is required"));

    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.userId).select("-password");
    if (!user || !user.isActive) return next(new Error("Authenticated user is no longer active"));

    socket.user = user;
    socket.session = {
      userId: user._id.toString(),
      role: user.role,
      connectedAt: new Date(),
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers["user-agent"],
    };

    return next();
  } catch {
    return next(new Error("Invalid or expired socket token"));
  }
};

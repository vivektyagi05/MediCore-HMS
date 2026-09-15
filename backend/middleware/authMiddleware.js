import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import { AppError } from "./errorMiddleware.js";
import { asyncHandler } from "./asyncHandler.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("Authentication token is required", 401);
  }

  const token = authHeader.split(" ")[1];

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError("Invalid or expired authentication token", 401);
  }

  const user = await User.findById(payload.userId).select("-password");

  if (!user || !user.isActive) {
    throw new AppError("Authenticated user is no longer active", 401);
  }

  // Phase P15 — a password reset bumps user.securityVersion. Any token
  // issued before that reset carries the old value and must be rejected,
  // even though it hasn't expired yet. This is the actual mechanism that
  // makes "old sessions are invalidated after password reset" true.
  const tokenSecurityVersion = payload.securityVersion || 0;
  if (tokenSecurityVersion !== (user.securityVersion || 0)) {
    throw new AppError("Session has been invalidated. Please log in again.", 401);
  }

  req.user = user;
  next();
});


// Public workflows may accept an already-authenticated visitor without making
// authentication mandatory. Invalid/missing tokens are treated as anonymous;
// protected routes must continue using protect().
export const optionalProtect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return next();
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.userId).select("-password");
    if (user?.isActive && (payload.securityVersion || 0) === (user.securityVersion || 0)) req.user = user;
  } catch {
    // Public lead creation remains available anonymously; no account details
    // are disclosed because invalid credentials are never surfaced.
  }
  return next();
});

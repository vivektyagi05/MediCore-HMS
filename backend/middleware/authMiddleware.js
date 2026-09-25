import { AppError } from "./errorMiddleware.js";
import { asyncHandler } from "./asyncHandler.js";
import { authenticateAccessToken, SessionRejectedError } from "../services/sessionAuthService.js";

// Session validity (signature, expiry, active user, securityVersion) is
// decided in ONE place -- services/sessionAuthService.js -- shared with the
// Socket.IO handshake so REST and realtime can never disagree.
export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("Authentication token is required", 401);
  }

  try {
    const { user } = await authenticateAccessToken(authHeader.split(" ")[1]);
    req.user = user;
  } catch (error) {
    if (error instanceof SessionRejectedError) throw new AppError(error.message, 401);
    throw error;
  }
  next();
});

// Public workflows may accept an already-authenticated visitor without making
// authentication mandatory. Invalid/missing tokens are treated as anonymous;
// protected routes must continue using protect().
export const optionalProtect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return next();
  try {
    const { user } = await authenticateAccessToken(authHeader.split(" ")[1]);
    req.user = user;
  } catch (error) {
    // Only an invalid *session* is treated as anonymous. Infrastructure
    // failures (database down) must surface instead of silently downgrading.
    if (!(error instanceof SessionRejectedError)) throw error;
  }
  return next();
});

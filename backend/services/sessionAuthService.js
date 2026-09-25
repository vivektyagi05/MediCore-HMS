// ─────────────────────────────────────────────────────────────────────────
// ONE session-validity decision for REST (protect / optionalProtect) and
// Socket.IO (handshake + ongoing revalidation).
//
// A session is valid only if ALL of these hold:
//   1. the JWT signature verifies and it has not expired
//   2. the user still exists
//   3. the user is active (deactivation revokes access)
//   4. the token's securityVersion equals the user's current one
//      (a password reset bumps it, killing every older token)
//
// Before this module the socket handshake implemented 1-3 but skipped 4, so a
// password reset revoked REST access while an attacker's old token kept a
// live socket (and its chat/notification rooms).
// ─────────────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";

export const SESSION_REJECTION = Object.freeze({
  TOKEN_INVALID: "TOKEN_INVALID",
  USER_INACTIVE: "USER_INACTIVE",
  SESSION_INVALIDATED: "SESSION_INVALIDATED",
});

export const SESSION_REJECTION_MESSAGES = Object.freeze({
  [SESSION_REJECTION.TOKEN_INVALID]: "Invalid or expired authentication token",
  [SESSION_REJECTION.USER_INACTIVE]: "Authenticated user is no longer active",
  [SESSION_REJECTION.SESSION_INVALIDATED]: "Session has been invalidated. Please log in again.",
});

export class SessionRejectedError extends Error {
  constructor(code) {
    super(SESSION_REJECTION_MESSAGES[code]);
    this.name = "SessionRejectedError";
    this.code = code;
  }
}

/** Pure: does a loaded user still satisfy the session? Returns a rejection code or null. */
export function evaluateSession(user, tokenSecurityVersion) {
  if (!user || user.isActive === false || user.isActive === undefined) return SESSION_REJECTION.USER_INACTIVE;
  if ((tokenSecurityVersion || 0) !== (user.securityVersion || 0)) return SESSION_REJECTION.SESSION_INVALIDATED;
  return null;
}

/**
 * Verify a bearer token and load the user.
 * @throws {SessionRejectedError}
 * @returns {Promise<{ user: object, payload: object }>}
 */
export async function authenticateAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new SessionRejectedError(SESSION_REJECTION.TOKEN_INVALID);
  }
  const user = await User.findById(payload.userId).select("-password");
  const rejection = evaluateSession(user, payload.securityVersion);
  if (rejection) throw new SessionRejectedError(rejection);
  return { user, payload };
}

/**
 * Re-check an ALREADY-authenticated session against the database (used by
 * long-lived socket connections). Returns a rejection code or null.
 */
export async function revalidateSession(userId, tokenSecurityVersion) {
  const user = await User.findById(userId).select("isActive securityVersion role").lean();
  return evaluateSession(user, tokenSecurityVersion);
}

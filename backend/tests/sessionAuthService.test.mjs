import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import {
  authenticateAccessToken,
  evaluateSession,
  revalidateSession,
  SessionRejectedError,
  SESSION_REJECTION,
} from "../services/sessionAuthService.js";

console.log("sessionAuthService.test.mjs");

// ── pure decision ─────────────────────────────────────────────────────
assert.equal(evaluateSession(null, 0), SESSION_REJECTION.USER_INACTIVE);
assert.equal(evaluateSession({ isActive: false, securityVersion: 0 }, 0), SESSION_REJECTION.USER_INACTIVE);
assert.equal(evaluateSession({ isActive: true, securityVersion: 2 }, 1), SESSION_REJECTION.SESSION_INVALIDATED);
assert.equal(evaluateSession({ isActive: true, securityVersion: 0 }, undefined), null, "missing token version defaults to 0");
assert.equal(evaluateSession({ isActive: true, securityVersion: 3 }, 3), null);
console.log("PASS: evaluateSession covers inactive / stale-version / valid");

// ── token verification + user load ───────────────────────────────────
const sign = (payload) => jwt.sign(payload, env.jwtSecret);
const asRejection = async (fn, code) => {
  await assert.rejects(fn, (e) => e instanceof SessionRejectedError && e.code === code);
};

User.findById = () => ({ select: async () => null });
await asRejection(() => authenticateAccessToken(sign({ userId: "x", securityVersion: 0 })), SESSION_REJECTION.USER_INACTIVE);
console.log("PASS: unknown user is rejected (not thrown as an unhandled DB shape)");

User.findById = () => ({ select: async () => ({ _id: "u1", isActive: false, securityVersion: 0 }) });
await asRejection(() => authenticateAccessToken(sign({ userId: "u1", securityVersion: 0 })), SESSION_REJECTION.USER_INACTIVE);
console.log("PASS: deactivated user's token is rejected");

User.findById = () => ({ select: async () => ({ _id: "u1", isActive: true, securityVersion: 2 }) });
await asRejection(() => authenticateAccessToken(sign({ userId: "u1", securityVersion: 1 })), SESSION_REJECTION.SESSION_INVALIDATED);
console.log("PASS: a token signed before a password reset is rejected (old securityVersion)");

await asRejection(() => authenticateAccessToken("not-a-real-jwt"), SESSION_REJECTION.TOKEN_INVALID);
console.log("PASS: a malformed token is rejected as TOKEN_INVALID, not a crash");

User.findById = () => ({ select: async () => ({ _id: "u1", isActive: true, securityVersion: 2 }) });
const { user } = await authenticateAccessToken(sign({ userId: "u1", securityVersion: 2 }));
assert.equal(user._id, "u1");
console.log("PASS: a valid, current-version token succeeds");

// ── revalidation (the socket long-lived-connection path) ───────────────
User.findById = () => ({ select: () => ({ lean: async () => ({ isActive: true, securityVersion: 5 }) }) });
assert.equal(await revalidateSession("u1", 5), null);
assert.equal(await revalidateSession("u1", 4), SESSION_REJECTION.SESSION_INVALIDATED, "a reset that happens mid-connection must be caught on the next revalidation");
User.findById = () => ({ select: () => ({ lean: async () => ({ isActive: false, securityVersion: 5 }) }) });
assert.equal(await revalidateSession("u1", 5), SESSION_REJECTION.USER_INACTIVE, "a deactivation that happens mid-connection must be caught");
console.log("PASS: revalidateSession catches a reset/deactivation that happens after the socket already connected");

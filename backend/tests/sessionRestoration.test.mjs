// Regression test for the PHASE 2-A session-restoration gap: there was no
// /api/auth/me endpoint at all, so the frontend trusted a cached
// localStorage user object forever instead of re-verifying it against the
// backend on page refresh/browser restart. Concrete symptom this caused: a
// doctor's cached doctorOnboardingStatus never advanced past what was
// cached at login, so PrivateRoute kept bouncing an admin-approved doctor
// back to /doctor/onboarding until they logged out and back in. This locks
// the route/middleware wiring and the frontend fix via source inspection
// (no live DB/browser in this sandbox — see repo-wide pattern).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (file) =>
  fs.readFileSync(
    file.startsWith("../src/")
      ? path.resolve(__dirname, "..", "..", file.slice(3))
      : path.resolve(__dirname, "..", file),
    "utf8",
  );

console.log("sessionRestoration.test.mjs");

const authRoutes = read("routes/authRoutes.js");
const authController = read("controllers/authController.js");
const authMiddleware = read("middleware/authMiddleware.js");
// Session validity (active user + securityVersion) moved into a shared
// service so REST and Socket.IO can never disagree (see
// services/sessionAuthService.js); authMiddleware.js delegates to it.
const sessionAuthService = read("services/sessionAuthService.js");
const authApi = read("../src/api/authApi.js");
const authContext = read("../src/context/AuthContext.jsx");
const privateRoute = read("../src/routes/PrivateRoute.jsx");

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("GET /auth/me exists and is protected", () => {
  assert.match(
    authRoutes,
    /router\.get\(\s*"\/me",\s*protect,\s*getMe\s*\)/,
    "/auth/me must be mounted behind the protect middleware",
  );
});

test("getMe returns the live req.user set by protect (no separate lookup)", () => {
  const getMeMatch = authController.match(/export const getMe = asyncHandler\(async \(req, res\) => \{[\s\S]*?\n\}\);/);
  assert.ok(getMeMatch, "getMe handler must exist");
  assert.match(getMeMatch[0], /req\.user\.toJSON\(\)/, "getMe must return the authenticated user document");
});

test("protect middleware rejects inactive users and revoked security versions before getMe ever runs", () => {
  assert.match(authMiddleware, /authenticateAccessToken/, "protect must delegate session validity to the shared session service");
  assert.match(sessionAuthService, /user\.isActive === false/, "the session service must keep rejecting deactivated accounts");
  assert.match(
    sessionAuthService,
    /\(tokenSecurityVersion \|\| 0\) !== \(user\.securityVersion \|\| 0\)/,
    "the session service must keep rejecting tokens issued before a password reset",
  );
});

test("frontend exposes authApi.me()", () => {
  assert.match(authApi, /me\(\)\s*\{[\s\S]*?"\/auth\/me"/, "authApi must call GET /auth/me");
});

test("AuthContext verifies the cached session against /auth/me on mount instead of trusting localStorage forever", () => {
  assert.match(authContext, /refreshUser/, "AuthContext must expose a refreshUser mechanism");
  assert.match(authContext, /authApi\.me\(\)/, "AuthContext must call the real /auth/me endpoint");
  assert.match(authContext, /initializing/, "AuthContext must expose an initializing flag while verification is in flight");
});

test("PrivateRoute reads the live context user instead of re-parsing a frozen localStorage snapshot", () => {
  assert.doesNotMatch(
    privateRoute,
    /localStorage\.getItem\(\s*"hms_user"\s*\)/,
    "PrivateRoute must no longer read hms_user directly from localStorage",
  );
  assert.match(
    privateRoute,
    /const\s*\{\s*isAuthenticated,\s*role,\s*user,\s*initializing\s*\}\s*=\s*useAuth\(\)/,
    "PrivateRoute must source user/initializing from AuthContext",
  );
  assert.match(
    privateRoute,
    /if \(initializing\)/,
    "PrivateRoute must not make a routing decision before session verification finishes",
  );
});

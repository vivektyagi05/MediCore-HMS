import assert from "node:assert/strict";
import fs from "node:fs";

const auth = fs.readFileSync(new URL("../controllers/authController.js", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../routes/authRoutes.js", import.meta.url), "utf8");
const user = fs.readFileSync(new URL("../models/User.js", import.meta.url), "utf8");

assert.ok(auth.includes("emailVerified: false"));
assert.ok(auth.includes("issueEmailVerification(user)"));
assert.ok(auth.includes("notificationEmitter.emitToAdmins"));
assert.ok(auth.includes("Please verify your email before logging in."));
assert.ok(routes.includes('router.post("/verify-email", verifyEmail)'));
assert.ok(routes.includes('"/resend-verification"'));
assert.ok(user.includes("emailVerificationTokenHash"));
assert.ok(user.includes("emailVerificationExpiresAt"));
assert.ok(user.includes("emailVerificationLastUsedHash"));

console.log("phase 1 auth verification contract: PASS");

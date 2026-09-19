import assert from "node:assert/strict";
import fs from "node:fs";

const auth = fs.readFileSync(new URL("../controllers/authController.js", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../routes/authRoutes.js", import.meta.url), "utf8");
const user = fs.readFileSync(new URL("../models/User.js", import.meta.url), "utf8");

const registerBody = auth.slice(auth.indexOf("export const register"), auth.indexOf("export const verifyEmail"));
assert.ok(!registerBody.includes("buildAuthResponse(user)"), "registration must not create an authenticated session");
assert.ok(auth.includes("user.role !== ROLES.SUPER_ADMIN && !user.emailVerified"), "unverified patient/doctor login must remain blocked while SUPER_ADMIN behaviour is unchanged");
assert.ok(auth.includes("verificationCooldownMs"), "resend cooldown must remain enforced");

assert.ok(auth.includes("emailVerified: false"));
assert.ok(auth.includes("issueEmailVerification(user)"));
assert.ok(auth.includes("notificationEmitter.emitToAdmins"));
assert.ok(auth.includes("emailService.sendNewUserAdminNotification"));
assert.ok(auth.includes("userEmail: user.email"));
assert.ok(auth.includes("Please verify your email before logging in."));
assert.ok(routes.includes('router.post("/verify-email", verifyEmail)'));
assert.ok(routes.includes('"/resend-verification"'));
assert.ok(user.includes("emailVerificationTokenHash"));
assert.ok(user.includes("emailVerificationExpiresAt"));
assert.ok(user.includes("emailVerificationLastUsedHash"));

console.log("phase 1 auth verification contract: PASS");

import assert from "assert";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const controller = readFileSync(path.join(root, "backend/controllers/passwordRecoveryController.js"), "utf8");
const emailService = readFileSync(path.join(root, "backend/services/emailService.js"), "utf8");
const forgotPage = readFileSync(path.join(root, "src/pages/auth/ForgotPassword.jsx"), "utf8");
const model = readFileSync(path.join(root, "backend/models/PasswordReset.js"), "utf8");

assert.ok(controller.includes('if (!isBrevoConfigured())'), "forgot-password must gate provider availability before account-specific recovery");
assert.ok(controller.includes('res.status(503).json({'), "provider failure must return controlled HTTP 503");
// The controller distinguishes provider-failure categories (credential /
// rate_limit / network / provider_5xx) and falls back to the generic
// PASSWORD_RECOVERY_UNAVAILABLE code when no category is known. Assert the
// full taxonomy plus the safe default, rather than a single literal
// "code: "..."" string (the code is computed dynamically, not inlined).
assert.ok(controller.includes('"PASSWORD_RECOVERY_UNAVAILABLE"'), "provider failure must expose a stable safe default error code");
assert.ok(controller.includes('"EMAIL_PROVIDER_CREDENTIAL_ERROR"'), "credential failures must expose a stable safe error code");
assert.ok(controller.includes('"EMAIL_PROVIDER_RATE_LIMITED"'), "rate-limited failures must expose a stable safe error code");
assert.ok(controller.includes('"EMAIL_PROVIDER_UNREACHABLE"'), "network failures must expose a stable safe error code");
assert.ok(controller.includes('"EMAIL_PROVIDER_UNAVAILABLE"'), "5xx provider failures must expose a stable safe error code");
assert.ok(/res\.status\(503\)\.json\(\{\s*success:\s*false,\s*code,/.test(controller), "the 503 response must send the computed error code, not a hardcoded literal");
assert.ok(!controller.includes("fakeRecoveryId"), "fake recovery IDs are forbidden");
assert.ok(!controller.includes("Math.random"), "Math.random must not be used in password recovery");
assert.ok(!controller.includes('res.status(200).json({\n      success: true,\n      message: GENERIC_REQUEST_MESSAGE,\n      data: { recoveryId: fakeRecoveryId()'), "provider failure must never return fake success");
assert.ok(emailService.includes('https://api.brevo.com/v3/smtp/email'), "production recovery must use the real Brevo API");
assert.ok(emailService.includes('if (!data?.messageId)'), "Brevo acceptance must require a messageId");
assert.ok(forgotPage.includes('PASSWORD_RECOVERY_UNAVAILABLE'), "frontend must recognize provider-unavailable responses");
assert.ok(forgotPage.includes('!recovery?.recoveryId'), "frontend must never navigate to OTP without a real recovery ID");
assert.ok(model.includes('passwordResetSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 })'), "recovery records need a single TTL lifecycle index");
assert.strictEqual((model.match(/index\(\{\s*createdAt:\s*1/g) || []).length, 1, "TTL index must be declared exactly once");
console.log("PASS: P15 provider-failure/no-fake-success contract");

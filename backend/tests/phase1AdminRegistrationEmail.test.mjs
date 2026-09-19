import assert from "node:assert/strict";
import fs from "node:fs";

const auth = fs.readFileSync(new URL("../controllers/authController.js", import.meta.url), "utf8");
const emailService = fs.readFileSync(new URL("../services/emailService.js", import.meta.url), "utf8");

assert.ok(auth.includes("user.role === ROLES.PATIENT"), "admin registration email must be scoped to patient/user registrations");
assert.ok(auth.includes("role: ROLES.SUPER_ADMIN"), "active SUPER_ADMIN recipients must be queried");
assert.ok(auth.includes("isActive: true"), "only active SUPER_ADMIN recipients may receive registration email");
assert.ok(auth.includes("emailService.sendNewUserAdminNotification"), "registration must call the existing Brevo email abstraction");
assert.ok(auth.includes("userName: user.name"));
assert.ok(auth.includes("userEmail: user.email"));
assert.ok(auth.includes("userRole: user.role"));

assert.ok(emailService.includes("sendNewUserAdminNotification({ toEmail, userName, userEmail, userRole })"));
assert.ok(emailService.includes("Email: ${escapeHtml(userEmail || \"Unknown\")}"), "template must display the registered user's email");
assert.ok(emailService.includes("Role: ${escapeHtml(userRole || \"Unknown\")}"), "template must display the registered user's role");
assert.ok(!emailService.includes("Email: ${escapeHtml(toEmail)}</p>"), "template must never label the admin recipient address as the new user's email");

console.log("phase 1 admin registration email contract: PASS");

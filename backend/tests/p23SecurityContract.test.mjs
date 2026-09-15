import assert from "node:assert/strict";

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");


const email = read("services/emailService.js");
const env = read("config/env.js");
const pkg = JSON.parse(read("package.json"));

assert.ok(!email.includes("nodemailer"), "email service must not import/use Nodemailer");
assert.ok(!email.includes("env.smtp"), "email service must not use SMTP configuration");
assert.ok(email.includes("api.brevo.com/v3/smtp/email"), "financial email must use Brevo HTTP API");
assert.ok(!env.includes("smtp:"), "SMTP configuration must not remain in runtime config");
assert.equal(pkg.dependencies.nodemailer, undefined, "Nodemailer must not remain a runtime dependency");
assert.ok(read("payments/paymentGateway.js").includes("testGateway"), "gateway adapter must expose isolated test gateway");
assert.ok(fs.existsSync(path.join(root, "models/PaymentAttempt.js")), "payment attempt model must exist");
assert.ok(fs.existsSync(path.join(root, "payments/paymentStateMachine.js")), "payment state machine must exist");
assert.ok(fs.existsSync(path.join(root, "payments/refundStateMachine.js")), "refund state machine must exist");
console.log("P23 security contract tests: PASS");

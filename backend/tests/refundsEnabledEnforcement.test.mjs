// Regression test: HospitalSetting.paymentSettings.refundsEnabled was only
// ever read back for public display (controllers/publicController.js) --
// switching it off in Admin > Settings did not stop a patient from
// requesting a refund, nor an admin from actually processing one.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log("refundsEnabledEnforcement.test.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "controllers/refundController.js"), "utf8");

const slice = (start, end) => src.slice(src.indexOf(start), end ? src.indexOf(end) : undefined);

// ── patient intake is gated, admin override is not ──────────────────────
const intakeFn = slice("const buildRefundRequestForEntryPoint", "const cancelRefundReasonFor") !== ""
  ? slice("const buildRefundRequestForEntryPoint", "export const createRefundRequest")
  : slice("const buildRefundRequestForEntryPoint");
assert.match(intakeFn, /req\.user\.role === ROLES\.PATIENT && !\(await areRefundsEnabled\(\)\)/, "patient-initiated refund requests must be gated");
console.log("PASS: patient refund-request intake checks areRefundsEnabled()");

// ── every money-moving admin action is gated unconditionally ────────────
for (const fnName of ["initiateRefund", "approveRefundRequest", "retryRefundRequest"]) {
  const fnBody = slice(`export const ${fnName}`, null).slice(0, 2500);
  assert.match(fnBody, /if \(!\(await areRefundsEnabled\(\)\)\)/, `${fnName} must check areRefundsEnabled() before moving any money`);
}
console.log("PASS: initiateRefund, approveRefundRequest, and retryRefundRequest all check the platform-wide refunds switch");

// ── the check happens before any DB mutation in each of the three ───────
for (const fnName of ["initiateRefund", "approveRefundRequest", "retryRefundRequest"]) {
  const fnBody = slice(`export const ${fnName}`, null).slice(0, 3000);
  const guardIndex = fnBody.indexOf("areRefundsEnabled()");
  const mutationIndex = fnBody.search(/\.(save|findOneAndUpdate|findByIdAndUpdate)\(/);
  assert.ok(guardIndex > -1 && (mutationIndex === -1 || guardIndex < mutationIndex), `${fnName}: the refunds-enabled guard must run before any write`);
}
console.log("PASS: the guard runs before any refund-state mutation in each action");

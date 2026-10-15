// Phase 01 — frontend checkout state handling.
// LEVEL: LOCALLY_VERIFIED. The decision logic lives in a pure module
// (src/pages/payment/paymentConfirmation.js) and is executed here; the React
// wiring is covered by source-contract assertions (no browser/jsdom E2E ran).
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyVerifyFailure, deriveCheckoutView, pollAuthoritativeStatus, CONFIRM_DELAYS_MS } from "../../src/pages/payment/paymentConfirmation.js";

const results = [];
const check = async (name, fn) => { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, e]); } };
const http = (status, code) => ({ response: { status, data: { details: code ? { code } : undefined } } });
const statusRes = (recoveryState, extra = {}) => ({ data: { recoveryState, payment: { paymentState: "pending" }, ...extra } });
const noSleep = async () => {};

await check("verify failure classification: only a provider-reported failure is definitive", () => {
  assert.equal(classifyVerifyFailure(http(402, "PAYMENT_FAILED")), "failed");
  assert.equal(classifyVerifyFailure(http(409, "RECONCILIATION_REQUIRED")), "reconciliation");
  assert.equal(classifyVerifyFailure(http(403)), "rejected", "ownership mismatch");
  assert.equal(classifyVerifyFailure(http(404)), "rejected");
  for (const err of [http(503, "VERIFICATION_PENDING"), http(500), http(400), { code: "ECONNABORTED" }, new Error("Network Error")]) {
    assert.equal(classifyVerifyFailure(err), "ambiguous", "timeouts/network/5xx/unconfirmed signature are never shown as failure");
  }
});
await check("callback timeout while the provider captured: polling ends in SUCCESS from backend evidence", async () => {
  const seq = [statusRes("PENDING"), statusRes("PENDING"), statusRes("SUCCESS")];
  let calls = 0;
  const r = await pollAuthoritativeStatus({ fetchStatus: async () => seq[Math.min(calls++, seq.length - 1)], sleep: noSleep });
  assert.equal(r.state, "success"); assert.equal(calls, 3);
});
await check("failed verification followed by a late successful webhook converges to success", async () => {
  let calls = 0;
  const r = await pollAuthoritativeStatus({ fetchStatus: async () => (++calls < 3 ? statusRes("PENDING", { payment: { paymentState: "verification_pending" } }) : statusRes("SUCCESS")), sleep: noSleep });
  assert.equal(r.state, "success");
});
await check("budget exhausted while still pending -> 'unknown', never success or failure", async () => {
  let calls = 0; const waits = [];
  const r = await pollAuthoritativeStatus({ fetchStatus: async () => { calls += 1; return statusRes("PENDING"); }, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r.state, "unknown"); assert.equal(calls, CONFIRM_DELAYS_MS.length + 1, "bounded");
  assert.deepEqual(waits, [...CONFIRM_DELAYS_MS], "backoff, not a hot loop");
});
await check("network disconnection during polling is retried within the budget", async () => {
  let calls = 0;
  const r = await pollAuthoritativeStatus({ fetchStatus: async () => { calls += 1; if (calls < 3) throw new Error("offline"); return statusRes("SUCCESS"); }, sleep: noSleep });
  assert.equal(r.state, "success");
});
await check("authoritative failure and reconciliation are surfaced as such", async () => {
  assert.equal((await pollAuthoritativeStatus({ fetchStatus: async () => statusRes("FAILED"), sleep: noSleep })).state, "failed");
  assert.equal((await pollAuthoritativeStatus({ fetchStatus: async () => statusRes("REQUIRES_RECONCILIATION"), sleep: noSleep })).state, "reconciliation");
});
await check("unmount stops polling", async () => {
  let calls = 0;
  const r = await pollAuthoritativeStatus({ fetchStatus: async () => { calls += 1; return statusRes("PENDING"); }, sleep: noSleep, shouldStop: () => calls >= 2 });
  assert.equal(r.stopped, true); assert.equal(calls, 2);
});
await check("refresh/reconnect restores the view from the backend payload", () => {
  assert.equal(deriveCheckoutView(null), "fresh");
  assert.equal(deriveCheckoutView({ recoveryState: "NONE" }), "fresh");
  assert.equal(deriveCheckoutView({ recoveryState: "SUCCESS" }), "success");
  assert.equal(deriveCheckoutView({ recoveryState: "FAILED" }), "failed");
  assert.equal(deriveCheckoutView({ recoveryState: "REQUIRES_RECONCILIATION" }), "reconciliation");
  assert.equal(deriveCheckoutView({ recoveryState: "PENDING", currentOrder: { id: "o" }, payment: { paymentState: "pending" } }), "continue");
  assert.equal(deriveCheckoutView({ recoveryState: "PENDING", currentOrder: { id: "o" }, payment: { paymentState: "verification_pending" } }), "confirming", "never invite a second payment while verifying");
  assert.equal(deriveCheckoutView({ recoveryState: "PENDING", payment: { paymentState: "pending" } }), "confirming");
});
await check("PaymentCheckout wiring: no success without backend evidence, no duplicate submission", () => {
  const src = fs.readFileSync(new URL("../../src/pages/payment/PaymentCheckout.jsx", import.meta.url), "utf8");
  assert.match(src, /verified\.data\?\.confirming/, "HTTP 202 keeps confirming instead of navigating");
  assert.match(src, /classifyVerifyFailure\(verifyError\)/);
  assert.match(src, /kind === "ambiguous"[\s\S]*confirmWithBackend\(\)/, "ambiguous outcomes re-read the backend");
  assert.match(src, /if \(checkoutBusy \|\| isPaying \|\| confirmPhase\) return;/, "duplicate checkout submission is blocked");
  assert.match(src, /ondismiss/, "closing the checkout re-reads state instead of assuming failure");
  assert.match(src, /resumeFromRecovery/, "refresh restores an unpaid order from the backend");
  assert.match(src, /ACTIVE_PAYMENT_EXISTS/);
  assert.match(src, /role="status" aria-live="polite"/, "confirming state is announced");
  assert.ok(!/toast\.error\(getApiErrorMessage\(verifyError\)\);\s*setWorkflowStep\(3\);\s*await checkRecovery\(\);\s*\}\s*\},\s*\}\)/.test(src), "old unconditional error-on-any-verify-failure handler is gone");
});

let failed = 0;
for (const [name, ok, err] of results) { if (ok) console.log(`  ok   ${name}`); else { failed += 1; console.log(`  FAIL ${name}\n       ${err?.stack?.split("\n").slice(0, 3).join("\n       ")}`); } }
console.log(`phase01CheckoutRecovery: ${results.length - failed}/${results.length} passed (LOCALLY_VERIFIED; no browser E2E)`);
process.exit(failed ? 1 : 0);

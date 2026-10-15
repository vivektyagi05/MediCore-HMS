import assert from "node:assert/strict";
import fs from "node:fs";
// Source-contract tests (NOT REAL-MONGO VERIFIED): pin the structural
// guarantees that make browser verify, webhook and reconciliation converge.
const ctl = fs.readFileSync(new URL("../controllers/paymentController.js", import.meta.url), "utf8");
const hook = fs.readFileSync(new URL("../payments/webhookHandler.js", import.meta.url), "utf8");
const cap = fs.readFileSync(new URL("../payments/paymentCapture.js", import.meta.url), "utf8");

const tr = fs.readFileSync(new URL("../payments/paymentTransitions.js", import.meta.url), "utf8");
assert.match(cap, /transitionPayment\(\{[\s\S]*from: CAPTURABLE_STATES/, "capture must go through the canonical compare-and-set transition");
assert.match(tr, /model\.findOneAndUpdate\(buildFilter\(doc, filter\)/, "the transition must be an atomic conditional update pinned to the validated state");
assert.match(ctl, /claimPaymentCapture\(/, "verifyPayment must use the atomic claim");
assert.match(hook, /claimPaymentCapture\(/, "webhook must use the same atomic claim");
assert.doesNotMatch(ctl, /payment\.status = PAYMENT_STATUS\.CAPTURED/, "no stale-save capture in controller");
assert.doesNotMatch(hook, /payment\.status = PAYMENT_STATUS\.CAPTURED/, "no stale-save capture in webhook");
assert.match(ctl, /alreadyAppliedByThisPayment/, "replay must be recognised, not refunded");
assert.match(ctl, /fresh\.paymentState === "completed" && fresh\.postProcessingState === "complete"/, "completed payments short-circuit post-processing");
assert.match(hook, /error\?\.code !== 11000\) throw error/, "webhook dedupe must rely on the unique index");
assert.ok(hook.indexOf("WebhookEvent.create(") < hook.indexOf("WebhookEvent.findOne({ eventId })"), "the insert is the dedupe gate; any lookup happens only after a duplicate-key error");
assert.doesNotMatch(ctl, /totalAmount \* 0\.[19]/, "no float payout split");
console.log("paymentReplayIdempotency: contract assertions passed (NOT REAL-MONGO VERIFIED)");

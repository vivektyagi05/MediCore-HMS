// Phase 01 — structural guarantees that behaviour tests cannot see.
// LEVEL: source-contract assertions (they prove the wiring exists, NOT runtime
// behaviour; behaviour is covered by phase01PaymentCore.test.mjs / the real-Mongo file).
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ctl = read("controllers/paymentController.js");
const hook = read("payments/webhookHandler.js");
const model = read("models/Payment.js");
const release = read("scripts/release.mjs");
const sched = read("cron/financialScheduler.js");
const app = read("app.js");

// claim first: the Payment row (slot owner) exists before any provider order
const createFn = ctl.slice(ctl.indexOf("export const createPaymentOrder"), ctl.indexOf("export const verifyPayment"));
assert.ok(createFn.indexOf("Payment.create(") > 0 && createFn.indexOf("Payment.create(") < createFn.indexOf("openGatewayOrder("), "payment/slot is claimed before the provider order is created");
assert.match(createFn, /activeAppointmentSlot: true/);
assert.match(createFn, /findActiveAppointmentPayment\(appointment\._id\)/);
assert.match(createFn, /error\?\.code === 11000/, "slot race is resolved from the unique index");
assert.match(model, /name: "uniq_payment_active_appointment"/);
assert.match(model, /partialFilterExpression: \{ activeAppointmentSlot: true \}/);
assert.match(model, /\{ appointmentId: 1, activeAppointmentSlot: 1 \}/, "key must differ from the field-level appointmentId_1 index");

// no blind save() of a possibly-stale Payment document in the payment lifecycle
for (const [name, src] of [["paymentController", ctl], ["webhookHandler", hook]]) {
  assert.ok(!/payment\.save\(/.test(src), `${name} must not save() a payment document`);
}
// the old downgrade defect is gone
assert.ok(!/razorpayOrderId: entity\.order_id[\s\S]{0,120}status: PAYMENT_STATUS\.FAILED/.test(hook), "no direct failed update by order id");
assert.match(read("payments/paymentFailureService.js"), /from: PRE_CAPTURE_STATES/);
assert.match(read("payments/paymentFailureService.js"), /if \(!resolved\.isCurrent\) return "stale_attempt_failed"/);

// one webhook processor: every entry point goes through processWebhookEventRecord
assert.match(hook, /export async function retryWebhookEvent[\s\S]*processWebhookEventRecord\(/);
assert.match(hook, /export const recoverWebhookEvents[\s\S]*processWebhookEventRecord\(/);
assert.match(hook, /razorpayWebhookHandler[\s\S]*processWebhookEventRecord\(/);
assert.equal((hook.match(/export const processEvent/g) || []).length, 1, "a single event processor");
assert.match(hook, /leaseOwner: owner, status: "processing"/, "completion is fenced by the lease owner");
assert.match(hook, /crypto\.timingSafeEqual/);
assert.match(app, /express\.raw\(\{ type: "application\/json"/, "webhook route receives the raw body");
assert.ok(app.indexOf("razorpayWebhookHandler") < app.indexOf("express.json("), "raw route is mounted before the JSON parser");

// release + scheduling
assert.ok(release.indexOf("012_payment_active_slot.js") > 0 && release.indexOf("012_payment_active_slot.js") < release.indexOf("011_ensure_production_indexes.js"), "012 runs before 011");
assert.match(sched, /name: "recoverPaymentEvents"/);

// money/ownership
const verifyFn = ctl.slice(ctl.indexOf("export const verifyPayment"), ctl.indexOf("export const getPaymentStatus"));
assert.ok(verifyFn.indexOf("payment.userId.toString() !== req.user._id.toString()") < verifyFn.indexOf("verifyPaymentSignature"), "ownership is checked before the signature");
assert.match(verifyFn, /paymentGateway\.fetchPayment/, "provider payment is re-fetched, never trusted from the browser");
assert.ok(!/gatewayPayment\.currency \|\| payment\.currency|gatewayPayment\??\.amount \?\? /.test(verifyFn), "missing amount/currency is never substituted");

console.log("phase01Contracts: structural assertions passed (source-contract level)");

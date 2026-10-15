import assert from "node:assert/strict";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x";
process.env.JWT_SECRET ||= "testsecret-testsecret-testsecret-123";
process.env.PAYMENT_GATEWAY_MODE = "test";
process.env.NODE_ENV = "development";

const { paymentGateway } = await import("../payments/paymentGateway.js");
const { normalizeGatewayCallback } = await import("../payments/gatewayCallback.js");

// Regression: the test-complete response (snake_case) used to be posted to
// /payments/verify as-is, which requires camelCase -> 400 on every test payment.
const order = await paymentGateway.createOrder({ amount: 500, currency: "INR", receipt: "r1" });
const resp = paymentGateway.buildPaymentResponse(order.id, "test_payment_1", 500, "INR");
const normalized = normalizeGatewayCallback(resp);
assert.equal(normalized.razorpayOrderId, order.id);
assert.equal(normalized.paymentId, "test_payment_1");
assert.ok(normalized.signature);

// Same cryptographic path as real payments: signature must verify server-side.
assert.equal(paymentGateway.verifyPaymentSignature(normalized), true);
assert.equal(paymentGateway.verifyPaymentSignature({ ...normalized, signature: "forged" }), false);
assert.equal(paymentGateway.verifyPaymentSignature({ ...normalized, paymentId: "test_payment_2" }), false);

// Gateway re-fetch reports the amount/currency the order was paid with.
const fetched = await paymentGateway.fetchPayment({ paymentId: "test_payment_1", orderId: order.id, amount: 500, currency: "INR" });
assert.equal(fetched.status, "captured");
assert.equal(fetched.amount, 50000);

// camelCase callers and junk bodies stay safe.
assert.deepEqual(normalizeGatewayCallback({ razorpayOrderId: " o ", paymentId: "p", signature: "s" }), { razorpayOrderId: "o", paymentId: "p", signature: "s" });
assert.deepEqual(normalizeGatewayCallback({ razorpay_order_id: { $ne: 1 } }), { razorpayOrderId: "", paymentId: "", signature: "" });

// Production guard preserved: test mode must be refused in production.
const { assertProductionConfig } = await import("../config/productionGuards.js");
assert.throws(() => assertProductionConfig({ NODE_ENV: "production", PAYMENT_GATEWAY_MODE: "test", MONGO_URI: "x", JWT_SECRET: "y".repeat(40) }));

console.log("paymentTestGatewayLifecycle: all assertions passed");

// Canonical allocation: exact paise, parts always sum to gross.
const { allocatePayout } = await import("../payments/money.js");
for (const gross of [1, 0.07, 99.99, 1180, 333.33, 1000.05]) {
  const a = allocatePayout(gross, 10);
  assert.equal(Math.round((a.platformFee + a.doctorAmount) * 100), Math.round(gross * 100), `split of ${gross} must sum exactly`);
}
assert.deepEqual(allocatePayout(1000, 10), { grossAmount: 1000, platformFee: 100, doctorAmount: 900 });
console.log("allocatePayout: exact");

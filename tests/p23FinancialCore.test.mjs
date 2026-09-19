import assert from "node:assert/strict";
import crypto from "node:crypto";
import { calculateBill, toPaise, fromPaise } from "../payments/money.js";
import { PAYMENT_TRANSITIONS, assertPaymentTransition } from "../payments/paymentStateMachine.js";
import { REFUND_TRANSITIONS, assertRefundTransition } from "../payments/refundStateMachine.js";

assert.equal(toPaise(0.01), 1);
assert.equal(fromPaise(1), 0.01);
assert.equal(toPaise(100.005), 10001);
assert.deepEqual(calculateBill({ subtotal: 1000, discount: 100, taxRate: 18 }), {
  subtotal: 1000, discount: 100, taxableSubtotal: 900, tax: 162, total: 1062,
});
assert.deepEqual(calculateBill({ subtotal: 1000, discount: 100, taxRate: 0 }), {
  subtotal: 1000, discount: 100, taxableSubtotal: 900, tax: 0, total: 900,
});
assert.ok(PAYMENT_TRANSITIONS.pending.includes("captured"));
assert.ok(REFUND_TRANSITIONS.approved.includes("gateway_processing"));
assert.doesNotThrow(() => assertPaymentTransition("pending", "captured"));
assert.throws(() => assertPaymentTransition("captured", "pending"), /Invalid payment state transition/);
assert.doesNotThrow(() => assertRefundTransition("approved", "gateway_processing"));
assert.throws(() => assertRefundTransition("processed", "approved"), /Invalid refund state transition/);

const signed = crypto.createHmac("sha256", "p23-test-gateway-secret").update("order|payment").digest("hex");
assert.equal(signed.length, 64);

console.log("P23 financial core tests: PASS");

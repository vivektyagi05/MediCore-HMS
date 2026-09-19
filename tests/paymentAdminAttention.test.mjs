// Dependency-free re-check of paymentAdminController.js's real, documented
// "needs attention" rule (no live DB needed — computePaymentAttention is a
// pure function). Locks in: (1) failed-not-yet-reviewed payments flag,
// distinguishing still-retryable vs dead-letter wording; (2) a pending
// refund request flags the payment; (3) a stuck created/pending order
// flags after the 2h threshold, not before; (4) a payment matching zero
// conditions is never flagged; (5) no failure reason is ever fabricated.
import assert from "assert";
import { computePaymentAttention } from "../controllers/admin/paymentAdminController.js";

// 1. Failed, still within retry window (retryCount < 3), not yet reviewed.
const retryable = {
  status: "failed",
  retryResolvedAt: null,
  retryCount: 1,
  createdAt: new Date(),
};
const retryableResult = computePaymentAttention(retryable, false);
assert.strictEqual(retryableResult.needsAttention, true);
assert.ok(retryableResult.attentionReasons.some((r) => r.includes("awaiting retry")));
console.log("PASS: failed payment within retry window flagged with 'awaiting retry' wording");

// 2. Failed, retries exhausted (dead-letter), not yet reviewed.
const deadLetter = {
  status: "failed",
  retryResolvedAt: null,
  retryCount: 3,
  createdAt: new Date(),
};
const deadLetterResult = computePaymentAttention(deadLetter, false);
assert.strictEqual(deadLetterResult.needsAttention, true);
assert.ok(deadLetterResult.attentionReasons.some((r) => r.includes("dead-letter")));
console.log("PASS: failed payment past max retries flagged with 'dead-letter' wording");

// 3. Failed, but already marked reviewed (retryResolvedAt set) — must NOT
// still flag as needing attention.
const alreadyReviewed = {
  status: "failed",
  retryResolvedAt: new Date(),
  retryCount: 3,
  createdAt: new Date(),
};
assert.strictEqual(computePaymentAttention(alreadyReviewed, false).needsAttention, false);
console.log("PASS: a failed payment already marked reviewed is not re-flagged");

// 4. A pending refund request flags the payment even if the payment
// status itself is healthy (captured).
const withPendingRefund = { status: "captured", retryResolvedAt: null, retryCount: 0, createdAt: new Date() };
const pendingRefundResult = computePaymentAttention(withPendingRefund, true);
assert.strictEqual(pendingRefundResult.needsAttention, true);
assert.ok(pendingRefundResult.attentionReasons.some((r) => r.includes("Refund request pending")));
console.log("PASS: a pending refund request flags an otherwise-healthy payment");

// 5. A stuck order: created/pending status older than 2 hours.
const stuckOrder = {
  status: "created",
  retryResolvedAt: null,
  retryCount: 0,
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
};
assert.strictEqual(computePaymentAttention(stuckOrder, false).needsAttention, true);
console.log("PASS: an order stuck at created/pending for >2h is flagged as a stuck checkout");

// 6. A fresh created/pending order (within the 2h grace window) is NOT
// flagged — a patient may still be mid-checkout.
const freshOrder = {
  status: "pending",
  retryResolvedAt: null,
  retryCount: 0,
  createdAt: new Date(Date.now() - 5 * 60 * 1000),
};
assert.strictEqual(computePaymentAttention(freshOrder, false).needsAttention, false);
console.log("PASS: a fresh pending order within the grace window is not flagged");

// 7. A healthy captured payment with no pending refund is never flagged.
const healthy = { status: "captured", retryResolvedAt: null, retryCount: 0, createdAt: new Date() };
const healthyResult = computePaymentAttention(healthy, false);
assert.strictEqual(healthyResult.needsAttention, false);
assert.deepStrictEqual(healthyResult.attentionReasons, []);
console.log("PASS: a healthy captured payment with no pending refund is never flagged");

console.log("ALL PAYMENT ADMIN ATTENTION TESTS PASSED");

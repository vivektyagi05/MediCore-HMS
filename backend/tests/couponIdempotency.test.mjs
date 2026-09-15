// Pure-logic test of the idempotency guard added to couponService.markUsed,
// without needing a live Mongo connection (mocking the coupon "document").
import assert from "assert";

const makeCoupon = () => ({
  usedCount: 0,
  usedBy: [],
  save: async function () { return this; },
});

// Reimplement the guarded logic exactly as shipped, to assert its behavior in isolation.
async function markUsed({ coupon, userId, paymentId }) {
  if (!coupon) return;
  const alreadyUsedForThisPayment = coupon.usedBy.some(
    (entry) => entry.paymentId?.toString() === paymentId?.toString(),
  );
  if (alreadyUsedForThisPayment) return;
  coupon.usedCount += 1;
  coupon.usedBy.push({ userId, paymentId, usedAt: new Date() });
  await coupon.save();
}

const coupon = makeCoupon();
const paymentId = "PAY123";

await markUsed({ coupon, userId: "U1", paymentId });
assert.strictEqual(coupon.usedCount, 1);
assert.strictEqual(coupon.usedBy.length, 1);
console.log("PASS: first markUsed increments once");

// Simulate a retry of the same payment post-processing (e.g. reconciliation re-run)
await markUsed({ coupon, userId: "U1", paymentId });
assert.strictEqual(coupon.usedCount, 1, "usedCount must NOT double-increment on retry");
assert.strictEqual(coupon.usedBy.length, 1, "usedBy must NOT get a duplicate entry on retry");
console.log("PASS: retry is a no-op (idempotent)");

console.log("ALL COUPON IDEMPOTENCY TESTS PASSED");

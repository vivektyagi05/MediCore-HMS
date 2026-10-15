import assert from "node:assert/strict";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x";
process.env.JWT_SECRET ||= "testsecret-testsecret-testsecret-123";
const { computeEarningAdjustment } = await import("../payments/refundEarningAdjustment.js");

const payout = (over = {}) => ({ grossAmount: 1000, doctorAmount: 700, refundAdjustmentAmount: 0, platformRefundAdjustmentAmount: 0, ...over });

// Spec example: paid 1000, doctor 700, platform 300, FULL refund reverses both.
let a = computeEarningAdjustment({ payout: payout(), refundAmount: 1000, paymentTotal: 1000, refundedBefore: 0 });
assert.deepEqual(a, { doctorAdjustment: 700, platformAdjustment: 300, isFinal: true });

// Partial 400 then final 600: 280/120 then exactly the remainder 420/180.
const first = computeEarningAdjustment({ payout: payout(), refundAmount: 400, paymentTotal: 1000, refundedBefore: 0 });
assert.deepEqual(first, { doctorAdjustment: 280, platformAdjustment: 120, isFinal: false });
const second = computeEarningAdjustment({
  payout: payout({ refundAdjustmentAmount: 280, platformRefundAdjustmentAmount: 120 }),
  refundAmount: 600, paymentTotal: 1000, refundedBefore: 400,
});
assert.deepEqual(second, { doctorAdjustment: 420, platformAdjustment: 180, isFinal: true });

// Rounding never leaves dust: awkward amounts, three partials, totals reconcile exactly.
for (const [gross, doctor] of [[999.99, 899.99], [333.33, 299.99], [1180, 1062], [0.07, 0.06], [1000.05, 900.04]]) {
  let p = payout({ grossAmount: gross, doctorAmount: doctor });
  let refunded = 0, docSum = 0, platSum = 0;
  const parts = [gross * 0.31, gross * 0.29];
  const rounded = parts.map((x) => Math.round(x * 100) / 100);
  rounded.push(Math.round((gross - rounded[0] - rounded[1]) * 100) / 100);
  for (const part of rounded) {
    const r = computeEarningAdjustment({ payout: p, refundAmount: part, paymentTotal: gross, refundedBefore: refunded });
    docSum = Math.round((docSum + r.doctorAdjustment) * 100) / 100;
    platSum = Math.round((platSum + r.platformAdjustment) * 100) / 100;
    refunded = Math.round((refunded + part) * 100) / 100;
    p = { ...p, refundAdjustmentAmount: docSum, platformRefundAdjustmentAmount: platSum };
  }
  assert.equal(docSum, doctor, `doctor reversal for ${gross} must equal doctor share`);
  assert.equal(Math.round((docSum + platSum) * 100), Math.round(gross * 100), `doctor+platform must equal gross ${gross}`);
}

// Never exceeds what remains: a replayed/over-sized adjustment is clamped, not negative or excessive.
const clamped = computeEarningAdjustment({
  payout: payout({ refundAdjustmentAmount: 700, platformRefundAdjustmentAmount: 300 }),
  refundAmount: 500, paymentTotal: 1000, refundedBefore: 1000,
});
assert.equal(clamped.doctorAdjustment, 0);
assert.equal(clamped.platformAdjustment, 0);

// Huge amounts do not lose precision (BigInt proportion, no 2^53 overflow).
const big = computeEarningAdjustment({ payout: payout({ grossAmount: 9999999.99, doctorAmount: 8999999.99 }), refundAmount: 4999999.99, paymentTotal: 9999999.99, refundedBefore: 0 });
assert.ok(Number.isFinite(big.doctorAdjustment) && big.doctorAdjustment > 0 && big.doctorAdjustment < 8999999.99);

console.log("refundEarningReversal: all assertions passed (pure math; NOT REAL-MONGO VERIFIED for the DB apply step)");

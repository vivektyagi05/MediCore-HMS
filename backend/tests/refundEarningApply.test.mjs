import assert from "node:assert/strict";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x";
process.env.JWT_SECRET ||= "testsecret-testsecret-testsecret-123";

// SIMULATION (NOT REAL-MONGO VERIFIED): model methods are replaced by an
// in-memory store that honours the filter/update operators the production code
// uses, so the apply algorithm (idempotency key, optimistic conditional update,
// retry on conflict, ledger postings) is exercised deterministically.
const { default: DoctorPayout } = await import("../models/DoctorPayout.js");
const { default: Doctor } = await import("../models/Doctor.js");
const { default: TransactionLedger } = await import("../models/TransactionLedger.js");
const { applyRefundToDoctorEarning } = await import("../payments/refundEarningAdjustment.js");

let store; let ledger; let hook;
const clone = (x) => JSON.parse(JSON.stringify(x));
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
  if (k === "refundAdjustments.refundKey") return !(doc.refundAdjustments || []).some((e) => e.refundKey === v.$ne);
  return doc[k] === v;
});
DoctorPayout.findOne = ({ paymentId }) => ({ lean: async () => { const d = store.find((x) => x.paymentId === paymentId); return d ? clone(d) : null; } });
DoctorPayout.findOneAndUpdate = async (filter, update) => {
  await Promise.resolve(); // yield: lets concurrent callers interleave between read and write
  if (hook) await hook();
  const doc = store.find((x) => matches(x, filter));
  if (!doc) return null;
  Object.assign(doc, update.$set || {});
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = Math.round(((doc[k] || 0) + v) * 100) / 100;
  for (const [k, v] of Object.entries(update.$push || {})) (doc[k] ||= []).push(v);
  return clone(doc);
};
Doctor.findById = () => ({ select: () => ({ lean: async () => ({ userId: "doc-user" }) }) });
TransactionLedger.create = async (entry) => {
  if (ledger.some((e) => e.idempotencyKey === entry.idempotencyKey)) throw Object.assign(new Error("dup"), { code: 11000 });
  ledger.push(entry);
};
const fresh = (over = {}) => {
  store = [{ _id: "po1", doctorId: "d1", paymentId: "pay1", grossAmount: 1000, doctorAmount: 700, platformFee: 300, status: "pending", refundAdjustmentAmount: 0, platformRefundAdjustmentAmount: 0, refundAdjustments: [], liabilityStatus: "none", ...over }];
  ledger = []; hook = null;
};
const apply = (o) => applyRefundToDoctorEarning({ paymentId: "pay1", paymentTotal: 1000, ...o });

// 1. Partial refund on a PENDING payout: stays pending (not cancelled), net shrinks.
fresh();
let r = await apply({ refundAmount: 400, refundedBefore: 0, refundKey: "gw:r1", gatewayRefundId: "r1" });
assert.equal(r.applied, true);
assert.equal(store[0].status, "pending", "a partial refund must not cancel the doctor's remaining earning");
assert.equal(store[0].refundAdjustmentAmount, 280);
assert.equal(store[0].platformRefundAdjustmentAmount, 120);
assert.equal(store[0].doctorAmount, 700, "original doctorAmount is immutable history");
assert.deepEqual(ledger.map((e) => [e.type, e.amount]), [["doctor_earning_reversal", 280], ["platform_fee_reversal", 120]]);

// 2. Replay of the SAME refund is a no-op (no second adjustment, no second ledger rows).
r = await apply({ refundAmount: 400, refundedBefore: 0, refundKey: "gw:r1", gatewayRefundId: "r1" });
assert.equal(r.replay, true);
assert.equal(store[0].refundAdjustmentAmount, 280);
assert.equal(ledger.length, 2);

// 3. Final refund takes the exact remainder and now cancels the payout.
r = await apply({ refundAmount: 600, refundedBefore: 400, refundKey: "gw:r2", gatewayRefundId: "r2" });
assert.equal(store[0].refundAdjustmentAmount, 700);
assert.equal(store[0].platformRefundAdjustmentAmount, 300);
assert.equal(store[0].status, "cancelled");
assert.equal(store[0].refundAdjustments.length, 2);
assert.equal(ledger.length, 4);

// 4. Concurrent duplicate of one refund (webhook + request path): exactly one wins.
fresh();
const results = await Promise.all([1, 2, 3].map(() => apply({ refundAmount: 400, refundedBefore: 0, refundKey: "gw:same" })));
assert.equal(results.filter((x) => x.applied).length, 1);
assert.equal(results.filter((x) => x.replay).length, 2);
assert.equal(store[0].refundAdjustmentAmount, 280);
assert.equal(ledger.length, 2);

// 5. SETTLED payout: reversal becomes a recoverable liability, nothing is mutated away.
fresh({ status: "paid" });
r = await apply({ refundAmount: 1000, refundedBefore: 0, refundKey: "gw:full" });
assert.equal(store[0].status, "paid");
assert.equal(store[0].liabilityStatus, "adjusted_pending");
assert.equal(store[0].refundAdjustmentAmount, 700);
assert.equal(r.becameLiability, true);

// 6. Settlement racing the adjustment (status flips between read and write): retried against fresh state.
fresh();
let injected = false;
hook = async () => { if (!injected) { injected = true; store[0].status = "paid"; } };
r = await apply({ refundAmount: 400, refundedBefore: 0, refundKey: "gw:race" });
assert.equal(r.applied, true);
assert.equal(store[0].liabilityStatus, "adjusted_pending", "after losing the race it must be recorded against the settled payout");
assert.equal(store[0].refundAdjustments.length, 1);

// 7. No payout (e.g. consultation never paid out): reported, not crashed.
store = []; ledger = [];
assert.deepEqual(await apply({ refundAmount: 1, refundedBefore: 0, refundKey: "gw:none" }), { applied: false, reason: "no_payout" });

console.log("refundEarningApply: all scenarios passed (SIMULATION — NOT REAL-MONGO VERIFIED)");

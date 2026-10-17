// Phase 03 REAL-MongoDB evidence: coupon reserve/redeem/release atomicity ($elemMatch + $pull + positional $set),
// refund-lock lease takeover + token fencing, email-outbox claim fencing, and the discrepancy report pipelines.
// Skipped unless MONGODB_TEST_URI points at a DISPOSABLE database whose name contains "test" (DROPPED at start):
//   MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase03_test node tests/mongo/phase03.mongo.test.mjs
// AUTHORED BUT NOT EXECUTED in the authoring sandbox (no mongod). Until it passes against a real server every
// Phase 03 concurrency claim is LOCALLY_VERIFIED at most (BLOCKED_EXTERNAL).
import assert from "node:assert/strict";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
if (!uri) { console.log("SKIP: set MONGODB_TEST_URI to run Phase 03 real-Mongo tests"); process.exit(0); }
if (!/test/i.test(new URL(uri).pathname)) { console.error("REFUSING: database name must contain 'test' (it is dropped)"); process.exit(1); }
process.env.MONGO_URI ||= uri; process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use"; process.env.NODE_ENV ||= "test";
await mongoose.connect(uri, { autoIndex: false });
await mongoose.connection.dropDatabase();

const { default: Coupon } = await import("../../models/Coupon.js");
const { default: Payment } = await import("../../models/Payment.js");
const { default: EmailDelivery } = await import("../../models/EmailDelivery.js");
const { couponService } = await import("../../payments/couponService.js");
const { acquireRefundLock, releaseRefundLock, REFUND_LOCK_LEASE_MS } = await import("../../payments/refundLock.js");
const { buildWalletLedgerDiscrepancyReport } = await import("../../services/finance/walletReconciliationService.js");

const oid = () => new mongoose.Types.ObjectId();
const check = async (name, fn) => { await fn(); console.log(`PASS: ${name}`); };
const newCoupon = (extra = {}) => Coupon.create({ code: `T${oid().toHexString().slice(-8)}`.toUpperCase(), type: "fixed", value: 50, expiresAt: new Date(Date.now() + 1e9), usageLimit: 5, ...extra });

await check("claim -> redeem: entry is redeemed, usedCount unchanged, redeemedCount 1", async () => {
  const coupon = await newCoupon(); const userId = oid(); const paymentId = oid();
  await couponService.claim({ coupon, userId, paymentId });
  const r = await couponService.redeem({ couponId: coupon._id, paymentId });
  assert.equal(r.redeemed, true);
  const row = await Coupon.findById(coupon._id).lean();
  assert.equal(row.usedCount, 1); assert.equal(row.redeemedCount, 1); assert.equal(row.usedBy[0].state, "redeemed");
});
await check("20 concurrent redeems of one payment increment redeemedCount exactly once", async () => {
  const coupon = await newCoupon(); const paymentId = oid();
  await couponService.claim({ coupon, userId: oid(), paymentId });
  await Promise.all(Array.from({ length: 20 }, () => couponService.redeem({ couponId: coupon._id, paymentId })));
  assert.equal((await Coupon.findById(coupon._id).lean()).redeemedCount, 1);
});
await check("a REDEEMED coupon can never be released", async () => {
  const coupon = await newCoupon(); const paymentId = oid();
  await couponService.claim({ coupon, userId: oid(), paymentId });
  await couponService.redeem({ couponId: coupon._id, paymentId });
  const r = await couponService.release({ couponId: coupon._id, paymentId });
  assert.equal(r.released, false);
  const row = await Coupon.findById(coupon._id).lean(); assert.equal(row.usedCount, 1); assert.equal(row.usedBy.length, 1);
});
await check("20 concurrent releases of a reservation decrement exactly once", async () => {
  const coupon = await newCoupon(); const paymentId = oid();
  await couponService.claim({ coupon, userId: oid(), paymentId });
  await Promise.all(Array.from({ length: 20 }, () => couponService.release({ couponId: coupon._id, paymentId })));
  const row = await Coupon.findById(coupon._id).lean(); assert.equal(row.usedCount, 0); assert.equal(row.releasedCount, 1);
});
await check("global usage limit holds under 30 concurrent claims for limit 5", async () => {
  const coupon = await newCoupon({ usageLimit: 5 });
  const res = await Promise.allSettled(Array.from({ length: 30 }, () => couponService.claim({ coupon, userId: oid(), paymentId: oid() })));
  assert.equal(res.filter((x) => x.status === "fulfilled" && x.value.claimed).length, 5);
  assert.equal((await Coupon.findById(coupon._id).lean()).usedCount, 5);
});

await check("refund lock: live lease blocks; expired lease is taken over; stale release cannot free the new holder", async () => {
  const payment = await Payment.collection.insertOne({ createdAt: new Date() });
  const id = payment.insertedId;
  const t1 = await acquireRefundLock(id);
  await assert.rejects(() => acquireRefundLock(id), /already in progress/);
  await Payment.collection.updateOne({ _id: id }, { $set: { refundLockedAt: new Date(Date.now() - REFUND_LOCK_LEASE_MS - 1000) } });
  const t2 = await acquireRefundLock(id);
  assert.notEqual(t1, t2);
  assert.equal((await releaseRefundLock(id, t1)).released, false, "ex-holder must not free the newer lock");
  assert.equal((await releaseRefundLock(id, t2)).released, true);
  const row = await Payment.collection.findOne({ _id: id }); assert.equal(row.refundLockedAt, undefined);
});
await check("10 concurrent acquires of one payment: exactly one wins", async () => {
  const id = (await Payment.collection.insertOne({ createdAt: new Date() })).insertedId;
  const r = await Promise.allSettled(Array.from({ length: 10 }, () => acquireRefundLock(id)));
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
});

await check("outbox: a reclaimed row's late outcome write (old claimToken) matches nothing", async () => {
  const row = await EmailDelivery.create({ eventKey: `k-${oid()}`, to: "a@example.com", subject: "s", html: "<p>x</p>", status: "sending", claimToken: "old-token", claimedAt: new Date() });
  await EmailDelivery.updateOne({ _id: row._id }, { $set: { status: "sending", claimToken: "new-token" } });
  const late = await EmailDelivery.updateOne({ _id: row._id, status: "sending", claimToken: "old-token" }, { $set: { status: "sent" } });
  assert.equal(late.modifiedCount, 0);
  assert.equal((await EmailDelivery.findById(row._id).lean()).status, "sending");
});

await check("discrepancy report: runs every category against real collections without writing", async () => {
  const before = await mongoose.connection.db.collection("reconciliationrecords").countDocuments().catch(() => 0);
  const report = await buildWalletLedgerDiscrepancyReport({ limit: 10 });
  assert.equal(report.readOnly, true);
  assert.ok(Object.keys(report.sections).length >= 6);
  const after = await mongoose.connection.db.collection("reconciliationrecords").countDocuments().catch(() => 0);
  assert.equal(after, before, "the report must not write reconciliation records");
});

await mongoose.disconnect();
console.log("ALL PHASE 03 REAL-MONGO CHECKS PASSED");

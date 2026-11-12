// Phase 03 completion: REAL couponService + recoverOrphanCouponReservations on the in-memory model layer
// (the atomic filters/updates the production code sends are evaluated, incl. $expr limit, $elemMatch, positional update, $pull).
// Not a real MongoDB test: tests/mongo covers index/atomicity behaviour (BLOCKED_EXTERNAL here).
import assert from "node:assert/strict";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x"; process.env.JWT_SECRET ||= "coupon-secret-coupon-secret-123456";
mongoose.set("bufferCommands", false);
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { default: Coupon } = await import("../models/Coupon.js");
const { default: Payment } = await import("../models/Payment.js");
const { couponService } = await import("../payments/couponService.js");
const { recoverOrphanCouponReservations, COUPON_ORPHAN_GRACE_MS } = await import("../payments/unpaidPaymentCleanup.js");
const mem = installMemoryModels([{ model: Coupon }, { model: Payment }]);
let n = 0;
const test = async (name, fn) => { mem.reset(); await fn(); n += 1; console.log(`PASS: ${name}`); };
const mk = (over = {}) => Coupon.create({ code: `C${newId()}`.slice(0, 12), type: "fixed", value: 50, expiresAt: new Date(Date.now() + 1e9), usageLimit: 1, ...over });
const row = async (c) => Coupon.findById(c._id).lean();
const old = new Date(Date.now() - COUPON_ORPHAN_GRACE_MS - 60000);

await test("global limit: N concurrent users, limit 1 => exactly one reservation", async () => {
  const c = await mk({ usageLimit: 1 });
  const out = await Promise.allSettled(Array.from({ length: 8 }, () => couponService.claim({ coupon: c, userId: newId(), paymentId: newId() })));
  assert.equal(out.filter((o) => o.status === "fulfilled").length, 1);
  for (const o of out.filter((x) => x.status === "rejected")) assert.equal(o.reason.details?.code ?? o.reason.code, "COUPON_LIMIT_REACHED");
  const r = await row(c); assert.equal(r.usedCount, 1); assert.equal(r.usedBy.length, 1); assert.equal(r.usedBy[0].state, "reserved");
  assert.ok(r.rejectedCount >= 1, "rejections are counted for the admin view");
});

await test("per-user limit and duplicate checkout/callback for the same payment are idempotent", async () => {
  const c = await mk({ usageLimit: 5 }); const user = newId(); const pay = newId();
  assert.deepEqual(await couponService.claim({ coupon: c, userId: user, paymentId: pay }), { claimed: true, alreadyClaimed: false });
  assert.deepEqual(await couponService.claim({ coupon: c, userId: user, paymentId: pay }), { claimed: false, alreadyClaimed: true }, "duplicate checkout");
  await assert.rejects(() => couponService.claim({ coupon: c, userId: user, paymentId: newId() }), (e) => (e.details?.code ?? e.code) === "COUPON_ALREADY_USED_BY_USER");
  assert.equal((await row(c)).usedCount, 1);
  const raced = await Promise.all([couponService.claim({ coupon: c, userId: newId(), paymentId: pay }).catch((e) => e)]);
  assert.ok(raced[0].alreadyClaimed || raced[0].statusCode, "a payment can never hold two reservations");
  assert.equal((await row(c)).usedBy.filter((e) => String(e.paymentId) === String(pay)).length, 1);
});

await test("user-bound and expired coupons are rejected with the right code", async () => {
  const owner = newId();
  const bound = await mk({ userId: owner, usageLimit: 5 });
  await assert.rejects(() => couponService.claim({ coupon: bound, userId: newId(), paymentId: newId() }), (e) => (e.details?.code ?? e.code) === "COUPON_WRONG_USER");
  assert.equal((await couponService.claim({ coupon: bound, userId: owner, paymentId: newId() })).claimed, true);
  const expired = await mk({ expiresAt: new Date(Date.now() - 1000), usageLimit: 5 });
  await assert.rejects(() => couponService.claim({ coupon: expired, userId: newId(), paymentId: newId() }), (e) => (e.details?.code ?? e.code) === "COUPON_EXPIRED");
  assert.equal((await row(expired)).usedCount, 0, "a rejected claim never consumes usage");
});

await test("reserve -> redeem is once-only; a redeemed entry can never be released (captured-payment protection)", async () => {
  const c = await mk({ usageLimit: 3 }); const user = newId(); const pay = newId();
  await couponService.claim({ coupon: c, userId: user, paymentId: pay });
  assert.equal((await couponService.redeem({ couponId: c._id, paymentId: pay })).redeemed, true);
  assert.equal((await couponService.redeem({ couponId: c._id, paymentId: pay })).redeemed, false, "replay does not double count");
  assert.deepEqual(await couponService.release({ couponId: c._id, paymentId: pay }), { released: false });
  const r = await row(c); assert.equal(r.redeemedCount, 1); assert.equal(r.usedCount, 1); assert.equal(r.usedBy[0].state, "redeemed");
  const m = await couponService.markUsed({ coupon: c, userId: user, paymentId: pay });
  assert.equal(m.redeemed, false); assert.equal((await row(c)).redeemedCount, 1, "capture re-run is a no-op");
});

await test("release frees a reservation exactly once (double release, concurrent release)", async () => {
  const c = await mk({ usageLimit: 3 }); const pay = newId();
  await couponService.claim({ coupon: c, userId: newId(), paymentId: pay });
  const both = await Promise.all([couponService.release({ couponId: c._id, paymentId: pay }), couponService.release({ couponId: c._id, paymentId: pay })]);
  assert.equal(both.filter((b) => b.released).length, 1);
  const r = await row(c); assert.equal(r.usedCount, 0); assert.equal(r.releasedCount, 1); assert.equal(r.usedBy.length, 0);
});

await test("legacy (state-less) entries are never released or reclassified", async () => {
  const pay = newId();
  const c = await mk({ usageLimit: 3, usedCount: 1, usedBy: [{ userId: newId(), paymentId: pay, usedAt: old }] });
  assert.deepEqual(await couponService.release({ couponId: c._id, paymentId: pay }), { released: false });
  const r = await row(c); assert.equal(r.usedCount, 1); assert.equal(r.usedBy[0].state, undefined, "still unclassified");
  assert.deepEqual(await recoverOrphanCouponReservations(), [], "recovery does not touch legacy entries either");
  assert.equal((await row(c)).usedCount, 1);
});

await test("abandoned reservation recovery: never-created and cancelled payments are released; captured/evidence/failed/fresh are not", async () => {
  const mkPay = (over) => Payment.create({ userId: newId(), doctorId: newId(), appointmentId: newId(), amount: 500, paymentId: `pay_${newId()}`, razorpayOrderId: `or_${newId()}`, totalAmount: 500, status: "created", ...over });
  const mkEntry = (paymentId, usedAt = old) => ({ userId: newId(), paymentId, usedAt, state: "reserved", reservedAt: usedAt });
  const never = newId(); const cancelled = await mkPay({ status: "cancelled" }); const expired = await mkPay({ status: "expired" });
  const captured = await mkPay({ status: "captured" }); const failed = await mkPay({ status: "failed" });
  const evid = await mkPay({ status: "cancelled", gatewayPaymentId: "pay_x" }); const fresh = newId();
  const entries = [mkEntry(never), mkEntry(cancelled._id), mkEntry(expired._id), mkEntry(captured._id), mkEntry(failed._id), mkEntry(evid._id), mkEntry(fresh, new Date())];
  const c = await mk({ usageLimit: 20, usedCount: entries.length, usedBy: entries });
  const out = await recoverOrphanCouponReservations();
  assert.deepEqual(out.map((o) => o.reason).sort(), ["payment_cancelled", "payment_expired", "payment_never_created"]);
  assert.ok(out.every((o) => o.released));
  const r = await row(c); assert.equal(r.usedCount, 4); assert.equal(r.releasedCount, 3);
  assert.deepEqual(r.usedBy.map((e) => String(e.paymentId)).sort(), [captured._id, failed._id, evid._id, fresh].map(String).sort());
  assert.deepEqual(await recoverOrphanCouponReservations(), [], "idempotent: a second sweep releases nothing more");
  assert.equal((await row(c)).usedCount, 4);
});

console.log(`\n${n} coupon lifecycle scenarios passed`);
process.exit(0);

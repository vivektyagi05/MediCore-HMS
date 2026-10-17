// Phase 02 REAL-MongoDB evidence: the wallet hold/commit/release atomic updates ($expr + $elemMatch +
// $pull + $push in ONE update), the unique reservation index, recharge credit marker, coupon claim.
// Skipped unless MONGODB_TEST_URI points at a DISPOSABLE database whose name contains "test" (DROPPED at start):
//   MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase02_test npm run test:mongo
// NOT EXECUTED in the authoring sandbox (no mongod). Until it passes against a real server every Phase 02
// claim is LOCALLY_VERIFIED only. Race tests loop to give real interleavings a chance.
import assert from "node:assert/strict";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
if (!uri) { console.log("SKIP: set MONGODB_TEST_URI to run Phase 02 real-Mongo tests"); process.exit(0); }
if (!/test/i.test(new URL(uri).pathname)) { console.error("REFUSING: database name must contain 'test' (it is dropped)"); process.exit(1); }
process.env.MONGO_URI ||= uri; process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use"; process.env.NODE_ENV ||= "test";
await mongoose.connect(uri, { autoIndex: false });
await mongoose.connection.dropDatabase();

const { default: Wallet } = await import("../../models/Wallet.js");
const { default: WalletReservation } = await import("../../models/WalletReservation.js");
const { default: WalletRecharge } = await import("../../models/WalletRecharge.js");
const { default: TransactionLedger } = await import("../../models/TransactionLedger.js");
const { default: Coupon } = await import("../../models/Coupon.js");
const { run: run011 } = await import("../../migrations/011_ensure_production_indexes.js");
const W = await import("../../payments/walletReservationService.js");
const R = await import("../../payments/walletRechargeService.js");
const { couponService } = await import("../../payments/couponService.js");

const oid = () => new mongoose.Types.ObjectId();
const check = async (name, fn) => { await fn(); console.log(`PASS: ${name}`); };
const quiet = { log() {}, error() {} };
assert.equal(await run011({ argv: [], out: quiet }), 0, "011 must build every declared index");

await check("migration 011 creates the unique reservation index (verified from real index metadata)", async () => {
  const idx = await WalletReservation.collection.indexes();
  assert.ok(idx.some((i) => i.unique && i.key.paymentId === 1));
});
await check("20 concurrent reservations of 60 against balance 100 hold exactly one", async () => {
  const userId = oid(); await Wallet.create({ userId, balance: 100 });
  const r = await Promise.allSettled(Array.from({ length: 20 }, () => W.reserveWalletFunds({ userId, paymentId: oid(), amount: 60 })));
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await Wallet.findOne({ userId })).holds.length, 1);
});
await check("duplicate concurrent reserve for ONE payment creates one reservation and one hold", async () => {
  const userId = oid(); const paymentId = oid(); await Wallet.create({ userId, balance: 100 });
  await Promise.all(Array.from({ length: 10 }, () => W.reserveWalletFunds({ userId, paymentId, amount: 30 })));
  assert.equal(await WalletReservation.countDocuments({ paymentId }), 1);
  assert.equal((await Wallet.findOne({ userId })).holds.length, 1);
});
await check("commit vs release race: exactly one wins, balance moves at most once", async () => {
  for (let i = 0; i < 25; i += 1) {
    const userId = oid(); const paymentId = oid(); await Wallet.create({ userId, balance: 100 });
    await W.reserveWalletFunds({ userId, paymentId, amount: 40 });
    await Promise.allSettled([W.commitWalletReservation({ paymentId }), W.releaseWalletReservation({ paymentId })]);
    const w = await Wallet.findOne({ userId }); const r = await WalletReservation.findOne({ paymentId });
    assert.equal(w.holds.length, 0);
    assert.ok((r.status === "committed" && w.balance === 60) || (r.status === "released" && w.balance === 100), `${r.status}/${w.balance}`);
  }
});
await check("concurrent duplicate commits debit once", async () => {
  const userId = oid(); const paymentId = oid(); await Wallet.create({ userId, balance: 100 });
  await W.reserveWalletFunds({ userId, paymentId, amount: 40 });
  await Promise.all(Array.from({ length: 10 }, () => W.commitWalletReservation({ paymentId })));
  const w = await Wallet.findOne({ userId }); assert.equal(w.balance, 60); assert.equal(w.transactions.length, 1);
});
await check("recharge: concurrent credit attempts credit once; ledger row unique", async () => {
  const userId = oid(); await Wallet.create({ userId, balance: 0 });
  const recharge = await WalletRecharge.create({ userId, amount: 500, currency: "INR", gatewayOrderId: `order_${oid()}`, status: "order_created" });
  await Promise.all(Array.from({ length: 10 }, () => R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" })));
  assert.equal((await Wallet.findOne({ userId })).balance, 500);
  assert.equal(await TransactionLedger.countDocuments({ idempotencyKey: R.rechargeLedgerKey(recharge._id) }), 1);
});
await check("coupon: many users racing for the last use; one wins", async () => {
  const coupon = await Coupon.create({ code: `T${Date.now()}`, type: "fixed", value: 10, expiresAt: new Date(Date.now() + 1e9), usageLimit: 1, usedCount: 0, usedBy: [] });
  const claims = await Promise.allSettled(Array.from({ length: 15 }, () => couponService.claim({ coupon, userId: oid(), paymentId: oid() })));
  const row = await Coupon.findById(coupon._id);
  assert.equal(row.usedCount, 1); assert.equal(claims.filter((c) => c.status === "fulfilled" && c.value.claimed).length, 1);
});
await mongoose.disconnect();
console.log("phase02 mongo: done");

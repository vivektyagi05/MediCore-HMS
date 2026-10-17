// REAL-MongoDB concurrency tests (F-019). They are skipped unless MONGODB_TEST_URI
// points at a DISPOSABLE database; they create and drop their own collections'
// documents. Run:  MONGODB_TEST_URI=mongodb://localhost:27017/hms_fin_test npm run test:mongo
import assert from "assert";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
if (!uri) {
  console.log("SKIP: set MONGODB_TEST_URI to run real-Mongo concurrency tests");
  process.exit(0);
}
process.env.MONGO_URI ||= uri;
process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use";
process.env.NODE_ENV ||= "test";
process.env.PAYMENT_GATEWAY_MODE ||= "test";

await mongoose.connect(uri);
const { default: Coupon } = await import("../../models/Coupon.js");
const { default: Payment } = await import("../../models/Payment.js");
const { default: Invoice } = await import("../../models/Invoice.js");
const { default: Subscription } = await import("../../models/Subscription.js");
const { couponService } = await import("../../payments/couponService.js");
const { paymentRetryService } = await import("../../payments/paymentRetryService.js");
const { subscriptionService } = await import("../../payments/subscriptionService.js");
await Promise.all([Coupon.init(), Invoice.init(), Subscription.init()]);

const oid = () => new mongoose.Types.ObjectId();
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS: ${name}`); };

await check("F-005 coupon: 25 concurrent users, limit 5 -> exactly 5 claims, usedCount 5", async () => {
  const coupon = await Coupon.create({ code: `CONC${Date.now()}`, type: "fixed", value: 10, expiresAt: new Date(Date.now() + 864e5), usageLimit: 5 });
  const outcomes = await Promise.allSettled(Array.from({ length: 25 }, () => couponService.claim({ coupon, userId: oid(), paymentId: oid() })));
  assert.strictEqual(outcomes.filter((o) => o.status === "fulfilled" && o.value.claimed).length, 5);
  assert.strictEqual((await Coupon.findById(coupon._id)).usedCount, 5);
});

await check("F-005 coupon: same payment claimed twice is idempotent; release twice decrements once", async () => {
  const coupon = await Coupon.create({ code: `IDEM${Date.now()}`, type: "fixed", value: 10, expiresAt: new Date(Date.now() + 864e5), usageLimit: 3 });
  const userId = oid(); const paymentId = oid();
  await couponService.claim({ coupon, userId, paymentId });
  assert.strictEqual((await couponService.claim({ coupon, userId, paymentId })).alreadyClaimed, true);
  await Promise.all([couponService.release({ couponId: coupon._id, paymentId }), couponService.release({ couponId: coupon._id, paymentId })]);
  assert.strictEqual((await Coupon.findById(coupon._id)).usedCount, 0);
});

await check("F-006 retry: 10 concurrent claimRetry on one failed payment -> exactly one winner", async () => {
  const payment = await Payment.create({ appointmentId: oid(), userId: oid(), doctorId: oid(), amount: 100, totalAmount: 100, currency: "INR", razorpayOrderId: `order_test_${oid()}`,status: "failed", paymentState: "failed", idempotencyKey: `k${Date.now()}` });
  const claims = await Promise.all(Array.from({ length: 10 }, () => paymentRetryService.claimRetry(payment._id)));
  assert.strictEqual(claims.filter(Boolean).length, 1);
});

await check("F-008 invoice: duplicate paymentId rejected by unique index", async () => {
  const paymentId = oid();
  const doc = { paymentId, appointmentId: oid(), userId: oid(), doctorId: oid(), hospital: {}, patient: { name: "p" }, doctor: { name: "d" }, lineItems: [], subtotal: 1, totalAmount: 1 };
  await Invoice.create({ ...doc, invoiceNumber: `INV-A-${Date.now()}` });
  await assert.rejects(Invoice.create({ ...doc, invoiceNumber: `INV-B-${Date.now()}` }), (e) => e.code === 11000);
});

await check("F-001 subscription: 10 concurrent captures activate once and extend the period once", async () => {
  const sub = await Subscription.create({ userId: oid(), planCode: "doctor_premium_monthly", planName: "x", interval: "monthly", amount: 2999, status: "pending_payment", gatewayOrderId: `o_${Date.now()}`, paymentHistory: [{ kind: "initial", gatewayOrderId: `o_${Date.now()}`, amount: 2999 }] });
  await Subscription.updateOne({ _id: sub._id }, { $set: { "paymentHistory.0.gatewayOrderId": sub.gatewayOrderId } });
  const outcomes = await Promise.all(Array.from({ length: 10 }, () => subscriptionService.activateFromCapture({ subscription: sub, gatewayPaymentId: "pay_1", source: "test" })));
  assert.strictEqual(outcomes.filter((o) => o.activated).length, 1);
  assert.strictEqual((await Subscription.findById(sub._id)).status, "active");
});

const { default: DoctorPayout } = await import("../../models/DoctorPayout.js");
const { default: Withdrawal } = await import("../../models/Withdrawal.js");
const { reserveWithdrawal, reconcileWithdrawalGate, releaseBalance } = await import("../../services/finance/withdrawalService.js");

await check("F-014 withdrawal: 10 concurrent requests of 300 against 1000 settled -> exactly 3 reserve, gate reconciles", async () => {
  const doctorId = oid();
  await DoctorPayout.collection.insertOne({ doctorId, paymentId: oid(), appointmentId: oid(), status: "paid", grossAmount: 1000, doctorAmount: 1000, platformFee: 0, createdAt: new Date(), updatedAt: new Date() });
  const outcomes = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserveWithdrawal({ doctorId, requestedAmount: 300, destinationLabel: "acct", requestedBy: oid(), idempotencyKey: `wd-${doctorId}-${i}` })));
  assert.strictEqual(outcomes.filter((o) => o.status === "fulfilled").length, 3);
  const report = await reconcileWithdrawalGate(doctorId);
  assert.ok(report.ok, JSON.stringify(report));
  assert.strictEqual(await Withdrawal.countDocuments({ doctorId, reservationHeld: true }), 3);
  // releasing one frees exactly its amount
  const one = await Withdrawal.findOne({ doctorId });
  await Withdrawal.updateOne({ _id: one._id }, { $set: { status: "cancelled", reservationHeld: false } });
  await releaseBalance(doctorId, 30000);
  assert.ok((await reconcileWithdrawalGate(doctorId)).ok);
});

console.log(`${results.length} real-Mongo checks passed`);
await mongoose.disconnect();
process.exit(0);

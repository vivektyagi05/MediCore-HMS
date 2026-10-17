// Phase 02 -- coupon reservation recovery, unpaid-payment release safety, wallet-only crash recovery.
// LOCALLY_VERIFIED: in-memory model layer + in-memory wallet store. NOT real MongoDB (see tests/mongo/phase02.mongo.test.mjs).
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused";
process.env.JWT_SECRET ||= "phase02-test-secret";
mongoose.set("bufferCommands", false);

const { default: Payment } = await import("../models/Payment.js");
const { default: PaymentAttempt } = await import("../models/PaymentAttempt.js");
const { default: Appointment } = await import("../models/Appointment.js");
const { default: Coupon } = await import("../models/Coupon.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { createMemoryStore, injectFailure } = await import("./helpers/walletMemoryStore.mjs");
const W = await import("../payments/walletReservationService.js");
const C = await import("../payments/unpaidPaymentCleanup.js");
const O = await import("../payments/walletOnlyRecovery.js");
const { paymentDeps } = await import("../payments/paymentDeps.js");

const mem = installMemoryModels([
  { model: Payment, unique: [{ fields: ["razorpayOrderId"] }] },
  { model: PaymentAttempt },
  { model: Appointment },
  { model: Coupon },
]);
let n = 0; let seq = 0;
const old = new Date(Date.now() - 3 * 3600_000);
const check = async (name, fn) => { mem.reset(); W.walletReservationDeps.store = createMemoryStore({ balances: {} }); await fn(W.walletReservationDeps.store); console.log(`  ok   ${name}`); n += 1; };
const mkAppointment = (status = "payment_pending", over = {}) => Appointment.create({ status, paymentStatus: "pending", timeSlot: "10:00", date: new Date(Date.now() + 86400000), doctorId: newId(), patientId: newId(), ...over });
const mkPayment = async ({ appointment, userId = newId(), state = "pending", walletAmount = 0, couponId, ...over }) => Payment.create({
  appointmentId: appointment._id, doctorId: newId(), userId, totalAmount: 590, amount: 500, walletAmount, couponId, currency: "INR", status: state === "pending" ? "created" : state, paymentState: state,
  razorpayOrderId: `order_${++seq}`, gatewayOrderId: `order_${++seq}`, activeAppointmentSlot: true, createdAt: old, updatedAt: old, ...over,
});
const mkCoupon = (entries = []) => Coupon.create({ code: `C${++seq}`, type: "fixed", value: 50, expiresAt: new Date(Date.now() + 1e9), usageLimit: 5, usedCount: entries.length, usedBy: entries });
const hold = async (payment, store) => { await store.ensureWallet(payment.userId); store.wallets.get(String(payment.userId)).balance = 1000; return W.reserveWalletFunds({ userId: payment.userId, paymentId: payment._id, amount: payment.walletAmount }); };

// ------------------------------------------------------------------ coupons
await check("orphan coupon reservation (crash before Payment.create) is released exactly once; repeats never double-decrement", async () => {
  const pid = newId();
  const coupon = await mkCoupon([{ userId: newId(), paymentId: pid, usedAt: old }]);
  const first = await C.recoverOrphanCouponReservations();
  assert.equal(first.length, 1); assert.equal(first[0].released, true);
  const again = await C.recoverOrphanCouponReservations();
  assert.equal(again.length, 0);
  const row = await Coupon.findById(coupon._id).lean();
  assert.equal(row.usedCount, 0); assert.equal(row.usedBy.length, 0);
});
await check("a coupon reservation that HAS a payment, or is still within the grace period, is left alone", async () => {
  const appointment = await mkAppointment();
  const payment = await mkPayment({ appointment });
  const coupon = await mkCoupon([{ userId: newId(), paymentId: payment._id, usedAt: old }, { userId: newId(), paymentId: newId(), usedAt: new Date() }]);
  assert.equal((await C.recoverOrphanCouponReservations()).length, 0);
  assert.equal((await Coupon.findById(coupon._id).lean()).usedCount, 2);
});
await check("release is idempotent: double release decrements once", async () => {
  const pid = newId(); const coupon = await mkCoupon([{ userId: newId(), paymentId: pid, usedAt: old }]);
  const { couponService } = await import("../payments/couponService.js");
  assert.equal((await couponService.release({ couponId: coupon._id, paymentId: pid })).released, true);
  assert.equal((await couponService.release({ couponId: coupon._id, paymentId: pid })).released, false);
  assert.equal((await Coupon.findById(coupon._id).lean()).usedCount, 0);
});

// ------------------------------------------------------- release safety / sweep
await check("unpaid payment of a cancelled appointment: cancelled, coupon and wallet hold released", async (store) => {
  const appointment = await mkAppointment("cancelled");
  const pid = newId();
  const coupon = await mkCoupon([]);
  const payment = await mkPayment({ appointment, walletAmount: 40, couponId: coupon._id, _id: pid });
  await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 }, $push: { usedBy: { userId: payment.userId, paymentId: pid, usedAt: old } } });
  await hold(payment, store);
  assert.equal((await C.cancelAndReleaseUnpaidPayment(payment, { reason: "test" })), "released");
  assert.equal((await Payment.findById(pid).lean()).paymentState, "cancelled");
  assert.equal((await Coupon.findById(coupon._id).lean()).usedCount, 0);
  assert.equal(store.wallets.get(String(payment.userId)).holds.length, 0);
  assert.equal(store.wallets.get(String(payment.userId)).balance, 1000, "release never debits");
  assert.equal(await C.cancelAndReleaseUnpaidPayment(payment, { reason: "again" }), "released", "replay is harmless");
  assert.equal((await Coupon.findById(coupon._id).lean()).usedCount, 0);
});
await check("a payment with provider evidence (payment id / reconciliation flag / capture evidence) is NEVER released", async (store) => {
  for (const over of [{ gatewayPaymentId: "pay_1" }, { reconciliationState: "required" }, { captureEvidence: [{ gatewayPaymentId: "pay_x", disposition: "duplicate_capture" }] }]) {
    const appointment = await mkAppointment("cancelled");
    const payment = await mkPayment({ appointment, walletAmount: 40, ...over });
    await hold(payment, store);
    const outcome = await C.cancelAndReleaseUnpaidPayment(payment, { reason: "test" });
    assert.equal(outcome, "skipped_provider_evidence", JSON.stringify(over));
    assert.equal(store.wallets.get(String(payment.userId)).holds.length, 1);
  }
});
await check("ambiguous in-flight states (authorized / verification_pending) are never cancelled by cleanup", async (store) => {
  for (const state of ["authorized", "verification_pending"]) {
    const appointment = await mkAppointment("cancelled");
    const payment = await mkPayment({ appointment, state, walletAmount: 40 });
    await hold(payment, store);
    const outcome = await C.cancelAndReleaseUnpaidPayment(payment, { reason: "test" });
    assert.ok(outcome.startsWith("skipped"), `${state}: ${outcome}`);
    assert.equal(store.wallets.get(String(payment.userId)).holds.length, 1);
  }
});
await check("sweep: only payments of unpayable appointments are released; a payable appointment keeps its hold", async (store) => {
  const dead = await mkPayment({ appointment: await mkAppointment("cancelled"), walletAmount: 30 });
  const live = await mkPayment({ appointment: await mkAppointment("payment_pending"), walletAmount: 30 });
  await hold(dead, store); await hold(live, store);
  const out = await C.sweepUnpayablePayments();
  assert.deepEqual(out.map((r) => r.outcome), ["released"]);
  assert.equal(store.wallets.get(String(dead.userId)).holds.length, 0);
  assert.equal(store.wallets.get(String(live.userId)).holds.length, 1);
});

// ------------------------------------------------------------ wallet-only crash recovery
const postProcessed = [];
paymentDeps.postProcess = async (payment) => { postProcessed.push(String(payment._id)); return { completedNow: true }; };
const walletOnly = async (store, { appointmentStatus = "payment_pending", reserve = true } = {}) => {
  const appointment = await mkAppointment(appointmentStatus);
  const pid = newId();
  const payment = await mkPayment({ appointment, walletAmount: 590, _id: pid, razorpayOrderId: `wallet_${pid}`, gatewayOrderId: `wallet_${pid}` });
  await PaymentAttempt.create({ paymentId: pid, attemptNumber: 1, gateway: "internal_wallet", gatewayOrderId: `wallet_${pid}`, status: "checkout_started", amount: 0, currency: "INR" });
  if (reserve) await hold(payment, store);
  return { payment, store };
};
await check("crash after reservation (before wallet commit): recovery commits once and completes the payment", async (store) => {
  postProcessed.length = 0;
  const { payment } = await walletOnly(store);
  const out = await O.recoverWalletOnlyPayments();
  assert.equal(out[0].action, "completed");
  const w = store.wallets.get(String(payment.userId));
  assert.equal(w.balance, 410); assert.equal(w.transactions.length, 1);
  assert.equal((await Payment.findById(payment._id).lean()).paymentState, "captured");
  assert.deepEqual(postProcessed, [String(payment._id)]);
});
await check("crash after wallet commit (before capture claim): recovery completes WITHOUT a second debit; replay is a no-op", async (store) => {
  postProcessed.length = 0;
  const { payment } = await walletOnly(store);
  await W.commitWalletReservation({ paymentId: payment._id });
  await O.recoverWalletOnlyPayments();
  await O.recoverWalletOnlyPayments(); // second pass: payment is now captured
  const w = store.wallets.get(String(payment.userId));
  assert.equal(w.balance, 410); assert.equal(w.transactions.length, 1);
  assert.equal(postProcessed.length, 1, "appointment fulfilment runs once");
});
await check("crash after capture claim (before appointment completion) is left to post-processing recovery, never re-debited", async (store) => {
  const { payment } = await walletOnly(store);
  await W.commitWalletReservation({ paymentId: payment._id });
  await Payment.updateOne({ _id: payment._id }, { $set: { paymentState: "captured", status: "captured" } });
  assert.equal((await O.recoverWalletOnlyPayments()).length, 0);
  assert.equal(store.wallets.get(String(payment.userId)).balance, 410);
});
await check("appointment no longer payable and nothing debited: payment cancelled and hold released (no gateway involved)", async (store) => {
  postProcessed.length = 0;
  const { payment } = await walletOnly(store, { appointmentStatus: "cancelled" });
  const out = await O.recoverWalletOnlyPayments();
  assert.equal(out[0].action, "cancelled_and_released");
  assert.equal(store.wallets.get(String(payment.userId)).balance, 1000);
  assert.equal(store.wallets.get(String(payment.userId)).holds.length, 0);
  assert.equal(postProcessed.length, 0);
});
await check("wallet commit failure injected mid-recovery: retried next pass without duplicating the debit", async (store) => {
  const { payment } = await walletOnly(store);
  const undo = injectFailure(store, "commitHold", { phase: "after" });
  const first = await O.recoverWalletOnlyPayments();
  assert.equal(first[0].action, "error");
  undo();
  const second = await O.recoverWalletOnlyPayments();
  assert.equal(second[0].action, "completed");
  assert.equal(store.wallets.get(String(payment.userId)).balance, 410); assert.equal(store.wallets.get(String(payment.userId)).transactions.length, 1);
});
await check("wallet-only payments never involve a gateway: no placeholder-order payment is picked up by order recovery", async (store) => {
  const { payment } = await walletOnly(store);
  const attempts = await PaymentAttempt.find({ paymentId: payment._id }).lean();
  assert.ok(attempts.every((a) => a.gateway === "internal_wallet" && a.amount === 0));
});
console.log(`phase02Recovery: ${n} checks passed (LOCALLY_VERIFIED; in-memory layers, NOT real MongoDB)`);
process.exit(0);

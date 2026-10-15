// Phase 01 REAL-MongoDB evidence: unique indexes, compare-and-set transitions,
// retry-claim and webhook-dedupe races, migration 012. Skipped unless
// MONGODB_TEST_URI points at a DISPOSABLE database whose name contains "test"
// (it is DROPPED at start):
//   MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase01_test npm run test:mongo
//
// NOT EXECUTED in the authoring sandbox (no mongod; mongodb-memory-server's
// binary download is blocked). Every Phase 01 claim is therefore only
// LOCALLY_VERIFIED (tests/phase01PaymentCore.test.mjs) until this file passes
// against a real server. Race tests loop to give real interleavings a chance.
import assert from "node:assert/strict";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
if (!uri) { console.log("SKIP: set MONGODB_TEST_URI to run Phase 01 real-Mongo tests"); process.exit(0); }
if (!/test/i.test(new URL(uri).pathname)) { console.error("REFUSING: database name in MONGODB_TEST_URI must contain 'test' (it is dropped)"); process.exit(1); }
process.env.MONGO_URI ||= uri;
process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use";
process.env.NODE_ENV ||= "test";

await mongoose.connect(uri, { autoIndex: false });
await mongoose.connection.dropDatabase();

const { default: Payment } = await import("../../models/Payment.js");
const { default: PaymentAttempt } = await import("../../models/PaymentAttempt.js");
const { default: WebhookEvent } = await import("../../models/WebhookEvent.js");
const T = await import("../../payments/paymentTransitions.js");
const { claimPaymentCapture } = await import("../../payments/paymentCapture.js");
const { paymentRetryService } = await import("../../payments/paymentRetryService.js");
const { reserveAttempt } = await import("../../payments/paymentAttemptService.js");
const { paymentGateway } = await import("../../payments/paymentGateway.js");
const M012 = await import("../../migrations/012_payment_active_slot.js");
const { run: run011 } = await import("../../migrations/011_ensure_production_indexes.js");

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;
const mk = (over = {}) => Payment.create({ appointmentId: oid(), userId: oid(), doctorId: oid(), amount: 500, totalAmount: 590, gatewayAmount: 590, currency: "INR", status: "pending", paymentState: "pending", razorpayOrderId: `o_${++seq}_${Date.now()}`, idempotencyKey: `k-${seq}-${Date.now()}-${Math.random()}`, ...over });
const check = async (name, fn) => { await fn(); console.log(`PASS: ${name}`); };
const quiet = { log() {}, error() {} };

await check("migration 011 builds the Phase 01 indexes (unique active-slot, attempt keys, webhook eventId)", async () => {
  assert.equal(await run011({ argv: [], out: quiet }), 0);
  const idx = await Payment.collection.indexes();
  const slot = idx.find((i) => i.name === "uniq_payment_active_appointment");
  assert.ok(slot && slot.unique && slot.partialFilterExpression?.activeAppointmentSlot === true);
});

await check("concurrent creates for one appointment: the partial unique index lets exactly one win", async () => {
  for (let round = 0; round < 20; round += 1) {
    const appointmentId = oid();
    const settled = await Promise.allSettled([1, 2, 3, 4, 5].map(() => mk({ appointmentId, activeAppointmentSlot: true })));
    assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
    assert.ok(settled.filter((s) => s.status === "rejected").every((s) => s.reason.code === 11000));
  }
});

await check("a released slot lets a new payment be created; other appointments are unaffected", async () => {
  const appointmentId = oid();
  const p = await mk({ appointmentId, activeAppointmentSlot: true });
  await T.transitionPayment({ paymentId: p._id, to: "cancelled", status: "cancelled", source: "test" });
  await mk({ appointmentId, activeAppointmentSlot: true });
});

await check("attempt numbering is unique under concurrency (unique paymentId+attemptNumber)", async () => {
  const p = await mk({ activeAppointmentSlot: true });
  const reserved = await Promise.all(Array.from({ length: 8 }, () => reserveAttempt({ payment: p, gateway: "razorpay" })));
  assert.deepEqual(reserved.map((r) => r.attemptNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

await check("capture vs failure race (200 rounds): a captured payment is never downgraded", async () => {
  for (let i = 0; i < 200; i += 1) {
    const p = await mk();
    const [cap, fail] = await Promise.all([
      claimPaymentCapture({ payment: p, gatewayPaymentId: `pay_${i}`, source: "test", reason: "race" }),
      T.transitionPayment({ paymentId: p._id, to: "failed", status: "failed", from: T.PRE_CAPTURE_STATES, source: "test" }),
    ]);
    const row = await Payment.findById(p._id).lean();
    if (cap.won) { assert.equal(row.status, "captured"); assert.notEqual(row.paymentState, "failed"); }
    else { assert.equal(row.status, "failed"); } // failure won first; a later capture is still claimable
    void fail;
  }
});

await check("concurrent capture claims: exactly one wins and history shows one captured transition", async () => {
  for (let i = 0; i < 50; i += 1) {
    const p = await mk();
    const claims = await Promise.all([1, 2, 3].map(() => claimPaymentCapture({ payment: p, gatewayPaymentId: "pay_same", source: "test", reason: "dup" })));
    assert.equal(claims.filter((c) => c.won).length, 1);
    const row = await Payment.findById(p._id).lean();
    assert.equal(row.stateHistory.filter((h) => h.to === "captured").length, 1);
  }
});

await check("retry claim: concurrent cron/admin/webhook/patient workers create exactly one order", async () => {
  let n = 0; let calls = 0;
  paymentGateway.mode = () => "razorpay";
  paymentGateway.createOrder = async (a) => { calls += 1; return { id: `order_real_${Date.now()}_${++n}`, amount: Math.round(a.amount * 100), currency: a.currency, receipt: a.receipt }; };
  for (let i = 0; i < 20; i += 1) {
    calls = 0;
    const p = await mk({ status: "failed", paymentState: "failed", activeAppointmentSlot: true });
    const out = await Promise.all(["cron", "admin", "webhook", "patient"].map((source) => paymentRetryService.scheduleFailedPayment(p._id, { source, allowExpired: true })));
    assert.equal(out.filter(Boolean).length, 1); assert.equal(calls, 1);
    assert.equal((await PaymentAttempt.countDocuments({ paymentId: p._id })), 1);
  }
});

await check("webhook event id is a real unique key: concurrent inserts store one row", async () => {
  const mkEvent = () => WebhookEvent.create({ eventId: "rzp:evt_real", eventType: "payment.captured", payload: {}, signature: "x" });
  const settled = await Promise.allSettled([mkEvent(), mkEvent(), mkEvent()]);
  assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
  assert.ok(settled.filter((s) => s.status === "rejected").every((s) => s.reason.code === 11000));
});

await check("migration 012 stops on legacy duplicates without writing, then backfills clean data", async () => {
  await Payment.collection.drop().catch(() => {});
  await Payment.createCollection();
  const appt = oid();
  await Payment.collection.insertMany([
    { appointmentId: appt, userId: oid(), doctorId: oid(), amount: 1, totalAmount: 1, razorpayOrderId: "leg_1", status: "pending", currency: "INR" },
    { appointmentId: appt, userId: oid(), doctorId: oid(), amount: 1, totalAmount: 1, razorpayOrderId: "leg_2", status: "captured", currency: "INR" },
    { appointmentId: oid(), userId: oid(), doctorId: oid(), amount: 1, totalAmount: 1, razorpayOrderId: "leg_3", status: "pending", currency: "INR" },
  ]);
  assert.equal(await M012.run({ argv: [], out: quiet }), 2);
  assert.equal(await Payment.collection.countDocuments({ activeAppointmentSlot: true }), 0, "nothing written while blocked");
  await Payment.collection.deleteOne({ razorpayOrderId: "leg_2" }); // operator resolves the duplicate manually
  assert.equal(await M012.run({ argv: [], out: quiet }), 0);
  assert.equal(await Payment.collection.countDocuments({ activeAppointmentSlot: true }), 2);
  assert.equal(await run011({ argv: [], out: quiet }), 0, "011 can now build the unique index");
});

await mongoose.disconnect();
console.log("phase01.mongo: all checks passed against a real MongoDB");

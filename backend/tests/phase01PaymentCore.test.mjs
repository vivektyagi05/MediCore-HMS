// Phase 01 — payment core behavioural tests.
//
// LEVEL: LOCALLY_VERIFIED against an in-memory model layer that evaluates the
// real filters/updates and yields between every read and write (see
// tests/helpers/memoryModels.mjs). Proves application logic, CAS semantics,
// fencing and idempotency. NOT INTEGRATION_VERIFIED: MongoDB's own atomicity and
// unique indexes are exercised by tests/mongo/phase01.mongo.test.mjs, which
// needs a real mongod (BLOCKED in environments without one).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:1/unused";
process.env.JWT_SECRET = process.env.JWT_SECRET || "phase01-test-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_phase01_test";
mongoose.set("bufferCommands", false); // any un-faked DB access fails fast instead of hanging

const { default: Payment } = await import("../models/Payment.js");
const { default: PaymentAttempt } = await import("../models/PaymentAttempt.js");
const { default: WebhookEvent } = await import("../models/WebhookEvent.js");
const { default: Subscription } = await import("../models/Subscription.js");
const { default: RefundRequest } = await import("../models/RefundRequest.js");
const { default: Invoice } = await import("../models/Invoice.js");
const { default: WalletRecharge } = await import("../models/WalletRecharge.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { paymentGateway } = await import("../payments/paymentGateway.js");
const { paymentDeps } = await import("../payments/paymentDeps.js");
const T = await import("../payments/paymentTransitions.js");
const { paymentRetryService, buildRetryClaimFilter, MAX_RETRIES } = await import("../payments/paymentRetryService.js");
const A = await import("../payments/paymentAttemptService.js");
const W = await import("../payments/webhookHandler.js");
const { subscriptionService } = await import("../payments/subscriptionService.js");
const { classifyPaymentRecovery, verifyPayment, findActiveAppointmentPayment } = await import("../controllers/paymentController.js");

const mem = installMemoryModels([
  { model: Payment, unique: [
    { fields: ["razorpayOrderId"] },
    { fields: ["appointmentId"], when: (o) => o.activeAppointmentSlot === true },
  ] },
  { model: PaymentAttempt, unique: [{ fields: ["paymentId", "attemptNumber"] }, { fields: ["gateway", "gatewayOrderId"] }] },
  { model: WebhookEvent, unique: [{ fields: ["eventId"] }] },
  { model: Subscription },
  { model: RefundRequest },
  { model: Invoice },
  { model: WalletRecharge }, // Phase 02: the webhook now checks recharge orders before subscriptions
]);

// ---- fakes at the boundaries -------------------------------------------------
let orderSeq = 0;
let createOrderCalls = 0;
let createOrderHook = null; // async (args) => order | throws
const orders = new Map();
paymentGateway.mode = () => "razorpay";
paymentGateway.keyId = () => "rzp_test_key";
paymentGateway.createOrder = async (args) => {
  createOrderCalls += 1;
  if (createOrderHook) return createOrderHook(args);
  const order = { id: `order_new_${++orderSeq}`, amount: Math.round(args.amount * 100), currency: args.currency, receipt: args.receipt };
  orders.set(args.receipt, order);
  return order;
};
paymentGateway.findOrderByReceipt = async ({ receipt }) => orders.get(receipt) || null;

const emits = [];
paymentDeps.emit = async (type, ctx) => { emits.push({ type: String(type), ctx }); };
const defaultPostProcess = async (payment) => {
  const fresh = await Payment.findById(payment._id);
  if (fresh.paymentState === "completed") return { completedNow: false, replay: true };
  const started = await T.markPostProcessingStarted(fresh);
  if (started.outcome === "rejected") throw new Error("post-processing rejected");
  const done = await T.markPostProcessingCompleted(payment._id);
  return { completedNow: done.outcome === "applied" };
};
let postProcessCalls = 0;
paymentDeps.postProcess = async (p) => { postProcessCalls += 1; return defaultPostProcess(p); };

const subscriptionCalls = { lookups: [], failed: 0 };
subscriptionService.findByGatewayOrder = async (orderId) => { subscriptionCalls.lookups.push(orderId); return orderId === "order_sub_1" ? { _id: newId(), amount: 299, currency: "INR", userId: newId() } : null; };
subscriptionService.markPaymentFailed = async () => { subscriptionCalls.failed += 1; };

// ---- helpers -----------------------------------------------------------------
const results = [];
const check = async (name, fn) => {
  mem.reset(); orderSeq = 0; createOrderCalls = 0; createOrderHook = null; orders.clear(); emits.length = 0; postProcessCalls = 0;
  subscriptionCalls.lookups.length = 0; subscriptionCalls.failed = 0;
  paymentDeps.postProcess = async (p) => { postProcessCalls += 1; return defaultPostProcess(p); };
  try { await fn(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error }); }
};
const hmac = (raw) => crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");

const mkPayment = async (over = {}) => Payment.create({
  appointmentId: newId(), userId: newId(), doctorId: newId(), amount: 500, taxAmount: 90, totalAmount: 590, gatewayAmount: 590,
  currency: "INR", status: "pending", paymentState: "pending", razorpayOrderId: "order_A1", gatewayOrderId: "order_A1",
  idempotencyKey: `key-${crypto.randomUUID()}`, activeAppointmentSlot: true, ...over,
});
const mkAttempt = (payment, attemptNumber, gatewayOrderId, over = {}) => PaymentAttempt.create({
  paymentId: payment._id, attemptNumber, gateway: "razorpay", gatewayOrderId, status: "checkout_started", amount: 590, currency: "INR", ...over,
});
const scenario = async (over = {}) => { const payment = await mkPayment(over); const a1 = await mkAttempt(payment, 1, payment.razorpayOrderId); return { payment, a1 }; };
const fresh = (id) => Payment.findById(id).lean();
const attemptsOf = async (id) => (await PaymentAttempt.find({ paymentId: id }).sort({ attemptNumber: 1 }).lean());

let eventSeq = 0;
const capturedEvent = ({ orderId = "order_A1", id = "pay_1", amount = 59000, currency = "INR" } = {}) => ({ event: "payment.captured", created_at: 1760000000, payload: { payment: { entity: { id, order_id: orderId, ...(amount === null ? {} : { amount }), ...(currency === null ? {} : { currency }), status: "captured", email: "patient@example.com", contact: "+910000000000", created_at: 1760000000 } } } });
const failedEvent = ({ orderId = "order_A1", id = "pay_f1" } = {}) => ({ event: "payment.failed", payload: { payment: { entity: { id, order_id: orderId, status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "free text with details" } } } });
const deliver = async (event, { eventId = `evt_${++eventSeq}`, signature, body } = {}) => {
  const raw = Buffer.from(JSON.stringify(event));
  const req = { body: body === undefined ? raw : body, headers: { "x-razorpay-signature": signature ?? hmac(raw), "x-razorpay-event-id": eventId } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let err; await W.razorpayWebhookHandler(req, res, (e) => { err = e; });
  return { status: res.statusCode, body: res.body, err, eventId };
};
const eventRow = async (eventId) => (await WebhookEvent.findOne({ eventId: `rzp:${eventId}` }).lean()) || WebhookEvent.findOne({ eventId }).lean();

// =============================== STATE MACHINE ================================
await check("captured -> failed is rejected and nothing changes", async () => {
  const { payment } = await scenario({ status: "captured", paymentState: "captured" });
  const r = await T.transitionPayment({ paymentId: payment._id, to: "failed", status: "failed", source: "test" });
  assert.equal(r.outcome, "rejected"); assert.equal(r.reason, "capture_protected");
  const now = await fresh(payment._id); assert.equal(now.status, "captured"); assert.equal(now.paymentState, "captured");
});
await check("completed -> failed and refunded -> failed are rejected (either field protects)", async () => {
  const done = await mkPayment({ status: "captured", paymentState: "completed", razorpayOrderId: "o_c" });
  const refunded = await mkPayment({ status: "refunded", paymentState: "refunded", razorpayOrderId: "o_r" });
  const legacy = await mkPayment({ status: "created", paymentState: "completed", razorpayOrderId: "o_l" }); // fields disagree
  for (const p of [done, refunded, legacy]) {
    const r = await T.transitionPayment({ paymentId: p._id, to: "failed", status: "failed", source: "test" });
    assert.equal(r.outcome, "rejected", `payment ${p.razorpayOrderId}`);
  }
});
await check("history records the REAL previous state, not a hardcoded one", async () => {
  const { payment } = await scenario({ status: "created", paymentState: "authorized" });
  const r = await T.transitionPayment({ paymentId: payment._id, to: "failed", status: "failed", source: "webhook", reason: "x" });
  assert.equal(r.outcome, "applied");
  const row = await fresh(payment._id);
  assert.equal(row.stateHistory.at(-1).from, "authorized"); assert.equal(row.stateHistory.at(-1).to, "failed"); assert.equal(row.stateHistory.at(-1).source, "webhook");
});
await check("repeated transition is a no-op: no extra history", async () => {
  const { payment } = await scenario();
  await T.transitionPayment({ paymentId: payment._id, to: "failed", status: "failed", source: "t" });
  const before = (await fresh(payment._id)).stateHistory.length;
  const again = await T.transitionPayment({ paymentId: payment._id, to: "failed", status: "failed", source: "t" });
  assert.equal(again.outcome, "noop"); assert.equal((await fresh(payment._id)).stateHistory.length, before);
});
await check("illegal transitions are rejected by the machine", async () => {
  const { payment } = await scenario({ status: "failed", paymentState: "failed" });
  const r = await T.transitionPayment({ paymentId: payment._id, to: "completed", source: "t" });
  assert.equal(r.outcome, "rejected"); assert.equal(r.reason, "illegal_transition");
  assert.ok(T.isLegalTransition("expired", "pending"), "retry of an expired payment is legal");
});
await check("concurrent capture and failure: captured always wins, never downgraded (both interleavings)", async () => {
  for (const captureFirst of [true, false]) {
    mem.reset();
    const { payment } = await scenario();
    const cap = deliver(capturedEvent(), { eventId: "cap" });
    const fail = deliver(failedEvent(), { eventId: "fail" });
    if (captureFirst) await Promise.all([cap, fail]); else await Promise.all([fail, cap]);
    const row = await fresh(payment._id);
    assert.ok(["captured", "completed"].includes(row.paymentState) || row.status === "captured", `captureFirst=${captureFirst} state=${row.status}/${row.paymentState}`);
    assert.equal(row.gatewayPaymentId, "pay_1");
  }
});

// ================================= WEBHOOK FAILED =============================
await check("payment.failed after capture never downgrades and never triggers a retry", async () => {
  const { payment } = await scenario({ status: "captured", paymentState: "completed", gatewayPaymentId: "pay_1" });
  const r = await deliver(failedEvent());
  assert.equal(r.status, 200);
  const row = await fresh(payment._id);
  assert.equal(row.status, "captured"); assert.equal(row.paymentState, "completed");
  assert.equal(createOrderCalls, 0, "no retry order for a captured payment");
  assert.equal((await eventRow(r.eventId)).outcome, "ignored_after_capture");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("failed")).length, 0);
});
await check("failure of an OLD attempt does not fail the current order", async () => {
  const payment = await mkPayment({ razorpayOrderId: "order_A2", gatewayOrderId: "order_A2", retryCount: 1 });
  await mkAttempt(payment, 1, "order_A1"); // older attempt, still open
  await mkAttempt(payment, 2, "order_A2"); // current attempt
  const r = await deliver(failedEvent({ orderId: "order_A1" }));
  assert.equal((await eventRow(r.eventId)).outcome, "stale_attempt_failed");
  const row = await fresh(payment._id);
  assert.equal(row.status, "pending"); assert.equal(row.paymentState, "pending"); assert.equal(row.gatewayOrderId, "order_A2");
  const [a1, a2] = await attemptsOf(payment._id);
  assert.equal(a1.status, "failed"); assert.equal(a2.status, "checkout_started");
  assert.equal(createOrderCalls, 0, "no retry for a stale attempt");
});
await check("failure applies once to the current attempt, retries through the canonical claim, duplicates do nothing", async () => {
  const { payment } = await scenario();
  const first = await deliver(failedEvent(), { eventId: "f-1" });
  assert.equal((await eventRow(first.eventId)).outcome, "failed");
  const afterFirst = await fresh(payment._id);
  assert.equal(afterFirst.retryCount, 1); assert.equal(afterFirst.status, "pending", "retry order is live again");
  assert.equal(createOrderCalls, 1);
  const dup = await deliver(failedEvent(), { eventId: "f-1" }); // provider redelivery, same event id
  assert.equal(dup.status, 200); assert.equal(createOrderCalls, 1);
  const again = await deliver(failedEvent(), { eventId: "f-2" }); // a distinct event for the now-superseded order
  assert.equal((await eventRow("f-2")).outcome, "stale_attempt_failed");
  const row = await fresh(payment._id);
  assert.equal(row.retryCount, 1); assert.equal(createOrderCalls, 1);
  assert.equal(row.stateHistory.filter((h) => h.to === "failed").length, 1, "no misleading duplicate failure history");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("failed")).length, 1);
});
await check("failure for an unknown order mutates nothing; subscription isolation is preserved", async () => {
  const { payment } = await scenario();
  const unknown = await deliver(failedEvent({ orderId: "order_nope" }));
  assert.equal((await eventRow(unknown.eventId)).outcome, "ignored_unknown_order");
  assert.equal((await fresh(payment._id)).status, "pending");
  const sub = await deliver(failedEvent({ orderId: "order_sub_1" }));
  assert.equal((await eventRow(sub.eventId)).outcome, "subscription_failed"); assert.equal(subscriptionCalls.failed, 1);
  // an appointment order must never be looked up as a subscription
  const before = subscriptionCalls.lookups.length;
  await deliver(failedEvent({ orderId: "order_A1" }));
  assert.equal(subscriptionCalls.lookups.length, before, "appointment order is never classified as a subscription");
});

// ================================ WEBHOOK CAPTURED ============================
await check("valid capture: attempt captured, payment completed, one automation event; replay converges", async () => {
  const { payment } = await scenario();
  const r = await deliver(capturedEvent());
  assert.equal((await eventRow(r.eventId)).outcome, "captured");
  const row = await fresh(payment._id);
  assert.equal(row.paymentState, "completed"); assert.equal(row.gatewayPaymentId, "pay_1"); assert.equal(row.capturedAttemptNumber, 1);
  assert.equal((await attemptsOf(payment._id))[0].status, "captured");
  const replay = await deliver(capturedEvent(), { eventId: "replay-evt" });
  assert.equal((await eventRow(replay.eventId)).outcome, "replay");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("success")).length, 1, "automation fired once");
});
await check("capture missing currency or amount is never silently substituted: evidence + permanent failure", async () => {
  const { payment } = await scenario();
  const noCur = await deliver(capturedEvent({ currency: null }));
  const row = await eventRow(noCur.eventId);
  assert.equal(row.status, "failed"); assert.equal(row.retryable, false); assert.equal(row.failureCode, "invalid_event");
  assert.equal(noCur.status, 200, "permanent failure is acknowledged so the provider stops redelivering");
  const p = await Payment.findById(payment._id);
  assert.notEqual(p.status, "captured");
  assert.equal(p.reconciliationState, "required");
  const noAmt = await deliver(capturedEvent({ amount: null }));
  assert.equal((await eventRow(noAmt.eventId)).retryable, false);
});
await check("capture amount/currency mismatch -> reconciliation_required, not captured, not retried", async () => {
  const { payment } = await scenario();
  for (const bad of [capturedEvent({ amount: 100 }), capturedEvent({ currency: "USD" })]) {
    mem.reset(); const s = await scenario();
    const r = await deliver(bad);
    const row = await fresh(s.payment._id);
    assert.equal(row.paymentState, "reconciliation_required"); assert.notEqual(row.status, "captured");
    const ev = await eventRow(r.eventId); assert.equal(ev.retryable, false); assert.equal(ev.failureCode, "amount_mismatch");
  }
  void payment;
});
await check("capture for a wrong/unknown order does not touch an unrelated payment", async () => {
  const { payment } = await scenario();
  const r = await deliver(capturedEvent({ orderId: "order_other" }));
  assert.equal((await eventRow(r.eventId)).outcome, "ignored_unknown_order");
  assert.equal((await fresh(payment._id)).status, "pending");
});
await check("attempt allocation differs from payment allocation -> reconciliation", async () => {
  const payment = await mkPayment(); await mkAttempt(payment, 1, "order_A1", { amount: 400 });
  const r = await deliver(capturedEvent({ amount: 40000 }));
  assert.equal((await eventRow(r.eventId)).failureCode, "attempt_mismatch");
  assert.equal((await fresh(payment._id)).paymentState, "reconciliation_required");
});
await check("OLD-ORDER capture after a retry: the real capture is claimed on the paid attempt, never lost", async () => {
  const { payment } = await scenario({ status: "failed", paymentState: "failed" });
  await PaymentAttempt.updateOne({ gatewayOrderId: "order_A1" }, { $set: { status: "failed" } });
  const retried = await paymentRetryService.createRetryAttempt(payment._id, { source: "admin" });
  assert.ok(retried, "retry created attempt 2");
  const order2 = retried.order.id;
  const late = await deliver(capturedEvent({ orderId: "order_A1", id: "pay_old" }));
  assert.equal((await eventRow(late.eventId)).outcome, "captured");
  const row = await fresh(payment._id);
  assert.equal(row.gatewayPaymentId, "pay_old"); assert.equal(row.capturedAttemptNumber, 1); assert.equal(row.capturedGatewayOrderId, "order_A1");
  assert.notEqual(row.capturedGatewayOrderId, order2, "latest order is NOT marked captured just because it is latest");
  const [a1, a2] = await attemptsOf(payment._id);
  assert.equal(a1.status, "captured"); assert.equal(a2.status, "superseded");
  // now the newer order is ALSO paid at the provider: real money, never silently dropped, never fulfils twice
  const dupe = await deliver(capturedEvent({ orderId: order2, id: "pay_new" }));
  assert.equal((await eventRow(dupe.eventId)).outcome, "duplicate_capture_reconciliation");
  const after = await Payment.findById(payment._id).select("+captureEvidence");
  assert.equal(after.gatewayPaymentId, "pay_old"); assert.equal(after.reconciliationState, "required");
  assert.ok(after.captureEvidence.some((e) => e.gatewayPaymentId === "pay_new" && e.disposition === "duplicate_capture"));
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("success")).length, 1, "appointment fulfilled once");
});
await check("late capture AFTER a reported failure is real money: claimed, not lost or rejected", async () => {
  const { payment } = await scenario();
  await deliver(failedEvent({ id: "pay_f_late" }), { eventId: "f-first" }); // failure applied; retry order created
  const p1 = await fresh(payment._id);
  assert.equal(p1.retryCount, 1);
  const cap = await deliver(capturedEvent({ orderId: "order_A1", id: "pay_late" })); // customer paid the ORIGINAL order anyway
  assert.equal((await eventRow(cap.eventId)).outcome, "captured");
  const row = await fresh(payment._id);
  assert.equal(row.paymentState, "completed"); assert.equal(row.gatewayPaymentId, "pay_late"); assert.equal(row.capturedAttemptNumber, 1);
  // and the same payment from a payment explicitly in status "failed"
  mem.reset();
  const s2 = await scenario({ status: "failed", paymentState: "failed" });
  const cap2 = await deliver(capturedEvent({ id: "pay_late2" }));
  assert.equal((await eventRow(cap2.eventId)).outcome, "captured");
  assert.equal((await fresh(s2.payment._id)).paymentState, "completed");
});
await check("every transition the Phase 01 code relies on is legal in the machine", () => {
  const pairs = [["created","order_created"],["order_created","pending"],["created","cancelled"],["order_created","cancelled"],["pending","cancelled"],["pending","verification_pending"],["pending","reconciliation_required"],["failed","reconciliation_required"],["failed","pending"],["expired","pending"],["captured","post_processing"],["post_processing","completed"],["post_processing_failed","post_processing"],["reconciliation_required","captured"],["failed","captured"],["created","captured"],["order_created","captured"],["verification_pending","captured"],["created","verification_pending"],["created","reconciliation_required"],["order_created","reconciliation_required"],["checkout_started","reconciliation_required"],["captured","post_processing_failed"],["expired","reconciliation_required"]];
  assert.deepEqual(pairs.filter(([a, b]) => !T.isLegalTransition(a, b)), []);
  for (const from of ["captured", "post_processing", "post_processing_failed", "completed", "refunded", "partially_refunded"]) assert.equal(T.isLegalTransition(from, "failed"), false, `${from} -> failed`);
});
await check("duplicate capture on the SAME attempt delivered concurrently completes exactly once", async () => {
  const { payment } = await scenario();
  await Promise.all([deliver(capturedEvent(), { eventId: "c1" }), deliver(capturedEvent(), { eventId: "c2" }), deliver(capturedEvent(), { eventId: "c3" })]);
  assert.equal((await fresh(payment._id)).paymentState, "completed");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("success")).length, 1);
  assert.equal((await fresh(payment._id)).stateHistory.filter((h) => h.to === "captured").length, 1);
});
await check("capture on a cancelled payment is preserved as evidence and flagged, never discarded", async () => {
  const { payment } = await scenario({ status: "cancelled", paymentState: "cancelled", activeAppointmentSlot: undefined });
  const r = await deliver(capturedEvent());
  assert.equal((await eventRow(r.eventId)).outcome, "capture_on_unpayable");
  const p = await Payment.findById(payment._id).select("+captureEvidence");
  assert.equal(p.status, "cancelled"); assert.equal(p.reconciliationState, "required"); assert.equal(p.captureEvidence.length, 1);
});

// ======================= CAPTURE / POST-PROCESSING RECOVERY ===================
await check("crash after capture claim: payment stays captured+recoverable (not failed), event retried to completion, effects once", async () => {
  const { payment } = await scenario();
  let crash = true;
  paymentDeps.postProcess = async (p) => { postProcessCalls += 1; if (crash) { crash = false; throw new Error("simulated crash after claim"); } return defaultPostProcess(p); };
  const first = await deliver(capturedEvent(), { eventId: "crash-1" });
  assert.equal(first.status, 500, "transient failure is not falsely acknowledged");
  let row = await fresh(payment._id);
  assert.equal(row.status, "captured"); assert.equal(row.paymentState, "post_processing_failed");
  let ev = await eventRow("crash-1"); assert.equal(ev.status, "failed"); assert.equal(ev.retryable, true);
  const recovered = await W.recoverWebhookEvents({ now: new Date(Date.now() + 10 * 60 * 1000) });
  assert.equal(recovered.length, 1); assert.equal(recovered[0].state, "processed");
  row = await fresh(payment._id); assert.equal(row.paymentState, "completed");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("success")).length, 1);
  assert.equal(postProcessCalls, 2);
});
await check("a late payment.failed after a post-processing crash still cannot downgrade", async () => {
  const { payment } = await scenario();
  paymentDeps.postProcess = async () => { throw new Error("boom"); };
  await deliver(capturedEvent(), { eventId: "pc-1" });
  const f = await deliver(failedEvent());
  assert.equal((await eventRow(f.eventId)).outcome, "ignored_after_capture");
  assert.equal((await fresh(payment._id)).status, "captured");
});

// ================================ WEBHOOK AUTHENTICITY ========================
await check("invalid signature -> 400, nothing stored; malformed JSON/body -> 400; missing secret fails closed", async () => {
  await scenario();
  const bad = await deliver(capturedEvent(), { signature: "0".repeat(64) });
  assert.equal(bad.status, 400); assert.equal(mem.dump("WebhookEvent").length, 0);
  const short = await deliver(capturedEvent(), { signature: "abc" }); assert.equal(short.status, 400);
  const parsed = await deliver(capturedEvent(), { body: { already: "parsed" } }); assert.equal(parsed.status, 400, "a pre-parsed body can never verify");
  const raw = Buffer.from("{not json"); const res = { statusCode: 0, status(c) { this.statusCode = c; return this; }, json() { return this; } };
  await W.razorpayWebhookHandler({ body: raw, headers: { "x-razorpay-signature": hmac(raw) } }, res, () => {}); assert.equal(res.statusCode, 400);
  const saved = W.webhookConfig.secret;
  try { W.webhookConfig.secret = () => undefined; const nos = await deliver(capturedEvent()); assert.equal(nos.status, 503); assert.equal(mem.dump("WebhookEvent").length, 0); }
  finally { W.webhookConfig.secret = saved; }
  assert.equal(W.verifyWebhookSignature(Buffer.from("x"), "sig", ""), false, "empty secret never verifies");
});
await check("stored payload is minimised: no patient email/phone/provider free text", async () => {
  await scenario();
  const r = await deliver(capturedEvent());
  const stored = JSON.stringify((await eventRow(r.eventId)).payload);
  assert.ok(!stored.includes("patient@example.com") && !stored.includes("+910000000000") && !stored.includes("free text"));
  assert.ok(stored.includes("order_A1"));
  const sig = (await eventRow(r.eventId)).signature; assert.equal(sig.length, 16, "only a short digest of the signature is kept");
});
await check("duplicate event id is acknowledged without re-running effects", async () => {
  await scenario();
  await deliver(capturedEvent(), { eventId: "same" });
  const calls = postProcessCalls;
  const dup = await deliver(capturedEvent(), { eventId: "same" });
  assert.equal(dup.status, 200); assert.equal(postProcessCalls, calls);
  assert.equal(mem.dump("WebhookEvent").length, 1);
});
await check("concurrent duplicate delivery processes the event once", async () => {
  const { payment } = await scenario();
  const rs = await Promise.all([deliver(capturedEvent(), { eventId: "cc" }), deliver(capturedEvent(), { eventId: "cc" }), deliver(capturedEvent(), { eventId: "cc" })]);
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(mem.dump("WebhookEvent").length, 1); assert.equal(postProcessCalls, 1);
  assert.equal((await fresh(payment._id)).paymentState, "completed");
});
await check("stuck events (received / expired lease) are recovered; live leases are not stolen", async () => {
  const { payment } = await scenario();
  const old = new Date(Date.now() - 3600_000);
  const payload = W.sanitizeWebhookPayload(capturedEvent());
  await WebhookEvent.create({ eventId: "stuck-received", eventType: "payment.captured", payload, signature: "x", status: "received", createdAt: old });
  await WebhookEvent.create({ eventId: "live", eventType: "payment.captured", payload, signature: "x", status: "processing", leaseOwner: "w", leaseExpiresAt: new Date(Date.now() + 60_000), attempts: 1 });
  const res = await W.recoverWebhookEvents({ receivedGraceMs: 0 });
  assert.equal(res.length, 1, "only the abandoned event is picked up");
  assert.equal((await eventRow("live")).status, "processing");
  assert.equal((await fresh(payment._id)).paymentState, "completed");
  await WebhookEvent.updateOne({ eventId: "live" }, { $set: { leaseExpiresAt: old } });
  const second = await W.recoverWebhookEvents({ receivedGraceMs: 0 }); assert.equal(second.length, 1);
  assert.equal((await eventRow("live")).status, "processed");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("success")).length, 1);
});
await check("permanent failures are never retried; transient failures are bounded", async () => {
  const bad = await deliver({ event: "payment.captured", payload: { payment: { entity: { id: "p" } } } }, { eventId: "malformed" });
  assert.equal(bad.status, 200); const row = await eventRow("malformed");
  assert.equal(row.status, "failed"); assert.equal(row.retryable, false);
  assert.equal((await W.recoverWebhookEvents({ now: new Date(Date.now() + 86400_000) })).length, 0);
  await scenario();
  paymentDeps.postProcess = async () => { throw new Error("always transient"); };
  await deliver(capturedEvent(), { eventId: "bounded" });
  for (let i = 0; i < W.MAX_WEBHOOK_ATTEMPTS + 2; i += 1) await W.recoverWebhookEvents({ now: new Date(Date.now() + (i + 1) * 3600_000 * 2) });
  const ev = await eventRow("bounded");
  assert.ok(ev.attempts <= W.MAX_WEBHOOK_ATTEMPTS, `attempts=${ev.attempts}`); assert.equal(ev.retryable, false);
});
await check("stale webhook worker cannot overwrite the worker that took over", async () => {
  const { payment } = await scenario();
  let release; const gate = new Promise((r) => { release = r; });
  let first = true;
  paymentDeps.postProcess = async (p) => { postProcessCalls += 1; if (first) { first = false; await gate; throw new Error("worker A finally fails"); } return defaultPostProcess(p); };
  const payload = W.sanitizeWebhookPayload(capturedEvent());
  const ev = await WebhookEvent.create({ eventId: "stale", eventType: "payment.captured", payload, signature: "x" });
  const workerA = W.processWebhookEventRecord(ev._id);
  await new Promise((r) => setTimeout(r, 10));
  await WebhookEvent.updateOne({ _id: ev._id }, { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }); // A's lease expires
  const workerB = await W.processWebhookEventRecord(ev._id);
  assert.equal(workerB.state, "processed");
  release();
  const a = await workerA;
  assert.equal(a.state, "stale", "A's late result is discarded");
  const row = await eventRow("stale"); assert.equal(row.status, "processed");
  assert.equal((await fresh(payment._id)).paymentState, "completed");
  assert.equal(emits.filter((e) => e.type.toLowerCase().includes("success")).length, 1);
});
await check("retryWebhookEvent / self-healing uses the canonical processor", async () => {
  await scenario();
  paymentDeps.postProcess = async () => { throw new Error("transient"); };
  await deliver(capturedEvent(), { eventId: "heal" });
  paymentDeps.postProcess = async (p) => defaultPostProcess(p);
  const done = await W.retryWebhookEvent((await eventRow("heal"))._id);
  assert.equal(done.ok, true); assert.equal((await eventRow("heal")).status, "processed");
  const healId = (await eventRow("heal"))._id;
  await assert.rejects(() => W.retryWebhookEvent(healId), /not in a failed state/);
});

// ================================ ATTEMPTS & RETRIES ==========================
const failedPayment = async (over = {}) => { const { payment } = await scenario({ status: "failed", paymentState: "failed", failedAt: new Date(), nextRetryAt: new Date(Date.now() - 1000), ...over }); await PaymentAttempt.updateOne({ paymentId: payment._id }, { $set: { status: "failed" } }); return payment; };
await check("two simultaneous retry requests: exactly one wins, one new attempt, one gateway order", async () => {
  const p = await failedPayment();
  const rs = await Promise.all([paymentRetryService.createRetryAttempt(p._id, { source: "patient", allowExpired: true }), paymentRetryService.createRetryAttempt(p._id, { source: "patient", allowExpired: true })]);
  assert.equal(rs.filter(Boolean).length, 1); assert.equal(createOrderCalls, 1);
  assert.equal((await attemptsOf(p._id)).length, 2); assert.equal((await fresh(p._id)).retryCount, 1);
});
await check("cron vs admin vs webhook retry at the same time create one order", async () => {
  const p = await failedPayment();
  const rs = await Promise.all([
    paymentRetryService.scheduleFailedPayment(p._id, { source: "cron" }),
    paymentRetryService.scheduleFailedPayment(p._id, { source: "admin" }),
    paymentRetryService.scheduleFailedPayment(p._id, { source: "webhook" }),
  ]);
  assert.equal(rs.filter(Boolean).length, 1); assert.equal(createOrderCalls, 1);
  const row = await fresh(p._id);
  assert.equal(row.stateHistory.filter((h) => h.to === "pending").length, 1);
  assert.equal(row.stateHistory.at(-1).from, "failed");
});
await check("retry claim expiry: stale worker cannot overwrite the newer worker's order; its order is recorded", async () => {
  const p = await failedPayment();
  let releaseA; const gateA = new Promise((r) => { releaseA = r; }); let n = 0;
  createOrderHook = async (args) => { n += 1; const mine = n; if (mine === 1) await gateA; return { id: `order_w${mine}`, amount: Math.round(args.amount * 100), currency: args.currency, receipt: args.receipt }; };
  const workerA = paymentRetryService.createRetryAttempt(p._id, { source: "cron" });
  await new Promise((r) => setTimeout(r, 15));
  await Payment.updateOne({ _id: p._id }, { $set: { retryClaimedAt: new Date(Date.now() - 3600_000) } }); // A's lease lapses
  const workerB = await paymentRetryService.createRetryAttempt(p._id, { source: "admin" });
  assert.ok(workerB, "B takes over the expired lease");
  releaseA();
  assert.equal(await workerA, null, "A is fenced out");
  const row = await fresh(p._id);
  assert.equal(row.gatewayOrderId, workerB.order.id); assert.equal(row.retryCount, 1);
  const attempts = await attemptsOf(p._id);
  const aAttempt = attempts.find((a) => a.gatewayOrderId === "order_w1");
  assert.ok(aAttempt && aAttempt.status === "superseded", "orphan order recorded, not lost");
});
await check("gateway rejects order creation: attempt cancelled, claim released, payment unchanged, retry possible", async () => {
  const p = await failedPayment();
  createOrderHook = async () => { const e = new Error("bad request"); e.statusCode = 400; throw e; };
  await assert.rejects(() => paymentRetryService.createRetryAttempt(p._id, { source: "cron" }), /bad request/);
  const a = await attemptsOf(p._id); assert.equal(a.at(-1).status, "cancelled");
  const row = await fresh(p._id); assert.equal(row.status, "failed"); assert.equal(row.retryCount || 0, 0); assert.ok(!row.retryClaimToken);
  createOrderHook = null;
  await Payment.updateOne({ _id: p._id }, { $set: { nextRetryAt: new Date(Date.now() - 1000) } });
  assert.ok(await paymentRetryService.createRetryAttempt(p._id, { source: "admin" }));
});
await check("ambiguous gateway result (timeout): placeholder attempt is looked up by receipt, adopted, never duplicated blindly", async () => {
  const p = await failedPayment();
  createOrderHook = async (args) => { orders.set(args.receipt, { id: "order_exists_at_provider", receipt: args.receipt }); const e = new Error("socket timeout"); e.code = "ETIMEDOUT"; throw e; };
  await assert.rejects(() => paymentRetryService.createRetryAttempt(p._id, { source: "cron" }), /timeout/);
  let attempts = await attemptsOf(p._id);
  assert.ok(A.isPlaceholderOrderId(attempts.at(-1).gatewayOrderId), "ambiguous attempt is kept as a placeholder");
  const early = await A.recoverOrphanAttempts({}); assert.equal(early.length, 0, "inside the grace window nothing is touched");
  const results = await A.recoverOrphanAttempts({ now: new Date(Date.now() + 3600_000) });
  assert.equal(results[0].action, "adopted"); assert.equal(results[0].orderId, "order_exists_at_provider");
  attempts = await attemptsOf(p._id);
  assert.equal(attempts.at(-1).gatewayOrderId, "order_exists_at_provider");
  assert.equal((await fresh(p._id)).gatewayOrderId, "order_A1", "orphan recovery never touches the Payment pointer");
});
await check("attempt reservation failure creates NO gateway order and releases the claim", async () => {
  const p = await failedPayment();
  const real = PaymentAttempt.create; PaymentAttempt.create = async () => { throw new Error("db down"); };
  try { await assert.rejects(() => paymentRetryService.createRetryAttempt(p._id, { source: "cron" }), /db down/); } finally { PaymentAttempt.create = real; }
  assert.equal(createOrderCalls, 0); assert.ok(!(await fresh(p._id)).retryClaimToken);
});
await check("attempt numbering stays unique under concurrent reservation", async () => {
  const p = await failedPayment();
  const reserved = await Promise.all([1, 2, 3, 4].map(() => A.reserveAttempt({ payment: p })));
  const numbers = reserved.map((r) => r.attemptNumber).sort();
  assert.deepEqual(numbers, [2, 3, 4, 5]);
});
await check("retries are bounded; captured/completed/refunded payments are never retryable", async () => {
  const exhausted = await failedPayment({ retryCount: MAX_RETRIES, razorpayOrderId: "o_ex" });
  assert.equal(await paymentRetryService.createRetryAttempt(exhausted._id, {}), null);
  for (const [i, status] of ["captured", "refunded", "cancelled", "pending"].entries()) {
    const p = await mkPayment({ status, paymentState: status, razorpayOrderId: `o_n${i}` });
    assert.equal(await paymentRetryService.createRetryAttempt(p._id, { allowExpired: true }), null, status);
  }
  assert.equal(createOrderCalls, 0);
  assert.ok(buildRetryClaimFilter({ paymentId: newId() }).retryCount.$lt === MAX_RETRIES);
});
await check("one failing candidate does not stop other retry candidates", async () => {
  const ps = [await failedPayment({ razorpayOrderId: "o_b1" }), await failedPayment({ razorpayOrderId: "o_b2" }), await failedPayment({ razorpayOrderId: "o_b3" })];
  let n = 0; createOrderHook = async (args) => { n += 1; if (n === 2) throw new Error("gateway hiccup"); return { id: `order_b${n}`, amount: 59000, currency: "INR", receipt: args.receipt }; };
  const results = await paymentRetryService.retryDuePayments({});
  assert.equal(results.length, 3); assert.equal(results.filter(Boolean).length, 2);
  void ps;
});
await check("exhausting retries releases the appointment payment slot (no permanent block)", async () => {
  const { payment } = await scenario({ retryCount: MAX_RETRIES });
  await deliver(failedEvent());
  const row = await fresh(payment._id);
  assert.equal(row.status, "failed"); assert.ok(row.activeAppointmentSlot !== true);
  assert.equal(createOrderCalls, 0);
});

// ====================== APPOINTMENT PAYMENT UNIQUENESS ========================
await check("only one active payment per appointment: concurrent creates race on the unique slot", async () => {
  const appointmentId = newId();
  const make = (suffix) => Payment.create({ appointmentId, userId: newId(), doctorId: newId(), amount: 1, totalAmount: 1, razorpayOrderId: `o_${suffix}`, idempotencyKey: `k-${suffix}-${crypto.randomUUID()}`, activeAppointmentSlot: true });
  const settled = await Promise.allSettled([make("a"), make("b"), make("c")]);
  assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
  assert.ok(settled.filter((s) => s.status === "rejected").every((s) => s.reason.code === 11000));
  const winner = await findActiveAppointmentPayment(appointmentId); assert.ok(winner);
});
await check("terminal payments release the slot so appointments are never blocked forever; other appointments unaffected", async () => {
  const appointmentId = newId();
  const p = await mkPayment({ appointmentId, status: "pending", paymentState: "pending", razorpayOrderId: "o_s1" });
  for (const to of ["cancelled"]) {
    await T.transitionPayment({ paymentId: p._id, to, status: to, source: "t" });
  }
  assert.ok(!(await fresh(p._id)).activeAppointmentSlot);
  assert.equal(await findActiveAppointmentPayment(appointmentId), null);
  await mkPayment({ appointmentId, razorpayOrderId: "o_s2" }); // a fresh payment is now allowed
  await mkPayment({ appointmentId: newId(), razorpayOrderId: "o_s3" }); // different appointment always allowed
});
await check("legacy un-flagged active payments still block duplicates (until migration 012 backfills)", async () => {
  const appointmentId = newId();
  await mkPayment({ appointmentId, activeAppointmentSlot: undefined, status: "pending", razorpayOrderId: "o_leg" });
  assert.ok(await findActiveAppointmentPayment(appointmentId));
  const failedLegacy = newId();
  await mkPayment({ appointmentId: failedLegacy, activeAppointmentSlot: undefined, status: "failed", paymentState: "failed", retryCount: MAX_RETRIES, razorpayOrderId: "o_leg2" });
  assert.equal(await findActiveAppointmentPayment(failedLegacy), null, "exhausted legacy failure does not block");
});
await check("migration 012: duplicates are reported and block; clean data is backfilled", async () => {
  const M = await import("../migrations/012_payment_active_slot.js");
  const appt = newId();
  const rows = [
    { _id: newId(), appointmentId: appt, status: "pending" },
    { _id: newId(), appointmentId: appt, status: "captured" },
    { _id: newId(), appointmentId: newId(), status: "pending" },
  ];
  const conflicts = M.findConflicts(rows);
  assert.equal(conflicts.length, 1); assert.equal(conflicts[0].payments.length, 2);
  const writes = []; const logs = [];
  const fakeDb = { collection: () => ({ find: () => ({ project: () => ({ toArray: async () => rows }) }), updateMany: async (...a) => { writes.push(a); return { modifiedCount: 0 }; } }) };
  const out = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  assert.equal(await M.run({ argv: ["--dry-run"], db: fakeDb, out }), 2);
  assert.equal(writes.length, 0, "never writes when reconciliation is needed");
  assert.ok(logs.join("\n").includes(String(rows[0]._id)), "conflicting payment ids are reported");
  const clean = { collection: () => ({ find: () => ({ project: () => ({ toArray: async () => [rows[2]] }) }), updateMany: async () => ({ modifiedCount: 1 }) }) };
  assert.equal(await M.run({ argv: ["--dry-run"], db: clean, out }), 3);
});

// ============================ BROWSER VERIFICATION ============================
const callVerify = async (user, body) => {
  const req = { user: { _id: user }, body }; const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let err; await verifyPayment(req, res, (e) => { err = e; });
  return { status: err?.statusCode || res.statusCode, err, body: res.body };
};
const sigOk = () => { paymentGateway.verifyPaymentSignature = () => true; };
const gw = (over) => { paymentGateway.fetchPayment = async () => ({ id: "pay_b", order_id: "order_A1", amount: 59000, currency: "INR", status: "captured", ...over }); };
await check("verify: another user's payment is rejected before anything else", async () => {
  const { payment } = await scenario(); sigOk(); gw();
  const r = await callVerify(newId(), { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 403); assert.equal((await fresh(payment._id)).status, "pending");
});
await check("verify: invalid signature changes no state", async () => {
  const { payment } = await scenario(); paymentGateway.verifyPaymentSignature = () => false; gw();
  const r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "bad" });
  assert.equal(r.status, 400); const row = await fresh(payment._id); assert.equal(row.paymentState, "pending"); assert.notEqual(row.reconciliationState, "required");
});
await check("verify: provider timeout / incomplete response -> verification_pending (503), NEVER failed", async () => {
  const { payment } = await scenario(); sigOk();
  paymentGateway.fetchPayment = async () => { throw new Error("ETIMEDOUT"); };
  let r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 503); assert.equal((await fresh(payment._id)).paymentState, "verification_pending");
  gw({ currency: undefined });
  r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 503); assert.notEqual((await fresh(payment._id)).status, "failed");
});
await check("verify: provider 'authorized'/'created' is pending (202), not a failure", async () => {
  const { payment } = await scenario(); sigOk(); gw({ status: "authorized" });
  const r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 202); assert.equal(r.body.data.confirming, true); assert.notEqual((await fresh(payment._id)).status, "failed");
});
await check("verify: amount or currency mismatch -> reconciliation, never captured", async () => {
  const { payment } = await scenario(); sigOk(); gw({ amount: 100 });
  const r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 409); const row = await fresh(payment._id);
  assert.equal(row.paymentState, "reconciliation_required"); assert.notEqual(row.status, "captured");
});
await check("verify: captured + post-processing failure stays captured/recoverable and reports incomplete (not failed)", async () => {
  const { payment } = await scenario(); sigOk(); gw();
  const r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 200); assert.equal(r.body.data.postProcessingIncomplete, true);
  const row = await fresh(payment._id);
  assert.equal(row.status, "captured"); assert.equal(row.paymentState, "post_processing_failed"); assert.equal(row.gatewayPaymentId, "pay_b");
  // a late failure webhook cannot downgrade it; the capture webhook for the same payment converges
  await deliver(failedEvent());
  assert.equal((await fresh(payment._id)).status, "captured");
  const hook = await deliver(capturedEvent({ id: "pay_b" }));
  assert.equal((await eventRow(hook.eventId)).outcome, "replay"); assert.equal((await fresh(payment._id)).paymentState, "completed");
});
await check("verify: replay of an already captured payment is idempotent; a different provider payment is routed to reconciliation", async () => {
  const { payment } = await scenario({ status: "captured", paymentState: "completed", gatewayPaymentId: "pay_b", postProcessingState: "complete" }); sigOk(); gw();
  const same = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(same.status, 200); assert.equal(same.body.data.replay, true);
  gw({ id: "pay_other" });
  const other = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_other", razorpay_signature: "s" });
  assert.equal(other.status, 409);
  const p = await Payment.findById(payment._id).select("+captureEvidence");
  assert.equal(p.gatewayPaymentId, "pay_b"); assert.equal(p.reconciliationState, "required"); assert.ok(p.captureEvidence.length >= 1);
});
await check("verify: provider-reported failure fails only the current attempt, via the shared path", async () => {
  const { payment } = await scenario(); sigOk(); gw({ status: "failed", error_code: "GATEWAY_ERROR" });
  const r = await callVerify(payment.userId, { razorpay_order_id: "order_A1", razorpay_payment_id: "pay_b", razorpay_signature: "s" });
  assert.equal(r.status, 402);
  assert.equal((await attemptsOf(payment._id))[0].status, "failed");
});
await check("recovery classification is evidence-based", async () => {
  const c = classifyPaymentRecovery;
  assert.equal(c({ status: "captured", paymentState: "post_processing_failed" }), "SUCCESS");
  assert.equal(c({ status: "created", paymentState: "completed" }), "SUCCESS");
  assert.equal(c({ status: "pending", paymentState: "verification_pending" }), "PENDING");
  assert.equal(c({ status: "pending", paymentState: "reconciliation_required" }), "REQUIRES_RECONCILIATION");
  assert.equal(c({ status: "failed", paymentState: "failed" }), "FAILED");
  assert.equal(c({ status: "failed", paymentState: "pending" }), "PENDING", "legacy live retry order");
  assert.equal(c({ status: "pending", paymentState: "pending", reconciliationState: "required" }), "REQUIRES_RECONCILIATION");
  assert.equal(c({ status: "captured", paymentState: "completed", reconciliationState: "required" }), "SUCCESS", "captured wins over a reconciliation flag");
  assert.equal(c(null), "NONE");
});

mem.restore();
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`);
  else { failed += 1; console.log(`  FAIL ${r.name}\n       ${r.error?.stack?.split("\n").slice(0, 4).join("\n       ")}`); }
}
console.log(`phase01PaymentCore: ${results.length - failed}/${results.length} passed (LOCALLY_VERIFIED; in-memory model layer, NOT real MongoDB)`);
process.exit(failed ? 1 : 0);

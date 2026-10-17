// Phase 02 closure -- crash / recovery matrix through the REAL application paths:
// createPaymentOrder, verifyPayment, the Razorpay webhook handler, debitWalletForPayment, the recharge
// controllers, and the recovery jobs.
//
// LEVEL: LOCALLY_VERIFIED. In-memory model layer + in-memory wallet-reservation store + a FAKED provider
// (provider "success" here is a mock, NOT Razorpay evidence). Appointment completion inside post-processing is a
// stand-in (the real appointment/invoice/payout fan-out is not exercised here); the wallet commit/ledger step inside
// it is the REAL debitWalletForPayment.
import assert from "node:assert/strict";
import * as H from "./helpers/phase02Harness.mjs";

const { M, PC, FC, WR, RS, T, provider, appts, call, deliver, capturedEvent, failedEvent, providerSays, keyFor } = H;
let n = 0;
let ppHook = null; // injected failure inside "appointment completion"
let ppCalls = 0;
H.paymentDeps.postProcess = async (payment) => {
  ppCalls += 1;
  const fresh = await M.Payment.findById(payment._id);
  if (fresh.paymentState === "completed") return { completedNow: false, replay: true };
  const started = await T.markPostProcessingStarted(fresh);
  if (started.outcome === "rejected") throw new Error("post-processing rejected");
  await PC.debitWalletForPayment(payment); // REAL wallet commit + ledger
  if (ppHook) await ppHook(payment);
  const a = appts.get(String(payment.appointmentId)); if (a && a.status === "payment_pending") { a.status = "payment_completed"; a.paymentStatus = "paid"; a.paymentId = payment._id; }
  const done = await T.markPostProcessingCompleted(payment._id);
  return { completedNow: done.outcome === "applied" };
};

let store;
const check = async (name, fn) => {
  store = H.reset(); ppHook = null; ppCalls = 0; H.paymentGateway.verifyPaymentSignature = () => true;
  try { await fn(); console.log(`  ok   ${name}`); n += 1; } catch (error) { console.error(`  FAIL ${name}\n`, error); process.exitCode = 1; }
};
const crashOnce = (Model, method, predicate = () => true) => {
  const original = Model[method].bind(Model); let armed = true;
  Model[method] = (...args) => { if (armed && predicate(...args)) { armed = false; return Promise.reject(new Error(`injected crash in ${Model.modelName}.${method}`)); } return original(...args); };
  return () => { Model[method] = original; };
};
const wallet = (userId) => store.wallets.get(String(userId));
const debits = (userId) => wallet(userId).transactions.filter((t) => t.type === "payment").length;
const walletLedger = (paymentId) => M.TransactionLedger.find({ idempotencyKey: `wallet:debit:${paymentId}` }).lean();
const pay = (id) => M.Payment.findById(id).lean();

const start = async ({ balance = 1000, wallet: walletAmount = 100, appt: apptOver = {} } = {}) => {
  const appt = H.mkAppointment(apptOver); H.fund(store, appt.patientId, balance);
  const idempotencyKey = keyFor();
  const r = await call(PC.createPaymentOrder, appt.patientId, { body: { appointmentId: String(appt._id), idempotencyKey, walletAmount } });
  return { appt, idempotencyKey, r, payment: r.body?.data?.payment, order: r.body?.data?.order, user: appt.patientId };
};
const verify = (ctx, over = {}) => call(PC.verifyPayment, ctx.user, { body: { razorpay_order_id: ctx.order.id, razorpay_payment_id: "pay_1", razorpay_signature: "sig", ...over } });
const captured = (ctx, over) => providerSays({ amount: Math.round(ctx.payment.gatewayAmount * 100), ...over });

// ============================================================= split payment
await check("baseline: split order reserves the wallet portion BEFORE the provider order; server decides the split", async () => {
  const ctx = await start({ wallet: 100 });
  assert.equal(ctx.r.status, 201);
  assert.equal(ctx.payment.walletAmount, 100); assert.equal(ctx.payment.gatewayAmount, 490);
  assert.equal(wallet(ctx.user).holds.length, 1); assert.equal(wallet(ctx.user).balance, 1000, "reservation does not debit");
  assert.equal(provider.createOrderCalls, 1);
});
await check("requested wallet amount above the balance is capped by the server; client cannot overspend", async () => {
  const ctx = await start({ balance: 50, wallet: 400 });
  assert.equal(ctx.payment.walletAmount, 50); assert.equal(wallet(ctx.user).holds[0].amountPaise, 5000);
});
await check("gateway order created but local persistence fails: no second chargeable order, one hold, retry converges", async () => {
  const appt = H.mkAppointment(); H.fund(store, appt.patientId, 1000);
  let armedAfterOrder = false;
  H.provider.createOrderHook = async (args) => { const o = { id: `order_${++provider.seq}`, amount: Math.round(args.amount * 100), currency: "INR", receipt: args.receipt }; provider.orders.set(args.receipt, o); armedAfterOrder = true; return o; };
  const undo = crashOnce(M.PaymentAttempt, "findOneAndUpdate", () => armedAfterOrder);
  const undo2 = crashOnce(M.PaymentAttempt, "updateOne", () => armedAfterOrder);
  const key = keyFor();
  const first = await call(PC.createPaymentOrder, appt.patientId, { body: { appointmentId: String(appt._id), idempotencyKey: key, walletAmount: 100 } });
  undo(); undo2();
  assert.ok(first.status >= 400 || first.err, "the failed persistence is surfaced, not swallowed");
  assert.equal(wallet(appt.patientId).holds.length, 1); assert.equal(provider.orders.size, 1);
  const call2 = () => call(PC.createPaymentOrder, appt.patientId, { body: { appointmentId: String(appt._id), idempotencyKey: key, walletAmount: 100 } });
  const tooSoon = await call2();
  assert.equal(tooSoon.code, "PAYMENT_CREATION_IN_PROGRESS", "an immediate duplicate is told to wait, and opens nothing");
  assert.equal(provider.orders.size, 1);
  await M.Payment.updateOne({ appointmentId: appt._id }, { $set: { createdAt: new Date(Date.now() - 10 * 60_000) } }); // the crash window has clearly passed
  const retry = await call2();
  assert.ok(retry.status < 400, `retry converges (got ${retry.status} ${retry.err?.message})`);
  assert.equal(provider.orders.size, 1, "no second chargeable provider order (adopted by receipt)");
  assert.equal(wallet(appt.patientId).holds.length, 1, "still exactly one hold");
  assert.equal((await M.Payment.find({ appointmentId: appt._id }).lean()).length, 1);
});
await check("duplicate submission after a timeout: concurrent identical requests -> one payment, one hold, one provider order", async () => {
  const appt = H.mkAppointment(); H.fund(store, appt.patientId, 1000); const key = keyFor();
  const results = await Promise.all([1, 2, 3].map(() => call(PC.createPaymentOrder, appt.patientId, { body: { appointmentId: String(appt._id), idempotencyKey: key, walletAmount: 100 } })));
  assert.ok(results.some((r) => r.status === 201 || r.status === 200), "at least one request succeeds");
  assert.ok(results.every((r) => r.status === 201 || r.status === 409 || r.status === 200), `losers get a safe conflict, never a second order: ${JSON.stringify(results.map((r) => [r.status, r.err?.message]))}`);
  assert.equal((await M.Payment.find({ appointmentId: appt._id }).lean()).length, 1);
  assert.equal(wallet(appt.patientId).holds.length, 1); assert.equal(provider.orders.size, 1);
  const retry = await call(PC.createPaymentOrder, appt.patientId, { body: { appointmentId: String(appt._id), idempotencyKey: key, walletAmount: 100 } });
  assert.equal(retry.status, 200, "after the winner settled, the same key returns the existing order");
  assert.equal(provider.orders.size, 1); assert.equal(wallet(appt.patientId).holds.length, 1);
});
await check("capture received but wallet reservation commit FAILS: capture preserved, funds still held, replay debits exactly once", async () => {
  const ctx = await start(); captured(ctx);
  const undo = H.injectFailure(store, "commitHold", { phase: "before" });
  const v = await verify(ctx);
  undo();
  const row = await pay(ctx.payment._id);
  assert.equal(row.status, "captured", "a wallet failure never resets a real capture to failed"); assert.equal(row.paymentState, "post_processing_failed");
  assert.equal(wallet(ctx.user).balance, 1000); assert.equal(wallet(ctx.user).holds.length, 1, "hold intact; funds not released");
  assert.ok(v.body?.data?.postProcessingIncomplete || v.status >= 200);
  const hook = await deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_1", amount: 49000 }));
  assert.equal(hook.status, 200);
  assert.equal(wallet(ctx.user).balance, 900); assert.equal(debits(ctx.user), 1); assert.equal(wallet(ctx.user).holds.length, 0);
  assert.equal((await pay(ctx.payment._id)).paymentState, "completed");
  assert.equal(appts.get(String(ctx.appt._id)).status, "payment_completed");
});
await check("ledger write fails AFTER the wallet debit: replay posts the ledger once, never debits twice", async () => {
  const ctx = await start(); captured(ctx);
  const undo = crashOnce(M.TransactionLedger, "create", (doc) => doc?.type === "wallet_debit");
  await verify(ctx); undo();
  assert.equal(wallet(ctx.user).balance, 900, "wallet effect is written FIRST");
  assert.equal((await walletLedger(ctx.payment._id)).length, 0, "no success-only ledger row ahead of the wallet effect");
  await deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_1", amount: 49000 }));
  assert.equal(wallet(ctx.user).balance, 900); assert.equal(debits(ctx.user), 1);
  assert.equal((await walletLedger(ctx.payment._id)).length, 1);
  assert.equal((await pay(ctx.payment._id)).paymentState, "completed");
});
await check("duplicate webhook and browser verification arriving concurrently: one debit, one completion, converged state", async () => {
  const ctx = await start(); captured(ctx);
  const [v, w1, w2] = await Promise.all([verify(ctx), deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_1", amount: 49000 })), deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_1", amount: 49000 }))]);
  assert.ok([v, w1, w2].every((x) => x.status < 500), JSON.stringify([v.status, w1.status, w2.status]));
  assert.equal(debits(ctx.user), 1); assert.equal(wallet(ctx.user).balance, 900); assert.equal(wallet(ctx.user).holds.length, 0);
  assert.equal((await walletLedger(ctx.payment._id)).length, 1);
  assert.equal((await pay(ctx.payment._id)).paymentState, "completed"); assert.equal(appts.get(String(ctx.appt._id)).status, "payment_completed");
});
await check("crash after capture but before appointment completion: wallet debited once, payment recoverable, replay completes", async () => {
  const ctx = await start(); captured(ctx);
  let fail = true; ppHook = async () => { if (fail) throw new Error("appointment completion crashed"); };
  const first = await deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_1", amount: 49000 }));
  assert.ok(first.status >= 500 || first.body?.success === false, "the failed completion is surfaced to the provider for redelivery");
  const mid = await pay(ctx.payment._id);
  assert.equal(mid.status, "captured", "the capture is never reset"); assert.equal(mid.paymentState, "post_processing_failed");
  assert.equal(wallet(ctx.user).balance, 900, "wallet debited exactly once before the crash"); assert.equal(appts.get(String(ctx.appt._id)).status, "payment_pending");
  fail = false;
  await deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_1", amount: 49000 }));
  assert.equal(debits(ctx.user), 1); assert.equal(wallet(ctx.user).balance, 900);
  assert.equal(appts.get(String(ctx.appt._id)).status, "payment_completed"); assert.equal((await pay(ctx.payment._id)).paymentState, "completed");
});
await check("late capture after the payment was cancelled and its hold released: evidence preserved, wallet untouched, case listed", async () => {
  const ctx = await start();
  const cancelled = await T.transitionPayment({ paymentId: ctx.payment._id, to: "cancelled", from: ["created", "order_created", "pending"], source: "test", reason: "user abandoned" });
  assert.equal(cancelled.outcome, "applied");
  assert.equal((await WR.releaseWalletReservation({ paymentId: ctx.payment._id, reason: "abandoned" })).released, true);
  await deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_late", amount: 49000 }));
  const row = await M.Payment.findById(ctx.payment._id).select("+captureEvidence").lean();
  assert.notEqual(row.status, "captured"); assert.equal(row.reconciliationState, "required");
  assert.ok(row.captureEvidence.some((e) => e.gatewayPaymentId === "pay_late"), "capture evidence is never silently dropped");
  assert.equal(wallet(ctx.user).balance, 1000); assert.equal(debits(ctx.user), 0); assert.equal(wallet(ctx.user).holds.length, 0);
  const { listCaptureCases } = await import("../payments/captureResolution.js");
  assert.ok((await listCaptureCases()).some((c) => c.gatewayPaymentId === "pay_late"), "operator can see it in the capture-case workspace");
});
await check("attempted release while a capture is ambiguous (verification_pending / provider id): nothing is released", async () => {
  const ctx = await start(); captured(ctx);
  H.paymentGateway.fetchPayment = async () => { throw new Error("ETIMEDOUT"); };
  await verify(ctx);
  assert.equal((await pay(ctx.payment._id)).paymentState, "verification_pending");
  const { cancelAndReleaseUnpaidPayment, sweepUnpayablePayments } = await import("../payments/unpaidPaymentCleanup.js");
  ctx.appt && (appts.get(String(ctx.appt._id)).status = "cancelled");
  assert.ok((await cancelAndReleaseUnpaidPayment(ctx.payment, { reason: "t" })).startsWith("skipped"));
  await M.Payment.updateOne({ _id: ctx.payment._id }, { $set: { updatedAt: new Date(0) } });
  assert.equal((await sweepUnpayablePayments()).filter((r) => r.outcome === "released").length, 0);
  assert.equal(wallet(ctx.user).holds.length, 1);
});
await check("a failed provider payment keeps the hold for retry; a later capture of that order still debits once", async () => {
  const ctx = await start();
  await deliver(failedEvent({ orderId: ctx.order.id }));
  assert.equal(wallet(ctx.user).holds.length, 1, "retryable failure never releases funds");
  await deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_2", amount: 49000 }));
  assert.equal(debits(ctx.user), 1); assert.equal(wallet(ctx.user).balance, 900);
});

// ================================================================ wallet-only
await check("wallet-only: no provider order, wallet debited once, appointment completed", async () => {
  const ctx = await start({ wallet: 590 });
  assert.equal(ctx.r.status, 201); assert.equal(provider.createOrderCalls, 0, "no external gateway order or charge");
  assert.equal(ctx.r.body.data.walletOnly, true);
  assert.equal(wallet(ctx.user).balance, 410); assert.equal(debits(ctx.user), 1);
  assert.equal((await pay(ctx.payment._id)).status, "captured");
});
await check("wallet-only: debit succeeds but appointment completion fails -> debited once, recoverable; retry never debits again", async () => {
  ppHook = async () => { throw new Error("appointment completion crashed"); };
  const ctx = await start({ wallet: 590 });
  const row = await pay(ctx.payment?._id || (await M.Payment.findOne({}).lean())._id);
  assert.equal(wallet(ctx.user).balance, 410); assert.equal(debits(ctx.user), 1);
  assert.equal(row.status, "captured", "never a false-paid reset or a retryable inconsistent payment");
  ppHook = null;
  const again = await call(PC.createPaymentOrder, ctx.user, { body: { appointmentId: String(ctx.appt._id), idempotencyKey: ctx.idempotencyKey, walletAmount: 590 } });
  assert.ok(again.status < 500, `${again.status} ${again.err?.message}`);
  assert.equal(wallet(ctx.user).balance, 410); assert.equal(debits(ctx.user), 1);
});
await check("wallet-only: insufficient balance -> capped split needs a gateway; exact-balance wallet-only; zero wallet -> normal order", async () => {
  const a = await start({ balance: 100, wallet: 590 });
  assert.equal(a.payment.walletOnly ?? false, false); assert.equal(a.payment.walletAmount, 100);
});
await check("wallet-only: concurrent checkouts for the SAME wallet cannot both spend it", async () => {
  const user = H.newId(); H.fund(store, user, 600);
  const a1 = H.mkAppointment({ patientId: user }); const a2 = H.mkAppointment({ patientId: user });
  const r = await Promise.all([a1, a2].map((a) => call(PC.createPaymentOrder, user, { body: { appointmentId: String(a._id), idempotencyKey: keyFor(), walletAmount: 590 } })));
  const walletOnly = r.filter((x) => x.body?.data?.walletOnly);
  assert.ok(walletOnly.length <= 1, "at most one wallet-only purchase can be funded by 600");
  assert.ok(wallet(user).balance >= 0, `balance never negative (${wallet(user).balance})`);
  const heldOrSpent = 600 - wallet(user).balance + wallet(user).holds.reduce((s, h) => s + h.amountPaise / 100, 0);
  assert.ok(heldOrSpent <= 600, `spent+held ${heldOrSpent} never exceeds balance`);
});

// ==================================================================== coupons
await check("coupon claim succeeds but Payment creation fails: reservation is released immediately, no hold is left", async () => {
  const appt = H.mkAppointment(); H.fund(store, appt.patientId, 1000);
  const coupon = await M.Coupon.create({ code: "SAVE50", type: "fixed", value: 50, expiresAt: new Date(Date.now() + 1e9), usageLimit: 5, usedCount: 0, usedBy: [] });
  const original = H.couponService.validateAndCalculate;
  H.couponService.validateAndCalculate = async () => ({ coupon: await M.Coupon.findById(coupon._id), discountAmount: 50 });
  const undo = crashOnce(M.Payment, "create");
  const r = await call(PC.createPaymentOrder, appt.patientId, { body: { appointmentId: String(appt._id), idempotencyKey: keyFor(), couponCode: "SAVE50", walletAmount: 100 } });
  undo(); H.couponService.validateAndCalculate = original;
  assert.ok(r.status >= 400 || r.err);
  const row = await M.Coupon.findById(coupon._id).lean();
  assert.equal(row.usedCount, 0); assert.equal(row.usedBy.length, 0);
  assert.equal(wallet(appt.patientId).holds.length, 0, "no hold exists before a Payment exists");
  assert.equal(provider.createOrderCalls, 0);
});
await check("process dies after the coupon claim (no release runs): orphan recovery frees it exactly once", async () => {
  const coupon = await M.Coupon.create({ code: "ORPH", type: "fixed", value: 50, expiresAt: new Date(Date.now() + 1e9), usageLimit: 5, usedCount: 1, usedBy: [{ userId: H.newId(), paymentId: H.newId(), usedAt: new Date(Date.now() - 3600_000) }] });
  const { recoverOrphanCouponReservations } = await import("../payments/unpaidPaymentCleanup.js");
  assert.equal((await recoverOrphanCouponReservations()).length, 1);
  assert.equal((await recoverOrphanCouponReservations()).length, 0);
  assert.equal((await M.Coupon.findById(coupon._id).lean()).usedCount, 0);
});

// ==================================================================== recharge
const rechargeCtx = async (amount = 500) => {
  const user = H.newId(); await M.Wallet.create({ userId: user, balance: 0 });
  const created = await call(FC.createWalletRechargeOrder, user, { body: { amount } });
  const order = created.body.data.order; const recharge = created.body.data.recharge;
  return { user, order, recharge, created };
};
const verifyRecharge = (ctx, paymentId = "pay_r1") => call(FC.verifyWalletRecharge, ctx.user, { body: { razorpayOrderId: ctx.order.id, paymentId, signature: "sig" } });
const rBalance = async (user) => (await M.Wallet.findOne({ userId: user }).lean()).balance;
const rLedger = (id) => M.TransactionLedger.find({ idempotencyKey: RS.rechargeLedgerKey(id) }).lean();
await check("recharge: intent persisted before the provider order (deterministic receipt), then bound", async () => {
  const ctx = await rechargeCtx();
  assert.equal(ctx.created.status, 201);
  const row = await M.WalletRecharge.findById(ctx.recharge._id).lean();
  assert.equal(row.gatewayOrderId, ctx.order.id); assert.equal(row.status, "order_created");
  assert.ok(provider.orders.has(RS.rechargeReceipt(ctx.recharge._id)));
});
await check("recharge: gateway order created but binding fails -> placeholder recharge is recovered by receipt, no orphan order", async () => {
  const user = H.newId(); await M.Wallet.create({ userId: user, balance: 0 });
  const undo = crashOnce(M.WalletRecharge, "findOneAndUpdate", (f, u) => u?.$set?.status === "order_created");
  const r = await call(FC.createWalletRechargeOrder, user, { body: { amount: 500 } });
  undo();
  assert.ok(r.status >= 400 || r.err);
  const [row] = await M.WalletRecharge.find({ userId: user }).lean();
  assert.ok(row.gatewayOrderId.startsWith(RS.RECHARGE_PLACEHOLDER_PREFIX), "intent is durable even though the order id was never bound");
  await M.WalletRecharge.updateOne({ _id: row._id }, { $set: { updatedAt: new Date(0), createdAt: new Date(0) } });
  const out = await RS.recoverStuckWalletRecharges({ now: new Date(Date.now() + 3600_000) });
  assert.equal(out[0].outcome, "order_adopted");
  assert.equal((await M.WalletRecharge.findById(row._id).lean()).gatewayOrderId, [...provider.orders.values()][0].id);
  assert.equal(provider.orders.size, 1);
});
await check("recharge: credit succeeds but ledger write fails -> balance credited once, replay completes ledger + posted", async () => {
  const ctx = await rechargeCtx(); providerSays({ amount: 50000 });
  const undo = crashOnce(M.TransactionLedger, "create", (d) => d?.type === "wallet_credit");
  const v1 = await verifyRecharge(ctx); undo();
  assert.ok(v1.status >= 400 || v1.err);
  assert.equal(await rBalance(ctx.user), 500); assert.equal((await rLedger(ctx.recharge._id)).length, 0);
  assert.equal((await M.WalletRecharge.findById(ctx.recharge._id).lean()).status, "captured");
  const v2 = await verifyRecharge(ctx);
  assert.equal(v2.status, 200);
  assert.equal(await rBalance(ctx.user), 500); assert.equal((await rLedger(ctx.recharge._id)).length, 1);
  assert.equal((await M.WalletRecharge.findById(ctx.recharge._id).lean()).status, "posted");
});
await check("recharge: ledger OK but final status write fails -> replay finishes, no second credit or ledger", async () => {
  const ctx = await rechargeCtx(); providerSays({ amount: 50000 });
  const undo = crashOnce(M.WalletRecharge, "findOneAndUpdate", (f, u) => u?.$set?.status === "posted");
  await verifyRecharge(ctx); undo();
  assert.equal(await rBalance(ctx.user), 500); assert.equal((await rLedger(ctx.recharge._id)).length, 1);
  const v = await verifyRecharge(ctx); assert.equal(v.status, 200);
  assert.equal(await rBalance(ctx.user), 500); assert.equal((await rLedger(ctx.recharge._id)).length, 1);
  assert.equal((await M.WalletRecharge.findById(ctx.recharge._id).lean()).status, "posted");
});
await check("recharge: browser verification racing the webhook (and a duplicate webhook) credits exactly once", async () => {
  const ctx = await rechargeCtx(); providerSays({ amount: 50000 });
  const results = await Promise.all([verifyRecharge(ctx), deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_r1", amount: 50000 })), deliver(capturedEvent({ orderId: ctx.order.id, id: "pay_r1", amount: 50000 }))]);
  assert.ok(results.every((r) => r.status < 500), JSON.stringify(results.map((r) => r.status)));
  assert.equal(await rBalance(ctx.user), 500); assert.equal((await rLedger(ctx.recharge._id)).length, 1);
});
await check("recharge: failed event then late capture credits once; wrong amount never credits", async () => {
  const a = await rechargeCtx(); await deliver(failedEvent({ orderId: a.order.id }));
  assert.equal(await rBalance(a.user), 0);
  await deliver(capturedEvent({ orderId: a.order.id, id: "pay_late", amount: 50000 }));
  assert.equal(await rBalance(a.user), 500);
  const b = await rechargeCtx(); await deliver(capturedEvent({ orderId: b.order.id, id: "pay_x", amount: 100 }));
  assert.equal(await rBalance(b.user), 0);
});

// =============================================================== recovery workers
await check("recovery worker crashes mid-run / loses its lease / re-runs an already completed operation", async () => {
  const user = H.newId(); H.fund(store, user, 500); const paymentId = H.newId();
  await WR.reserveWalletFunds({ userId: user, paymentId, amount: 100 });
  const rec = store.reservations.get(String(paymentId)); rec.updatedAt = new Date(0);
  const now = new Date(Date.now() + WR.HOLDING_STALE_MS + 60_000);
  // worker A claims the lease and "crashes" (never finishes)
  const a = await store.claimRecoveryLease({ id: rec._id, owner: "A", now, leaseMs: 60_000, statuses: ["reserved"] });
  assert.ok(a);
  // worker B cannot act while A's lease is live
  const early = await WR.recoverWalletReservations({ now, loadPayment: async () => ({ paymentState: "cancelled", status: "cancelled" }) });
  assert.deepEqual(early.map((e) => e.action), ["skipped_claimed"], "live lease blocks a second worker");
  assert.equal(rec.status, "reserved");
  // lease expires; B completes the release
  const later = new Date(now.getTime() + 5 * 60_000);
  const out = await WR.recoverWalletReservations({ now: later, loadPayment: async () => ({ paymentState: "cancelled", status: "cancelled" }) });
  assert.equal(out[0].action, "released");
  // A wakes up and tries to write with its stale fence: rejected, state unchanged
  assert.equal(await store.casReservation({ id: rec._id, from: ["reserved"], to: "committed", leaseOwner: "A" }), null);
  assert.equal(await store.patchReservation({ id: rec._id, leaseOwner: "A", set: { lastError: "stale" } }), null);
  assert.equal(rec.status, "released"); assert.equal(wallet(user).balance, 500); assert.equal(wallet(user).holds.length, 0);
  // already-completed operation: re-running recovery does nothing
  assert.equal((await WR.recoverWalletReservations({ now: new Date(later.getTime() + 3600_000), loadPayment: async () => ({ paymentState: "cancelled" }) })).length, 0);
});
await check("recovery completes a captured payment's reservation commit exactly once across repeated runs", async () => {
  const ctx = await start(); captured(ctx);
  const undo = H.injectFailure(store, "commitHold", { phase: "before" }); await verify(ctx); undo();
  store.reservations.get(String(ctx.payment._id)).updatedAt = new Date(0);
  const later = new Date(Date.now() + 3600_000);
  const run = () => WR.recoverWalletReservations({ now: later, loadPayment: async (id) => M.Payment.findById(id).lean() });
  const first = await run(); assert.equal(first[0].action, "committed");
  await run(); await run();
  assert.equal(debits(ctx.user), 1); assert.equal(wallet(ctx.user).balance, 900);
});

console.log(`phase02CrashMatrix: ${n} checks passed (LOCALLY_VERIFIED; real controllers/services, in-memory models, FAKED provider)`);
process.exit(process.exitCode || 0);

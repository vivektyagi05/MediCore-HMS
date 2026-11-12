import assert from "node:assert/strict";
import * as H from "./helpers/refundHarness.mjs";
import { acquireRefundLock, releaseRefundLock, REFUND_LOCK_LEASE_MS } from "../payments/refundLock.js";

// Real refundController / refundLock / earning adjustment / outbox on an in-memory model layer and a faked
// provider. Crash injection throws once at a named production call site; the recovery path is then the
// production reconcile/settle code. NOT a real MongoDB or Razorpay test.
const { M, RC, provider, dumpOne, ledgerOf, receipts, doctorNotices, mem } = H;
let n = 0;
const test = async (name, fn) => { H.reset(); await fn(); n += 1; console.log(`PASS: ${name}`); };
const processedRefund = (id, amountRupees, extra = {}) => ({ id, status: "processed", amount: Math.round(amountRupees * 100), ...extra });
const settle = (rr, refund, source = "webhook") => RC.settlePendingGatewayRefund({ refundRequestId: rr._id, refund, source });
const walletBalance = (userId) => mem.dump("Wallet").find((w) => String(w.userId) === String(userId))?.balance;

// Split payment: 300 from wallet, 700 from gateway; 500 refund => wallet 150 + gateway 350 is decided by the policy engine.
const splitFixture = async ({ refundAmount = 500 } = {}) => {
  const payment = await H.mkPayment({ walletAmount: 300, gatewayAmount: 700 });
  await H.mkWallet(payment.userId, 0);
  const payout = await H.mkPayout(payment._id);
  const { computeFundingAllocation } = await import("../payments/refundPolicyEngine.js");
  const { walletRefundAmount, gatewayRefundAmount } = computeFundingAllocation({ payment, refundAmount });
  const rr = await H.mkRefund(payment, { amount: refundAmount, walletRefundAmount, gatewayRefundAmount, gatewayRefundId: "rfnd_s1" });
  return { payment, payout, rr, walletRefundAmount, gatewayRefundAmount, refund: processedRefund("rfnd_s1", gatewayRefundAmount) };
};
const assertConverged = async ({ payment, payout, rr, walletRefundAmount, gatewayRefundAmount, refundAmount }) => {
  const p = dumpOne("Payment", payment._id);
  assert.equal(p.refundedAmount, refundAmount, "counters applied exactly once");
  assert.equal(p.walletRefundedAmount, walletRefundAmount);
  assert.equal(p.gatewayRefundedAmount, gatewayRefundAmount);
  assert.equal(dumpOne("RefundRequest", rr._id).refundState, "processed");
  if (walletRefundAmount > 0) {
    assert.equal(walletBalance(payment.userId), walletRefundAmount, "wallet credited exactly once");
    assert.equal(ledgerOf(payment._id).filter((l) => l.type === "wallet_credit").length, 1, "one wallet ledger entry");
  }
  assert.equal(ledgerOf(payment._id).filter((l) => l.type === "refund").length, gatewayRefundAmount > 0 ? 1 : 0, "one gateway ledger entry");
  const po = dumpOne("DoctorPayout", payout._id);
  assert.equal(po.refundAdjustments.length, 1, "earning adjusted exactly once");
  assert.equal(receipts().length, 1, "one receipt row");
  assert.equal(doctorNotices().length, 1, "one durable doctor earning notice, no patient data");
  assert.ok(!/patient@example\.test|Patient/.test(doctorNotices()[0].html), "the doctor notice carries amounts only");
};

// 1. happy path + duplicate webhook replay
await test("duplicate provider webhook replay applies every effect exactly once", async () => {
  const f = await splitFixture();
  assert.deepEqual(await settle(f.rr, f.refund), { settled: true });
  assert.deepEqual(await settle(f.rr, f.refund), { settled: true, replay: true });
  await assertConverged({ ...f, refundAmount: 500 });
});

// 2. concurrent webhook + reconciliation + second webhook on the same refund
await test("concurrent webhook/recovery callers: lock serialises, effects stay single", async () => {
  const f = await splitFixture();
  provider.refunds.set("rfnd_s1", f.refund);
  const results = await Promise.allSettled([settle(f.rr, f.refund), RC.reconcileRefundRequest(f.rr._id), settle(f.rr, f.refund, "retry")]);
  assert.ok(results.some((r) => r.status === "fulfilled"), "at least one caller finalises");
  for (const r of results.filter((x) => x.status === "rejected")) assert.equal(r.reason.statusCode, 409, "losers get a clean 409, not a double apply");
  // the losers retry after the winner (what a webhook redelivery does)
  await settle(f.rr, f.refund);
  await assertConverged({ ...f, refundAmount: 500 });
});

// 3. out-of-order events
await test("out-of-order provider events never regress a processed refund", async () => {
  const f = await splitFixture();
  await settle(f.rr, f.refund);
  const late = await settle(f.rr, { id: "rfnd_s1", status: "failed" });
  assert.deepEqual(late, { settled: true, replay: true });
  const latePending = await settle(f.rr, { id: "rfnd_s1", status: "pending" });
  assert.equal(latePending.replay, true);
  await assertConverged({ ...f, refundAmount: 500 });
  assert.equal(dumpOne("Payment", f.payment._id).refundStatus, "partial");
});

// 4. crash injection at every post-provider step, then production recovery
for (const point of ["wallet-credit", "ledger-write", "earning-apply", "receipt-enqueue", "refund-record-save"]) {
  await test(`crash at ${point} then reconcile converges with no duplicate effect`, async () => {
    const f = await splitFixture();
    provider.refunds.set("rfnd_s1", f.refund);
    H.crashAt(point);
    await assert.rejects(() => settle(f.rr, f.refund), /CRASH@/);
    assert.notEqual(dumpOne("RefundRequest", f.rr._id).refundState, "processed", "not terminal after the crash");
    assert.equal(dumpOne("Payment", f.payment._id).refundLockedAt, undefined, "lock released by the finally block");
    const recovered = await RC.reconcileRefundRequest(f.rr._id);
    assert.equal(recovered.settled, true);
    await assertConverged({ ...f, refundAmount: 500 });
    assert.equal(provider.refundCalls.length, 0, "recovery asks the provider; it never issues a second refund");
  });
}

// 5. earning over-reversal on replay (real defect fixed in this phase)
await test("replay after counters were saved does not treat a partial refund as the final one", async () => {
  const f = await splitFixture({ refundAmount: 700 }); // > 50%: previously replay looked "final"
  provider.refunds.set("rfnd_s1", f.refund);
  H.crashAt("earning-apply");
  await assert.rejects(() => settle(f.rr, f.refund), /CRASH@/);
  await RC.reconcileRefundRequest(f.rr._id);
  const po = dumpOne("DoctorPayout", f.payout._id);
  assert.equal(po.refundAdjustmentAmount, 490, "700 * 700/1000, not the whole 700 doctor share");
  assert.equal(po.status, "pending", "payout not cancelled by a partial refund");
});

// 6. wallet-only refund: crash after counters, replay must not double count
await test("wallet-only refund crash after counters is recoverable and counted once", async () => {
  const payment = await H.mkPayment({ walletAmount: 1000, gatewayAmount: 0 });
  await H.mkWallet(payment.userId, 0);
  const payout = await H.mkPayout(payment._id);
  const rr = await H.mkRefund(payment, { amount: 400, walletRefundAmount: 400, gatewayRefundAmount: 0, gatewayRefundId: undefined });
  H.crashAt("wallet-credit"); // counters are already saved when the wallet credit crashes
  await assert.rejects(() => RC.reconcileRefundRequest(rr._id), /CRASH@/);
  assert.equal(dumpOne("Payment", payment._id).refundedAmount, 400, "counters saved before the crash");
  const r = await RC.reconcileRefundRequest(rr._id);
  assert.equal(r.settled, true);
  const p = dumpOne("Payment", payment._id);
  assert.equal(p.refundedAmount, 400, "replay must not add the wallet amount again");
  assert.equal(p.walletRefundedAmount, 400);
  assert.equal(walletBalance(payment.userId), 400);
  assert.equal(ledgerOf(payment._id).filter((l) => l.type === "wallet_credit").length, 1);
  assert.equal(dumpOne("DoctorPayout", payout._id).refundAdjustments.length, 1);
  assert.deepEqual(await RC.reconcileRefundRequest(rr._id).catch((e) => e.statusCode), 409, "terminal request cannot be reconciled again");
});

// 7. wallet credit applied, ledger write crashed: replay must still post the ledger entry
await test("wallet credited but ledger write crashed: replay posts the missing ledger entry once", async () => {
  const f = await splitFixture();
  provider.refunds.set("rfnd_s1", f.refund);
  H.crashAt("ledger-write"); // first ledger call is the gateway entry, so wallet credit already happened
  await assert.rejects(() => settle(f.rr, f.refund), /CRASH@/);
  assert.equal(walletBalance(f.payment.userId), f.walletRefundAmount);
  await RC.reconcileRefundRequest(f.rr._id);
  await assertConverged({ ...f, refundAmount: 500 });
});

// 8. two equal wallet-only refunds must each get their own receipt
await test("two equal wallet-only refunds produce two receipt rows", async () => {
  const payment = await H.mkPayment({ walletAmount: 1000, gatewayAmount: 0 });
  await H.mkWallet(payment.userId, 0);
  const a = await H.mkRefund(payment, { amount: 200, walletRefundAmount: 200, gatewayRefundAmount: 0, gatewayRefundId: undefined });
  await RC.reconcileRefundRequest(a._id);
  const b = await H.mkRefund(payment, { amount: 200, walletRefundAmount: 200, gatewayRefundAmount: 0, gatewayRefundId: undefined });
  await RC.reconcileRefundRequest(b._id);
  assert.equal(receipts().length, 2, "receipt key must not collapse on equal amounts");
  assert.equal(dumpOne("Payment", payment._id).refundedAmount, 400);
});

// 9. ambiguous timeout: provider called once, request parked, never retried blindly
await test("ambiguous gateway timeout: one provider call, reconciliation_required, retry refused, evidence resolves it", async () => {
  const payment = await H.mkPayment({ walletAmount: 0, gatewayAmount: 1000 });
  await H.mkWallet(payment.userId);
  await H.mkPayout(payment._id);
  const rr = await M.RefundRequest.create({ paymentId: payment._id, requestedBy: payment.userId, amount: 400, reason: "cancelled", status: "pending", refundState: "pending_review" });
  provider.refundImpl = async (args) => {
    const refund = { id: "rfnd_amb", status: "processed", amount: 40000, notes: args.notes };
    provider.refunds.set(refund.id, refund); // provider ACCEPTED it ...
    throw new Error("socket hang up"); // ... but the response was lost
  };
  const approve = await H.callHandler(RC.approveRefundRequest, { params: { id: String(rr._id) } });
  assert.equal(approve.status, 502);
  assert.equal(approve.err.details?.code, "REFUND_RECONCILIATION_REQUIRED");
  assert.equal(provider.refundCalls.length, 1);
  let cur = dumpOne("RefundRequest", rr._id);
  assert.equal(cur.refundState, "reconciliation_required");
  assert.equal(dumpOne("Payment", payment._id).refundedAmount || 0, 0, "no money counted on an ambiguous outcome");
  const retry = await H.callHandler(RC.retryRefundRequest, { params: { id: String(rr._id) } });
  assert.equal(retry.status, 400, "a retry is refused while the outcome is unknown");
  assert.equal(provider.refundCalls.length, 1, "still exactly one provider refund call");
  const res = await RC.reconcileRefundRequest(rr._id); // provider list shows the refund via notes.refundRequestId
  assert.equal(res.settled, true);
  assert.equal(dumpOne("RefundRequest", rr._id).refundState, "processed");
  assert.equal(dumpOne("Payment", payment._id).refundedAmount, 400);
  assert.equal(provider.refundCalls.length, 1, "reconciliation never issues a second refund");
});

await test("provider lookup failure during reconciliation changes nothing (no false 'not created')", async () => {
  const payment = await H.mkPayment();
  const rr = await H.mkRefund(payment, { refundState: "reconciliation_required", gatewayRefundId: undefined });
  provider.listFails = true;
  await assert.rejects(() => RC.reconcileRefundRequest(rr._id), /provider list failed/);
  const cur = dumpOne("RefundRequest", rr._id);
  assert.equal(cur.refundState, "reconciliation_required");
  assert.equal(cur.status, "approved");
  provider.listFails = false; provider.refunds.clear(); // lookup succeeds and finds nothing => definitive
  const res = await RC.reconcileRefundRequest(rr._id);
  assert.equal(res.failed, true);
  assert.equal(dumpOne("RefundRequest", rr._id).refundState, "retry_required");
});

// 10. concurrent over-refund
await test("concurrent approvals of two requests exceeding the refundable amount: one provider refund, total never exceeds", async () => {
  const payment = await H.mkPayment({ walletAmount: 0, gatewayAmount: 1000 });
  await H.mkWallet(payment.userId); await H.mkPayout(payment._id);
  const mk = () => M.RefundRequest.create({ paymentId: payment._id, requestedBy: payment.userId, amount: 600, reason: "cancelled", status: "pending", refundState: "pending_review" });
  const [a, b] = [await mk(), await mk()];
  const out = await Promise.all([a, b].map((r) => H.callHandler(RC.approveRefundRequest, { params: { id: String(r._id) } })));
  const ok = out.filter((o) => o.status === 200);
  assert.equal(ok.length, 1, "exactly one approval moves money");
  assert.ok(out.some((o) => [400, 409].includes(o.status)), "the other is refused");
  assert.equal(provider.refundCalls.length, 1);
  assert.ok(dumpOne("Payment", payment._id).refundedAmount <= 1000);
  assert.equal(dumpOne("Payment", payment._id).refundedAmount, 600);
});

await test("multiple partial refunds up to the total, then one more is refused", async () => {
  const payment = await H.mkPayment({ walletAmount: 0, gatewayAmount: 1000 });
  await H.mkWallet(payment.userId); await H.mkPayout(payment._id);
  for (const amt of [400, 600]) {
    const rr = await M.RefundRequest.create({ paymentId: payment._id, requestedBy: payment.userId, amount: amt, reason: "cancelled", status: "pending", refundState: "pending_review" });
    assert.equal((await H.callHandler(RC.approveRefundRequest, { params: { id: String(rr._id) } })).status, 200);
  }
  const p = dumpOne("Payment", payment._id);
  assert.equal(p.refundedAmount, 1000); assert.equal(p.refundStatus, "full");
  const extra = await M.RefundRequest.create({ paymentId: payment._id, requestedBy: payment.userId, amount: 1, reason: "cancelled", status: "pending", refundState: "pending_review" });
  assert.equal((await H.callHandler(RC.approveRefundRequest, { params: { id: String(extra._id) } })).status, 400);
  assert.equal(provider.refundCalls.length, 2);
  const po = (await M.DoctorPayout.findOne({ paymentId: payment._id }).lean());
  assert.equal(po.refundAdjustmentAmount, 700, "final refund takes the exact remainder");
  assert.equal(po.status, "cancelled");
});

// 11. stale lock takeover + stale worker release
await test("stale refund lock is taken over and the ex-holder cannot release the new lock", async () => {
  const payment = await H.mkPayment();
  const stale = await acquireRefundLock(payment._id, { now: new Date(Date.now() - REFUND_LOCK_LEASE_MS - 1000) });
  await assert.rejects(() => acquireRefundLock(payment._id, { now: new Date(Date.now() - REFUND_LOCK_LEASE_MS + 5000) }), (e) => e.statusCode === 409);
  const fresh = await acquireRefundLock(payment._id);
  assert.equal((await releaseRefundLock(payment._id, stale)).released, false, "stale worker cannot free the newer lock");
  assert.ok(dumpOne("Payment", payment._id).refundLockedAt, "newer holder still holds it");
  assert.equal((await releaseRefundLock(payment._id, fresh)).released, true);
});

await test("a crashed holder's stale lock does not block webhook settlement", async () => {
  const f = await splitFixture();
  await M.Payment.updateOne({ _id: f.payment._id }, { $set: { refundLockedAt: new Date(Date.now() - REFUND_LOCK_LEASE_MS - 5000), refundLockToken: "dead-worker" } });
  assert.deepEqual(await settle(f.rr, f.refund), { settled: true });
  await assertConverged({ ...f, refundAmount: 500 });
});

// 12. out-of-band refunds
await test("out-of-band refund: duplicate id, over-refund and crash-before-receipt replay", async () => {
  const payment = await H.mkPayment({ walletAmount: 0, gatewayAmount: 1000 });
  await H.mkWallet(payment.userId); const payout = await H.mkPayout(payment._id);
  const oob = (id, rupees) => RC.settleOutOfBandGatewayRefund({ gatewayPaymentId: payment.paymentId, refund: processedRefund(id, rupees) });
  H.crashAt("receipt-enqueue");
  await assert.rejects(() => oob("rfnd_o1", 300), /CRASH@/);
  assert.equal(dumpOne("Payment", payment._id).refundedAmount, 300, "counters saved before the crash");
  assert.equal(receipts().length, 0);
  assert.deepEqual(await oob("rfnd_o1", 300), { settled: true, replay: true });
  assert.equal(receipts().length, 1, "replay re-enqueues the lost receipt");
  assert.deepEqual(await oob("rfnd_o1", 300), { settled: true, replay: true });
  assert.equal(receipts().length, 1);
  assert.equal(dumpOne("Payment", payment._id).refundedAmount, 300);
  const over = await oob("rfnd_o2", 800);
  assert.equal(over.settled, false); assert.equal(over.reason, "exceeds_refundable_amount");
  const p = dumpOne("Payment", payment._id);
  assert.equal(p.refundedAmount, 300, "an over-refund never mutates counters"); assert.equal(p.reconciliationState, "required");
  assert.equal(dumpOne("DoctorPayout", payout._id).refundAdjustments.length, 1);
});

// 13. notification failure is separate from the financial outcome
await test("receipt enqueue failure (non-duplicate) never blocks or reverts the refund", async () => {
  const f = await splitFixture();
  const orig = M.EmailDelivery.create;
  M.EmailDelivery.create = async () => { throw new Error("outbox store unavailable"); };
  try { assert.deepEqual(await settle(f.rr, f.refund), { settled: true }); } finally { M.EmailDelivery.create = orig; }
  assert.equal(dumpOne("RefundRequest", f.rr._id).refundState, "processed");
  assert.equal(dumpOne("Payment", f.payment._id).refundedAmount, 500);
  assert.equal(receipts().length, 0, "no receipt row; intent is logged, money outcome is unaffected");
});

console.log(`\n${n} refund failure-matrix scenarios passed`);

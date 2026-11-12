// Phase 03 completion: the remaining reconciliation classes. Part 1: pure classifiers (every certainty state).
// Part 2: the REAL paged finders + report builder on the in-memory model layer (read-only proof, bounded pages,
// filters). Aggregation-based finders (existing 6 classes, duplicate refund reference, production wallet-credit
// lookup) need real Mongo: tests/mongo/phase03.mongo.test.mjs, BLOCKED_EXTERNAL here.
import assert from "node:assert/strict";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x"; process.env.JWT_SECRET ||= "recon-secret-recon-secret-123456";
mongoose.set("bufferCommands", false);
const R = await import("../services/finance/walletReconciliationService.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { default: WalletRecharge } = await import("../models/WalletRecharge.js");
const { default: TransactionLedger } = await import("../models/TransactionLedger.js");
const { default: Payment } = await import("../models/Payment.js");
const { default: DoctorPayout } = await import("../models/DoctorPayout.js");
const { default: RefundRequest } = await import("../models/RefundRequest.js");
const { default: ReconciliationRecord } = await import("../models/ReconciliationRecord.js");
const { default: Wallet } = await import("../models/Wallet.js");
const { DISCREPANCY_CATEGORIES: C, CERTAINTY: K, PENDING_WINDOW_MS } = R;

const now = new Date("2026-10-17T10:00:00Z");
const old = new Date(now - PENDING_WINDOW_MS - 60000); const fresh = new Date(now - 60000);
let n = 0; const ok = (m) => { n += 1; console.log(`PASS: ${m}`); };
const one = (arr, ref) => arr.find((f) => f.id === R.buildDiscrepancyId({ category: arr[0].category, subjectId: arr[0].id, ref })) || arr[0];

// ---- recharge vs wallet vs ledger
{
  const rc = (status, updatedAt = old, amount = 500) => ({ _id: "rc1", userId: "u1", status, amount, gatewayOrderId: "o1", updatedAt });
  assert.equal(R.classifyRechargeLedger({ recharge: rc("posted"), ledger: { amount: 500 }, walletHasCredit: true, now }).length, 0, "healthy");
  assert.equal(R.classifyRechargeLedger({ recharge: rc("posted"), ledger: null, walletHasCredit: true, now })[0].certainty, K.CONFIRMED);
  assert.match(R.classifyRechargeLedger({ recharge: rc("posted"), ledger: null, walletHasCredit: true, now })[0].note, /no wallet_credit ledger row/);
  assert.match(R.classifyRechargeLedger({ recharge: rc("posted"), ledger: { amount: 500 }, walletHasCredit: false, now })[0].note, /no matching credit/);
  assert.equal(R.classifyRechargeLedger({ recharge: rc("posted"), ledger: null, walletHasCredit: false, now })[0].certainty, K.CONFIRMED);
  assert.match(R.classifyRechargeLedger({ recharge: rc("posted"), ledger: { amount: 400 }, walletHasCredit: true, now })[0].note, /amount differs/);
  assert.equal(R.classifyRechargeLedger({ recharge: rc("captured", fresh), ledger: null, walletHasCredit: false, now })[0].certainty, K.EXPECTED_PENDING);
  assert.equal(R.classifyRechargeLedger({ recharge: rc("captured", old), ledger: null, walletHasCredit: false, now })[0].certainty, K.MISSING_EVIDENCE);
  ok("recharge: credit without ledger, ledger without credit, amount mismatch, pending vs stale capture");
  assert.equal(R.classifyRechargeLedgerOrphan({ ledgerRow: { _id: "l", idempotencyKey: "wallet:recharge:x", amount: 5 }, recharge: null })[0].certainty, K.CONFIRMED);
  assert.match(R.classifyRechargeLedgerOrphan({ ledgerRow: { _id: "l", idempotencyKey: "k", amount: 5 }, recharge: { status: "failed", amount: 5 } })[0].note, /failed/);
  assert.equal(R.classifyRechargeLedgerOrphan({ ledgerRow: { _id: "l", idempotencyKey: "k", amount: 5 }, recharge: { status: "posted", amount: 5 } }).length, 0);
  ok("recharge: orphan ledger credit (no recharge / invalid status / amount)");
}
// ---- payment allocation
{
  const pay = (over = {}) => ({ _id: "p1", status: "completed", totalAmount: 1000, walletAmount: 300, gatewayAmount: 700, updatedAt: old, ...over });
  assert.equal(R.classifyPaymentAllocation({ payment: pay(), walletDebit: { amount: 300 }, captureLedger: { amount: 1000 }, now }).length, 0);
  assert.match(R.classifyPaymentAllocation({ payment: pay({ gatewayAmount: 600 }), walletDebit: { amount: 300 }, captureLedger: { amount: 1000 }, now })[0].note, /does not equal/);
  assert.equal(R.classifyPaymentAllocation({ payment: pay(), walletDebit: null, captureLedger: { amount: 1000 }, now })[0].certainty, K.CONFIRMED);
  assert.equal(R.classifyPaymentAllocation({ payment: pay({ updatedAt: fresh }), walletDebit: null, captureLedger: { amount: 1000 }, now })[0].certainty, K.EXPECTED_PENDING);
  assert.match(R.classifyPaymentAllocation({ payment: pay(), walletDebit: { amount: 250 }, captureLedger: { amount: 1000 }, now })[0].note, /differs from the payment's wallet/);
  assert.match(R.classifyPaymentAllocation({ payment: pay({ walletAmount: 0, gatewayAmount: 1000 }), walletDebit: { amount: 10 }, captureLedger: { amount: 1000 }, now })[0].note, /no wallet allocation/);
  assert.equal(R.classifyPaymentAllocation({ payment: pay(), walletDebit: { amount: 300 }, captureLedger: null, now })[0].certainty, K.MISSING_EVIDENCE);
  assert.match(R.classifyPaymentAllocation({ payment: pay(), walletDebit: { amount: 300 }, captureLedger: { amount: 900 }, now })[0].note, /Capture ledger amount/);
  assert.equal(R.classifyPaymentAllocation({ payment: pay({ status: "failed" }), walletDebit: null, captureLedger: null, now }).length, 0, "non-captured payments are out of scope");
  ok("payment allocation vs wallet debit / capture ledger (confirmed, missing evidence, pending)");
}
// ---- doctor earning
{
  const payment = (over = {}) => ({ _id: "p1", totalAmount: 1000, refundedAmount: 400, updatedAt: old, ...over });
  const payout = (over = {}) => ({ _id: "po1", paymentId: "p1", doctorAmount: 700, refundAdjustmentAmount: 0, refundAdjustments: [], ...over });
  assert.equal(R.classifyEarningReversal({ payment: payment({ refundedAmount: 0 }), payout: payout() , now }).length, 0);
  assert.equal(R.classifyEarningReversal({ payment: payment(), payout: null , now }).length, 0);
  assert.equal(R.classifyEarningReversal({ payment: payment(), payout: payout() , now })[0].certainty, K.CONFIRMED);
  assert.equal(R.classifyEarningReversal({ payment: payment({ updatedAt: fresh }), payout: payout() , now })[0].certainty, K.EXPECTED_PENDING);
  const adj = { refundKey: "gw:r1", doctorAdjustment: 280, platformAdjustment: 120 };
  assert.equal(R.classifyEarningReversal({ payment: payment(), payout: payout({ refundAdjustmentAmount: 280, refundAdjustments: [adj] }), ledgerKeys: new Set(["refund:earning:gw:r1"]) , now }).length, 0);
  assert.equal(R.classifyEarningReversal({ payment: payment(), payout: payout({ refundAdjustmentAmount: 280, refundAdjustments: [adj] }) , now })[0].certainty, K.MISSING_EVIDENCE);
  assert.match(R.classifyEarningReversal({ payment: payment({ refundedAmount: 1000 }), payout: payout({ refundAdjustmentAmount: 280, refundAdjustments: [adj] }), ledgerKeys: new Set(["refund:earning:gw:r1"]) , now })[0].note, /fully refunded/);
  ok("earning reversal missing / incomplete / ledger evidence missing / pending window");
  const base = { _id: "po1", paymentId: "p1", doctorAmount: 700, platformRefundAdjustmentAmount: 120, refundAdjustmentAmount: 280, refundAdjustments: [adj] };
  assert.equal(R.classifyEarningAdjustment({ payout: base, payment: { refundedAmount: 400 } }).length, 0);
  assert.match(R.classifyEarningAdjustment({ payout: { ...base, refundAdjustmentAmount: 300 }, payment: { refundedAmount: 400 } })[0].note, /Sum of doctor/);
  assert.ok(R.classifyEarningAdjustment({ payout: { ...base, refundAdjustmentAmount: 800, refundAdjustments: [{ ...adj, doctorAdjustment: 800 }] }, payment: { refundedAmount: 400 } }).some((f) => /More has been reversed/.test(f.note)));
  assert.ok(R.classifyEarningAdjustment({ payout: { ...base, refundAdjustments: [adj, adj], refundAdjustmentAmount: 560, platformRefundAdjustmentAmount: 240 }, payment: { refundedAmount: 400 } }).some((f) => /more than once/.test(f.note)));
  assert.match(R.classifyEarningAdjustment({ payout: base, payment: { refundedAmount: 0 } })[0].note, /no refunded amount/);
  assert.match(R.classifyEarningAdjustment({ payout: base, payment: null })[0].note, /does not exist/);
  ok("earning adjustment inconsistencies (sum, over-reversal, duplicate key, no refund, missing payment)");
}
// ---- capture evidence, stale ops, references
{
  const pay = { _id: "p1" };
  assert.equal(R.classifyCaptureEvidence({ payment: pay, evidence: { gatewayPaymentId: "g", disposition: "duplicate_capture" } })[0].certainty, K.CONFIRMED);
  assert.equal(R.classifyCaptureEvidence({ payment: pay, evidence: { gatewayPaymentId: "g", disposition: "duplicate_capture", resolution: { state: "insufficient_evidence" } } })[0].certainty, K.MISSING_EVIDENCE);
  assert.equal(R.classifyCaptureEvidence({ payment: pay, evidence: { gatewayPaymentId: "g", disposition: "duplicate_capture", resolution: { state: "verified_no_action" } } }).length, 0, "resolved is not re-listed");
  assert.equal(R.classifyCaptureEvidence({ payment: pay, evidence: { gatewayPaymentId: "g", disposition: "duplicate_capture", resolution: { state: "refund_required" } } }).length, 0);
  ok("capture evidence: open/inconclusive listed, resolved excluded");
  const rr = (refundState, lastAttemptAt) => ({ _id: "r", paymentId: "p", refundState, lastAttemptAt, amount: 400 });
  assert.equal(R.classifyStaleRefund({ refundRequest: rr("gateway_processing", fresh), now })[0].certainty, K.EXPECTED_PENDING);
  assert.equal(R.classifyStaleRefund({ refundRequest: rr("gateway_processing", old), now })[0].certainty, K.MISSING_EVIDENCE);
  assert.match(R.classifyStaleRefund({ refundRequest: rr("reconciliation_required", fresh), now })[0].note, /never retry blindly/);
  assert.equal(R.classifyStaleRefund({ refundRequest: rr("processed", old), now }).length, 0);
  assert.equal(R.classifyStaleRecharge({ recharge: { _id: "x", userId: "u", status: "reconciliation_required" }, now })[0].certainty, K.CONFIRMED);
  assert.match(R.classifyStaleRecharge({ recharge: { _id: "x", userId: "u", status: "captured", recoveryAttempts: 8 }, now })[0].note, /exhausted/);
  assert.equal(R.classifyStaleRecharge({ recharge: { _id: "x", userId: "u", status: "posted", recoveryAttempts: 9 }, now }).length, 0);
  assert.equal(R.classifyStaleRecharge({ recharge: { _id: "x", userId: "u", status: "verification_pending", updatedAt: old }, now })[0].certainty, K.MISSING_EVIDENCE);
  assert.equal(R.classifyStalePayment({ payment: { _id: "p", status: "captured", reconciliationState: "required" }, now })[0].certainty, K.CONFIRMED);
  assert.equal(R.classifyStalePayment({ payment: { _id: "p", status: "post_processing", updatedAt: fresh }, now }).length, 0);
  assert.equal(R.classifyStalePayment({ payment: { _id: "p", status: "post_processing", updatedAt: old }, now })[0].certainty, K.MISSING_EVIDENCE);
  // legacy status lags the workflow state: paymentState wins
  assert.equal(R.classifyStalePayment({ payment: { _id: "p", status: "captured", paymentState: "post_processing", updatedAt: old }, now })[0].certainty, K.MISSING_EVIDENCE, "stuck is judged on paymentState, not the lagging status");
  assert.equal(R.classifyStalePayment({ payment: { _id: "p", status: "captured", paymentState: "post_processing_failed" }, now })[0].certainty, K.CONFIRMED);
  assert.equal(R.classifyPaymentAllocation({ payment: { _id: "p", status: "created", paymentState: "completed", totalAmount: 1000, walletAmount: 0, gatewayAmount: 700, updatedAt: old }, walletDebit: null, captureLedger: { amount: 1000 }, now })[0].note.includes("does not equal"), true, "capture is recognised from paymentState when status lags");
  ok("stale/exhausted refund, recharge and payment operations");
  const pr = { _id: "p", processedGatewayRefundIds: ["rf1", "rf9"], refundedAmount: 400, walletRefundedAmount: 0, gatewayRefundedAmount: 400 };
  const refs = R.classifyRefundReferences({ payment: pr, refundRequests: [{ _id: "a", status: "processed", gatewayRefundId: "rf1", gatewayRefundAmount: 400, amount: 400 }] });
  assert.deepEqual(refs.map((f) => f.certainty), [K.MISSING_EVIDENCE], "rf9 is counted but unreferenced (provider-initiated/legacy)");
  assert.ok(R.classifyRefundReferences({ payment: pr, refundRequests: [{ _id: "b", status: "processed", gatewayRefundId: "rf2", gatewayRefundAmount: 400, amount: 400 }] }).some((f) => f.certainty === K.CONFIRMED && /not counted/.test(f.note)));
  assert.ok(R.classifyRefundReferences({ payment: pr, refundRequests: [{ _id: "c", status: "processed", gatewayRefundAmount: 400, amount: 400 }] }).some((f) => /no gateway refund reference/.test(f.note)));
  assert.ok(R.classifyRefundReferences({ payment: { ...pr, gatewayRefundedAmount: 100 }, refundRequests: [{ _id: "a", status: "processed", gatewayRefundId: "rf1", gatewayRefundAmount: 400, amount: 400 }] }).some((f) => /does not equal refundedAmount/.test(f.note)));
  ok("contradictory refund references");
}

// ---- Part 2: real finders + builder on the memory layer
const mem = installMemoryModels([{ model: WalletRecharge }, { model: TransactionLedger }, { model: Payment }, { model: DoctorPayout }, { model: RefundRequest }, { model: ReconciliationRecord }, { model: Wallet }]);
const mkRecharge = (over = {}) => WalletRecharge.create({ userId: newId(), amount: 500, gatewayOrderId: `o_${newId()}`, status: "posted", ...over });
const credited = new Set();
R.reconciliationDeps.walletCreditRefs = async ({ refs }) => new Set(refs.filter((r) => credited.has(r)));
const report = (args) => R.buildWalletLedgerDiscrepancyReport({ now: new Date(), ...args });
const snapshot = () => JSON.stringify(["WalletRecharge", "TransactionLedger", "Payment", "DoctorPayout", "RefundRequest", "ReconciliationRecord", "Wallet"].map((m) => mem.dump(m)));
{
  const before = snapshot();
  const a = await mkRecharge(); credited.add(`recharge:${a._id}`);               // credit, no ledger => confirmed
  const b = await mkRecharge();                                                  // fully healthy
  credited.add(`recharge:${b._id}`);
  await TransactionLedger.create({ userId: b.userId, type: "wallet_credit", direction: "credit", amount: 500, status: "posted", referenceId: "x", idempotencyKey: `wallet:recharge:${b._id}` });
  await TransactionLedger.create({ userId: newId(), type: "wallet_credit", direction: "credit", amount: 99, status: "posted", referenceId: "y", idempotencyKey: `wallet:recharge:${newId()}` }); // orphan
  const mid = snapshot();
  const rep = await report({ category: C.RECHARGE_LEDGER_MISMATCH });
  assert.equal(rep.readOnly, true); assert.equal(rep.sections[C.RECHARGE_LEDGER_MISMATCH].items.length, 1);
  assert.equal(rep.sections[C.RECHARGE_LEDGER_MISMATCH].items[0].subject.rechargeId, String(a._id));
  assert.equal(rep.sections[C.RECHARGE_LEDGER_MISMATCH].total, 2, "total counts examined recharges");
  const orphans = await report({ category: C.RECHARGE_LEDGER_ORPHAN });
  assert.equal(orphans.sections[C.RECHARGE_LEDGER_ORPHAN].items.length, 1);
  assert.equal(snapshot(), mid, "the report is strictly read-only");
  assert.notEqual(before, mid);
  ok("finders: recharge mismatch + orphan on real service code; report writes nothing");
}
{
  // pagination bound + stable ids across pages
  for (let i = 0; i < 7; i += 1) { const r = await mkRecharge(); credited.add(`recharge:${r._id}`); }
  const p1 = await report({ category: C.RECHARGE_LEDGER_MISMATCH, page: 1, limit: 3 });
  const p2 = await report({ category: C.RECHARGE_LEDGER_MISMATCH, page: 2, limit: 3 });
  const ids = [...p1.sections[C.RECHARGE_LEDGER_MISMATCH].items, ...p2.sections[C.RECHARGE_LEDGER_MISMATCH].items].map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "no finding repeats across pages");
  assert.equal(p1.limit, 3); assert.equal((await report({ category: C.RECHARGE_LEDGER_MISMATCH, limit: 100000 })).limit, 100);
  const again = await report({ category: C.RECHARGE_LEDGER_MISMATCH, page: 1, limit: 3 });
  assert.deepEqual(again.sections[C.RECHARGE_LEDGER_MISMATCH].items.map((f) => f.id), p1.sections[C.RECHARGE_LEDGER_MISMATCH].items.map((f) => f.id), "deterministic ids");
  ok("bounded pagination (limit clamp, no overlap, deterministic ids)");
}
{
  // payment/earning/capture/stale/reference finders end-to-end
  const mkPay = (over = {}) => Payment.create({ userId: newId(), doctorId: newId(), appointmentId: newId(), amount: 1000, paymentId: `pay_${newId()}`, razorpayOrderId: `or_${newId()}`, totalAmount: 1000, status: "completed", walletAmount: 300, gatewayAmount: 700, createdAt: new Date(Date.now() - 3600e3), updatedAt: new Date(Date.now() - 3600e3), ...over });
  const bad = await mkPay();   // wallet allocation, no ledger rows at all
  const good = await mkPay();
  await TransactionLedger.create({ userId: good.userId, paymentId: good._id, type: "wallet_debit", direction: "debit", amount: 300, status: "posted", idempotencyKey: `wallet:debit:${good._id}` });
  await TransactionLedger.create({ userId: good.userId, paymentId: good._id, type: "payment", direction: "debit", amount: 1000, status: "posted", idempotencyKey: `payment:capture:${good._id}` });
  const alloc = await report({ category: C.PAYMENT_ALLOCATION_MISMATCH });
  const subj = alloc.sections[C.PAYMENT_ALLOCATION_MISMATCH].items.map((f) => f.subject.paymentId);
  assert.ok(subj.includes(String(bad._id))); assert.ok(!subj.includes(String(good._id)));
  const filtered = await report({ category: C.PAYMENT_ALLOCATION_MISMATCH, paymentId: String(bad._id) });
  assert.ok(filtered.sections[C.PAYMENT_ALLOCATION_MISMATCH].items.every((f) => f.subject.paymentId === String(bad._id)), "paymentId filter scopes the investigation");
  await assert.rejects(() => report({ paymentId: "not-an-id" }), (e) => e.statusCode === 400);
  await assert.rejects(() => report({ category: "nope" }), (e) => e.statusCode === 400);
  await assert.rejects(() => report({ certainty: "bogus" }), (e) => e.statusCode === 400);
  const onlyConfirmed = await report({ category: C.PAYMENT_ALLOCATION_MISMATCH, certainty: "confirmed" });
  assert.ok(onlyConfirmed.sections[C.PAYMENT_ALLOCATION_MISMATCH].items.every((f) => f.certainty === "confirmed"));
  ok("payment allocation finder + paymentId/certainty/category validation");

  const refunded = await mkPay({ refundedAmount: 400, status: "partially_refunded", processedGatewayRefundIds: ["rf1"], gatewayRefundedAmount: 400 });
  await DoctorPayout.create({ doctorId: newId(), appointmentId: newId(), paymentId: refunded._id, grossAmount: 1000, doctorAmount: 700, platformFee: 300, status: "pending" });
  const er = await report({ category: C.EARNING_REVERSAL_MISSING });
  assert.equal(er.sections[C.EARNING_REVERSAL_MISSING].items[0].subject.paymentId, String(refunded._id));
  assert.equal(er.sections[C.EARNING_REVERSAL_MISSING].items[0].certainty, "confirmed");
  await RefundRequest.create({ paymentId: refunded._id, requestedBy: newId(), amount: 400, reason: "x", status: "processed", gatewayRefundId: "rf1", gatewayRefundAmount: 400 });
  const refsRep = await report({ category: C.REFERENCE_INCONSISTENCY });
  assert.equal(refsRep.sections[C.REFERENCE_INCONSISTENCY].items.length, 0, "consistent references yield no finding");
  ok("earning reversal + reference finders");

  const cap = await mkPay({ captureEvidence: [{ gatewayPaymentId: "g1", disposition: "duplicate_capture", amountPaise: 100000 }, { gatewayPaymentId: "g2", disposition: "duplicate_capture", resolution: { state: "verified_no_action" } }] });
  const capRep = await report({ category: C.CAPTURE_CASE_OPEN, paymentId: String(cap._id) });
  assert.equal(capRep.sections[C.CAPTURE_CASE_OPEN].items.length, 1);
  assert.equal(capRep.sections[C.CAPTURE_CASE_OPEN].items[0].subject.gatewayPaymentId, "g1");
  await mkPay({ reconciliationState: "required", status: "captured" });
  assert.ok((await report({ category: C.STALE_PAYMENT })).sections[C.STALE_PAYMENT].items.length >= 1);
  await RefundRequest.create({ paymentId: refunded._id, requestedBy: newId(), amount: 50, reason: "x", status: "approved", refundState: "reconciliation_required" });
  assert.equal((await report({ category: C.STALE_REFUND })).sections[C.STALE_REFUND].items.length, 1);
  await mkRecharge({ status: "reconciliation_required" });
  assert.equal((await report({ category: C.STALE_RECHARGE })).sections[C.STALE_RECHARGE].items.length, 1);
  ok("capture case (resolved excluded), stale payment/refund/recharge finders");
}
console.log(`\n${n} reconciliation-class checks passed`);
process.exit(0);

// Phase 02 -- wallet recharge: replay-safe credit, crash windows, late capture, mismatches, recovery.
// LOCALLY_VERIFIED against the in-memory model layer (real filters/updates, interleaving). NOT real MongoDB.
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused";
process.env.JWT_SECRET ||= "phase02-test-secret";
mongoose.set("bufferCommands", false);

const { default: Wallet } = await import("../models/Wallet.js");
const { default: WalletRecharge } = await import("../models/WalletRecharge.js");
const { default: TransactionLedger } = await import("../models/TransactionLedger.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const R = await import("../payments/walletRechargeService.js");

const mem = installMemoryModels([
  { model: Wallet, unique: [{ fields: ["userId"] }] },
  { model: WalletRecharge, unique: [{ fields: ["gatewayOrderId"] }] },
  { model: TransactionLedger, unique: [{ fields: ["idempotencyKey"], when: (o) => typeof o.idempotencyKey === "string" }] },
]);
let seq = 0; let n = 0;
const check = async (name, fn) => { mem.reset?.(); await fn(); console.log(`  ok   ${name}`); n += 1; };
const setup = async ({ amount = 500, status = "order_created", balance = 0, ...over } = {}) => {
  const userId = newId();
  await Wallet.create({ userId, balance });
  const recharge = await WalletRecharge.create({ userId, amount, currency: "INR", gatewayOrderId: `order_${++seq}`, status, createdAt: new Date(0), updatedAt: new Date(0), ...over });
  return { userId, recharge };
};
const wallet = (userId) => Wallet.findOne({ userId }).lean();
const credits = async (userId) => (await wallet(userId)).transactions.filter((t) => t.referenceType === "recharge").length;
const ledgers = (rechargeId) => TransactionLedger.find({ idempotencyKey: R.rechargeLedgerKey(rechargeId) }).lean();
const entity = (recharge, over = {}) => ({ id: "pay_1", order_id: recharge.gatewayOrderId, status: "captured", amount: Math.round(recharge.amount * 100), currency: "INR", ...over });
const crashOnce = (Model, method, predicate) => {
  const original = Model[method].bind(Model); let armed = true;
  Model[method] = (...args) => { if (armed && predicate(...args)) { armed = false; return Promise.reject(new Error(`injected crash in ${method}`)); } return original(...args); };
  return () => { Model[method] = original; };
};

await check("captured recharge credits once; replay returns the same result with no second credit", async () => {
  const { userId, recharge } = await setup();
  const first = await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "patient" });
  assert.equal(first.recharge.status, "posted");
  const again = await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" });
  assert.equal(again.recharge.status, "posted");
  assert.equal((await wallet(userId)).balance, 500); assert.equal(await credits(userId), 1); assert.equal((await ledgers(recharge._id)).length, 1);
});
await check("webhook racing browser verification and recovery: concurrent credit attempts credit exactly once", async () => {
  const { userId, recharge } = await setup();
  await Promise.all([1, 2, 3, 4, 5].map((i) => R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: ["patient", "webhook", "recovery"][i % 3] })));
  assert.equal((await wallet(userId)).balance, 500); assert.equal(await credits(userId), 1); assert.equal((await ledgers(recharge._id)).length, 1);
});
await check("crash after wallet credit but before ledger: replay posts the ledger and never credits twice", async () => {
  const { userId, recharge } = await setup();
  const undo = crashOnce(TransactionLedger, "create", () => true);
  await assert.rejects(R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" }));
  undo();
  assert.equal((await wallet(userId)).balance, 500, "wallet effect exists first");
  assert.equal((await ledgers(recharge._id)).length, 0, "no success-only ledger row preceded the wallet effect");
  assert.equal((await WalletRecharge.findById(recharge._id).lean()).status, "captured");
  const out = await R.recoverStuckWalletRecharges({ now: new Date(Date.now() + 10 * 60_000) });
  assert.equal(out[0].outcome, "posted");
  assert.equal((await wallet(userId)).balance, 500); assert.equal(await credits(userId), 1); assert.equal((await ledgers(recharge._id)).length, 1);
});
await check("crash after ledger but before posted: replay completes without a duplicate ledger or credit", async () => {
  const { userId, recharge } = await setup();
  const undo = crashOnce(WalletRecharge, "findOneAndUpdate", (f, u) => u?.$set?.status === "posted");
  await assert.rejects(R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "patient" }));
  undo();
  const replay = await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "recovery" });
  assert.equal(replay.recharge.status, "posted");
  assert.equal((await wallet(userId)).balance, 500); assert.equal((await ledgers(recharge._id)).length, 1);
});
await check("incorrect amount, currency, or order is never credited and is routed to reconciliation", async () => {
  for (const over of [{ amount: 100 }, { currency: "USD" }, { amount: undefined }, { currency: undefined }]) {
    const { userId, recharge } = await setup();
    const out = await R.settleRechargeFromProviderPayment({ recharge, entity: entity(recharge, over), source: "webhook" });
    assert.equal(out.outcome, "mismatch", JSON.stringify(over));
    assert.equal((await wallet(userId)).balance, 0);
    assert.equal((await WalletRecharge.findById(recharge._id).lean()).status, "reconciliation_required");
  }
  const { userId, recharge } = await setup();
  assert.equal((await R.settleRechargeFromProviderPayment({ recharge, entity: entity(recharge, { order_id: "order_other" }), source: "webhook" })).outcome, "order_mismatch");
  assert.equal((await wallet(userId)).balance, 0);
});
await check("failed or pending recharge never credits; late capture after failure IS credited exactly once", async () => {
  const { userId, recharge } = await setup();
  assert.equal((await R.settleRechargeFromProviderPayment({ recharge, entity: entity(recharge, { status: "failed" }), source: "webhook" })).outcome, "failed");
  assert.equal((await R.settleRechargeFromProviderPayment({ recharge, entity: entity(recharge, { status: "authorized" }), source: "webhook" })).outcome, "still_pending");
  assert.equal((await wallet(userId)).balance, 0);
  const late = await R.settleRechargeFromProviderPayment({ recharge: await WalletRecharge.findById(recharge._id), entity: entity(recharge), source: "webhook" });
  assert.equal(late.outcome, "credited");
  await R.settleRechargeFromProviderPayment({ recharge, entity: entity(recharge), source: "recovery" });
  assert.equal((await wallet(userId)).balance, 500); assert.equal(await credits(userId), 1);
});
await check("a later payment.failed never downgrades a captured/posted recharge", async () => {
  const { userId, recharge } = await setup();
  await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" });
  assert.equal((await R.settleRechargeFromProviderPayment({ recharge, entity: entity(recharge, { status: "failed" }), source: "webhook" })).outcome, "ignored_not_open");
  assert.equal((await WalletRecharge.findById(recharge._id).lean()).status, "posted");
  assert.equal((await wallet(userId)).balance, 500);
});
await check("a second, different provider payment for the same order is evidence only (no second credit)", async () => {
  const { userId, recharge } = await setup();
  await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" });
  const dup = await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_2", source: "webhook" });
  assert.equal(dup.duplicateCapture, true);
  const row = await WalletRecharge.findById(recharge._id).lean();
  assert.equal(row.duplicateCaptures.length, 1); assert.equal(row.reconciliationState, "required");
  assert.equal((await wallet(userId)).balance, 500);
});
await check("stale wallet document: credit is applied with $inc, so a newer balance is never overwritten", async () => {
  const { userId, recharge } = await setup({ balance: 100 });
  const stale = await wallet(userId);
  await Wallet.updateOne({ userId }, { $inc: { balance: 50 } }); // concurrent change after `stale` was read
  await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" });
  assert.equal(stale.balance, 100);
  assert.equal((await wallet(userId)).balance, 650);
});
await check("repeated recovery is bounded and observable; a posted recharge is never touched again", async () => {
  const { recharge } = await setup({ status: "pending", gatewayPaymentId: "pay_1" });
  let calls = 0;
  const fetchPayment = async () => { calls += 1; throw new Error("provider down"); };
  let now = Date.now();
  for (let i = 0; i < 12; i += 1) { now += 2 * 60 * 60 * 1000; await R.recoverStuckWalletRecharges({ now: new Date(now), fetchPayment }); }
  const row = await WalletRecharge.findById(recharge._id).lean();
  assert.equal(row.recoveryAttempts, R.MAX_RECHARGE_RECOVERY_ATTEMPTS); assert.equal(calls, R.MAX_RECHARGE_RECOVERY_ATTEMPTS);
  assert.match(row.lastRecoveryError, /provider down/);
});
await check("recovery settles a pending recharge from authoritative provider state (captured -> credited once)", async () => {
  const { userId, recharge } = await setup({ status: "verification_pending", gatewayPaymentId: "pay_1" });
  const fetchPayment = async () => ({ order_id: recharge.gatewayOrderId, status: "captured", amount: 50000, currency: "INR" });
  const now = new Date(Date.now() + 10 * 60_000);
  await R.recoverStuckWalletRecharges({ now, fetchPayment });
  await R.recoverStuckWalletRecharges({ now: new Date(now.getTime() + 3 * 3600_000), fetchPayment });
  assert.equal((await wallet(userId)).balance, 500); assert.equal(await credits(userId), 1);
});
await check("REGRESSION: a stale in-memory recharge can no longer overwrite a concurrent capture (verify/cancel/status paths)", async () => {
  const { userId, recharge } = await setup();
  const stale = await WalletRecharge.findById(recharge._id); // loaded while still order_created
  await R.postRechargeCapture(recharge, { gatewayPaymentId: "pay_1", source: "webhook" }); // concurrent webhook posts it
  stale.status = "pending"; stale.stateHistory.push({ from: "order_created", to: "pending", source: "gateway", at: new Date() });
  assert.equal(await R.persistRechargeGuarded(stale, { set: { gatewayPaymentId: "pay_stale" } }), null, "guarded write is skipped");
  assert.equal(await R.flagRecharge(stale, "late mismatch", { gatewayPaymentId: "pay_stale" }).then((r) => r.outcome), "mismatch");
  const row = await WalletRecharge.findById(recharge._id).lean();
  assert.equal(row.status, "posted"); assert.equal(row.gatewayPaymentId, "pay_1"); assert.equal(row.reconciliationState, "matched");
  assert.equal((await wallet(userId)).balance, 500);
});
console.log(`walletRechargeIdempotency: ${n} checks passed (LOCALLY_VERIFIED; in-memory model layer, NOT real MongoDB)`);
process.exit(0);

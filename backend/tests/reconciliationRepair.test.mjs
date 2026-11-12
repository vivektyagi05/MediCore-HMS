import assert from "node:assert/strict";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x"; process.env.JWT_SECRET ||= "repair-secret-repair-secret-123456";
mongoose.set("bufferCommands", false);
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { default: WalletRecharge } = await import("../models/WalletRecharge.js");
const { default: Wallet } = await import("../models/Wallet.js");
const { default: TransactionLedger } = await import("../models/TransactionLedger.js");
const { backfillRechargeLedger } = await import("../payments/reconciliationRepair.js");
const { rechargeRef, rechargeLedgerKey } = await import("../payments/walletRechargeService.js");
const mem = installMemoryModels([{ model: WalletRecharge }, { model: Wallet, unique: [{ fields: ["userId"] }] }, { model: TransactionLedger, unique: [{ fields: ["idempotencyKey"], when: (o) => typeof o.idempotencyKey === "string" }] }]);
const admin = { _id: newId(), role: "super_admin" }; const reason = "Ledger row lost in the 16 Oct crash; wallet credit verified";
const logs = []; const audit = async (e) => { logs.push(e); };
let n = 0; const test = async (name, fn) => { mem.reset(); logs.length = 0; await fn(); n += 1; console.log(`PASS: ${name}`); };
const fixture = async ({ status = "posted", credit = true, amount = 500, creditAmount = 500 } = {}) => {
  const userId = newId(); const r = await WalletRecharge.create({ userId, amount, gatewayOrderId: `o_${newId()}`, gatewayPaymentId: "pay_1", status });
  await Wallet.create({ userId, balance: credit ? creditAmount : 0, transactions: credit ? [{ type: "credit", amount: creditAmount, status: "completed", referenceType: "recharge", referenceId: rechargeRef(r._id) }] : [] });
  return r;
};
const walletOf = (r) => mem.dump("Wallet").find((w) => String(w.userId) === String(r.userId));

await test("repairs exactly the missing ledger row, changes nothing else, audits before/after + reason", async () => {
  const r = await fixture(); const balBefore = walletOf(r).balance;
  const out = await backfillRechargeLedger({ actor: admin, rechargeId: r._id, reason, audit });
  assert.equal(out.repaired, true); assert.deepEqual(out.before, { ledgerRowPresent: false, walletCreditPresent: true });
  const rows = mem.dump("TransactionLedger"); assert.equal(rows.length, 1);
  assert.equal(rows[0].idempotencyKey, rechargeLedgerKey(r._id)); assert.equal(rows[0].amount, 500); assert.equal(rows[0].metadata.backfilled, true);
  assert.equal(walletOf(r).balance, balBefore, "never alters a balance"); assert.equal(mem.dump("WalletRecharge")[0].status, "posted");
  assert.equal(logs.length, 1); assert.equal(logs[0].metadata.reason, reason); assert.equal(logs[0].metadata.before.ledgerRowPresent, false); assert.equal(logs[0].metadata.after.ledgerRowPresent, true);
});
await test("idempotent: double click and concurrent runs create one row", async () => {
  const r = await fixture();
  const res = await Promise.allSettled([1, 2, 3].map(() => backfillRechargeLedger({ actor: admin, rechargeId: r._id, reason, audit })));
  assert.equal(res.filter((x) => x.status === "fulfilled" && x.value.repaired).length, 1);
  assert.equal(mem.dump("TransactionLedger").length, 1);
  assert.equal((await backfillRechargeLedger({ actor: admin, rechargeId: r._id, reason, audit })).reason, "already_present");
});
await test("refuses without evidence: no wallet credit, amount mismatch, non-posted recharge", async () => {
  const none = await fixture({ credit: false });
  await assert.rejects(() => backfillRechargeLedger({ actor: admin, rechargeId: none._id, reason, audit }), (e) => e.details?.code === "REPAIR_EVIDENCE_MISSING");
  const diff = await fixture({ creditAmount: 400 });
  await assert.rejects(() => backfillRechargeLedger({ actor: admin, rechargeId: diff._id, reason, audit }), (e) => e.details?.code === "REPAIR_EVIDENCE_MISMATCH");
  const cap = await fixture({ status: "captured" });
  await assert.rejects(() => backfillRechargeLedger({ actor: admin, rechargeId: cap._id, reason, audit }), (e) => e.details?.code === "REPAIR_NOT_APPLICABLE");
  assert.equal(mem.dump("TransactionLedger").length, 0); assert.equal(logs.length, 0);
});
await test("authorization and reason are enforced before any read", async () => {
  const r = await fixture();
  await assert.rejects(() => backfillRechargeLedger({ actor: { _id: newId(), role: "doctor" }, rechargeId: r._id, reason, audit }), (e) => e.statusCode === 403);
  await assert.rejects(() => backfillRechargeLedger({ actor: { _id: newId(), role: "admin" }, rechargeId: r._id, reason, audit }), (e) => e.statusCode === 403);
  await assert.rejects(() => backfillRechargeLedger({ actor: admin, rechargeId: r._id, reason: "short", audit }), (e) => e.details?.code === "REASON_REQUIRED");
  await assert.rejects(() => backfillRechargeLedger({ actor: admin, rechargeId: newId(), reason, audit }), (e) => e.statusCode === 404);
  assert.equal(mem.dump("TransactionLedger").length, 0);
});
console.log(`\n${n} reconciliation repair scenarios passed`); process.exit(0);

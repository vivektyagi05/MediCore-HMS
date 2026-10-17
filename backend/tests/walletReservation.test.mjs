// Phase 02 -- wallet reservation service: orchestration, idempotency, crash windows, recovery.
// In-memory store (atomic primitives). LOCALLY_VERIFIED only; DB invariants are in tests/mongo/phase02.mongo.test.mjs.
import assert from "node:assert/strict";
import {
  walletReservationDeps as deps, reserveWalletFunds, commitWalletReservation, releaseWalletReservation,
  getAvailableBalancePaise, recoverWalletReservations, paymentAllowsRelease, adminResolveReservation, HOLDING_STALE_MS,
} from "../payments/walletReservationService.js";
import { createMemoryStore, injectFailure } from "./helpers/walletMemoryStore.mjs";

let n = 0;
const check = async (name, fn) => { deps.store = createMemoryStore({ balances: { u1: 100, u2: 100 } }); await fn(deps.store); console.log(`PASS: ${name}`); n += 1; };
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const later = () => new Date(Date.now() + HOLDING_STALE_MS + 60_000);
const stale = (st, id) => { st.reservations.get(id).updatedAt = new Date(0); };

await check("insufficient balance is rejected and holds nothing", async (st) => {
  assert.equal(await code(reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 100.01 })), "WALLET_INSUFFICIENT");
  assert.equal(await getAvailableBalancePaise("u1"), 10000);
  assert.equal(st.wallets.get("u1").holds.length, 0);
});
await check("exact-balance reservation succeeds; available becomes zero", async () => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 100 });
  assert.equal(await getAvailableBalancePaise("u1"), 0);
});
await check("two concurrent reservations cannot spend the same funds", async (st) => {
  const r = await Promise.allSettled([reserveWalletFunds({ userId: "u1", paymentId: "a", amount: 60 }), reserveWalletFunds({ userId: "u1", paymentId: "b", amount: 60 })]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(st.wallets.get("u1").holds.length, 1);
});
await check("duplicate reserve returns the same reservation and holds once; amount change conflicts", async (st) => {
  const a = await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  const b = await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  assert.equal(a.reservation._id, b.reservation._id); assert.equal(b.created, false);
  assert.equal(st.wallets.get("u1").holds.length, 1);
  assert.equal(await code(reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 50 })), "RESERVATION_CONFLICT");
});
await check("commit debits exactly once; concurrent duplicate commit is a replay", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  const [c1, c2] = await Promise.all([commitWalletReservation({ paymentId: "p1" }), commitWalletReservation({ paymentId: "p1" })]);
  assert.ok(c1.committed && c2.committed);
  const w = st.wallets.get("u1"); assert.equal(w.balance, 60); assert.equal(w.holds.length, 0); assert.equal(w.transactions.length, 1);
});
await check("duplicate release is idempotent and returns funds", async () => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  assert.equal((await releaseWalletReservation({ paymentId: "p1" })).released, true);
  assert.equal((await releaseWalletReservation({ paymentId: "p1" })).outcome, "already_released");
  assert.equal(await getAvailableBalancePaise("u1"), 10000);
});
await check("commit after release is refused and never debits", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  await releaseWalletReservation({ paymentId: "p1" });
  assert.equal(await code(commitWalletReservation({ paymentId: "p1" })), "RESERVATION_NOT_ACTIVE");
  assert.equal(st.wallets.get("u1").balance, 100);
});
await check("release after commit never returns funds", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  await commitWalletReservation({ paymentId: "p1" });
  assert.equal((await releaseWalletReservation({ paymentId: "p1" })).outcome, "already_committed");
  assert.equal(st.wallets.get("u1").balance, 60);
});
await check("release racing commit: exactly one effect wins", async () => {
  for (let i = 0; i < 20; i += 1) {
    deps.store = createMemoryStore({ balances: { u1: 100 } });
    await reserveWalletFunds({ userId: "u1", paymentId: "p", amount: 40 });
    await Promise.allSettled([commitWalletReservation({ paymentId: "p" }), releaseWalletReservation({ paymentId: "p" })]);
    const w = deps.store.wallets.get("u1"); const r = deps.store.reservations.get("p");
    assert.equal(w.holds.length, 0);
    assert.ok((r.status === "committed" && w.balance === 60) || (r.status === "released" && w.balance === 100), `${r.status}/${w.balance}`);
  }
});
await check("ownership: another user cannot commit or release someone else's reservation", async () => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 40 });
  assert.equal(await code(commitWalletReservation({ paymentId: "p1", userId: "u2" })), "RESERVATION_FORBIDDEN");
  assert.equal(await code(releaseWalletReservation({ paymentId: "p1", userId: "u2" })), "RESERVATION_FORBIDDEN");
});
await check("crash after hold applied (before record confirmed): retry completes without a second hold", async (st) => {
  const undo = injectFailure(st, "casReservation", { onCall: 1, phase: "before" });
  await assert.rejects(reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 }));
  undo();
  assert.equal(st.wallets.get("u1").holds.length, 1);
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 });
  assert.equal(st.wallets.get("u1").holds.length, 1); assert.equal(st.reservations.get("p1").status, "reserved");
});
await check("crash after wallet commit (before record): replay records committed without a second debit", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 });
  const undo = injectFailure(st, "commitHold", { phase: "after" });
  await assert.rejects(commitWalletReservation({ paymentId: "p1" }));
  undo();
  const r = await commitWalletReservation({ paymentId: "p1" });
  assert.ok(r.committed && r.replay);
  assert.equal(st.wallets.get("u1").balance, 70); assert.equal(st.wallets.get("u1").transactions.length, 1);
});
await check("recovery: stale 'holding' (crash before hold) is completed idempotently", async (st) => {
  const undo = injectFailure(st, "holdFunds", { phase: "before" });
  await assert.rejects(reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 }));
  undo();
  const out = await recoverWalletReservations({ now: later(), loadPayment: async () => ({ paymentState: "created", status: "created", activeAppointmentSlot: true }) });
  assert.equal(out[0].action, "hold_completed"); assert.equal(st.wallets.get("u1").holds.length, 1);
});
await check("recovery: reservation older than any timer is NOT released while the payment is still payable", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 }); stale(st, "p1");
  const out = await recoverWalletReservations({ now: later(), loadPayment: async () => ({ paymentState: "pending", status: "created", activeAppointmentSlot: true }) });
  assert.equal(out[0].action, "left_alone"); assert.equal(st.wallets.get("u1").holds.length, 1);
});
await check("release safety: ambiguous/captured/provider-referenced payments are never releasable", async () => {
  for (const over of [{ paymentState: "verification_pending" }, { paymentState: "cancelled", gatewayPaymentId: "pay_x" }, { paymentState: "cancelled", reconciliationState: "required" }, { paymentState: "captured" }, { paymentState: "authorized" }]) {
    assert.equal(paymentAllowsRelease({ status: "created", ...over }).ok, false, JSON.stringify(over));
  }
  assert.equal(paymentAllowsRelease({ status: "cancelled", paymentState: "cancelled" }).ok, true);
  assert.equal(paymentAllowsRelease({ status: "failed", paymentState: "failed" }).ok, true);
  assert.equal(paymentAllowsRelease({ status: "failed", paymentState: "failed", activeAppointmentSlot: true }).ok, false);
});
await check("recovery: cancelled payment without capture releases; captured payment commits", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "a", amount: 30 });
  await reserveWalletFunds({ userId: "u2", paymentId: "b", amount: 30 });
  stale(st, "a"); stale(st, "b");
  const out = await recoverWalletReservations({ now: later(), loadPayment: async (id) => ({ paymentState: id === "a" ? "cancelled" : "captured", status: id === "a" ? "cancelled" : "captured" }) });
  assert.deepEqual(out.map((o) => o.action).sort(), ["committed", "released"]);
  assert.equal(st.wallets.get("u1").balance, 100); assert.equal(st.wallets.get("u2").balance, 70);
});
await check("stale recovery worker cannot overwrite a newer state (fenced lease)", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 });
  const r = st.reservations.get("p1"); stale(st, "p1");
  const now = later();
  const a = await st.claimRecoveryLease({ id: r._id, owner: "A", now, leaseMs: 1000, statuses: ["reserved"] });
  const b = await st.claimRecoveryLease({ id: r._id, owner: "B", now, leaseMs: 1000, statuses: ["reserved"] });
  assert.ok(a && !b);
  assert.equal(await st.casReservation({ id: r._id, from: ["reserved"], to: "released", leaseOwner: "B" }), null);
  assert.equal(r.status, "reserved");
});
await check("recovery retries are bounded and escalate to recovery_required", async (st) => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 });
  const r = st.reservations.get("p1"); stale(st, "p1"); r.recoveryAttempts = 5;
  const out = await recoverWalletReservations({ now: later(), loadPayment: async () => { throw new Error("db down"); } });
  assert.equal(out[0].action, "escalated"); assert.equal(r.status, "recovery_required");
});
await check("admin resolution: super_admin only, reason required, only flagged reservations", async () => {
  await reserveWalletFunds({ userId: "u1", paymentId: "p1", amount: 30 });
  assert.equal(await code(adminResolveReservation({ actor: { role: "doctor" }, paymentId: "p1", action: "release", reason: "long enough reason" })), "RESERVATION_FORBIDDEN");
  assert.equal(await code(adminResolveReservation({ actor: { role: "super_admin" }, paymentId: "p1", action: "release", reason: "short" })), "REASON_REQUIRED");
  assert.equal(await code(adminResolveReservation({ actor: { role: "super_admin" }, paymentId: "p1", action: "release", reason: "long enough reason" })), "RESERVATION_STATE_STALE");
});
console.log(`walletReservation: ${n} checks passed`);
process.exit(0);

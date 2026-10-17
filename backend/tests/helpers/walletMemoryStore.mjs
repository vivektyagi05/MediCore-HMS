// In-memory implementation of walletReservationStore. Each primitive's body is
// synchronous, so it is atomic exactly like the single-document Mongo update it
// models. This proves ORCHESTRATION (idempotency, crash windows, recovery) --
// it is NOT evidence about MongoDB itself (see tests/mongo/phase02.mongo.test.mjs).
import mongoose from "mongoose";
let seq = 0;
const oidHex = () => new mongoose.Types.ObjectId().toString();
export const makeId = () => `id${++seq}`;
const s = (v) => String(v);
const clone = (o) => (o ? JSON.parse(JSON.stringify(o), (k, v) => (/At$|Until$/.test(k) && typeof v === "string" ? new Date(v) : v)) : o);

export const createMemoryStore = ({ balances = {} } = {}) => {
  const wallets = new Map();
  const reservations = new Map();
  const mk = (userId, balance = 0) => { const w = { _id: oidHex(), userId, balance, holds: [], transactions: [] }; wallets.set(s(userId), w); return w; };
  Object.entries(balances).forEach(([u, b]) => mk(u, b));
  const paise = (w) => Math.round(w.balance * 100);
  const held = (w) => w.holds.reduce((a, h) => a + h.amountPaise, 0);
  const byId = (id) => [...reservations.values()].find((x) => x._id === id);
  const store = {
    wallets, reservations,
    async ensureWallet(userId) { return clone(wallets.get(s(userId)) || mk(userId)); },
    async getWallet(userId) { return clone(wallets.get(s(userId))); },
    async holdFunds({ userId, reservationId, paymentId, amountPaise }) {
      const w = wallets.get(s(userId)); if (!w) return { outcome: "no_wallet" };
      if (w.holds.some((h) => h.reservationId === reservationId || s(h.paymentId) === s(paymentId))) return { outcome: "already_held", walletId: w._id };
      if (paise(w) - held(w) < amountPaise) return { outcome: "insufficient", walletId: w._id };
      w.holds.push({ reservationId, paymentId, amountPaise }); return { outcome: "held", walletId: w._id };
    },
    async commitHold({ userId, reservationId, paymentId, amountPaise }) {
      const w = wallets.get(s(userId)); if (!w) return { outcome: "not_held" };
      const i = w.holds.findIndex((h) => h.reservationId === reservationId && h.amountPaise === amountPaise);
      if (i >= 0) {
        if (paise(w) < amountPaise) return { outcome: "insufficient_at_commit", walletId: w._id };
        w.holds.splice(i, 1); w.balance = (paise(w) - amountPaise) / 100;
        w.transactions.push({ type: "payment", referenceType: "payment", referenceId: s(paymentId), amount: amountPaise / 100 });
        return { outcome: "committed", walletId: w._id };
      }
      return store.classifyMissingHold({ userId, reservationId, paymentId });
    },
    async dropHold({ userId, reservationId }) {
      const w = wallets.get(s(userId)); const i = w ? w.holds.findIndex((h) => h.reservationId === reservationId) : -1;
      if (i < 0) return { outcome: "not_held" };
      w.holds.splice(i, 1); return { outcome: "released", walletId: w._id };
    },
    async classifyMissingHold({ userId, reservationId, paymentId }) {
      const w = wallets.get(s(userId)); if (!w) return { outcome: "not_held" };
      if (w.holds.some((h) => h.reservationId === reservationId)) return { outcome: "insufficient_at_commit" };
      return w.transactions.some((t) => t.referenceId === s(paymentId)) ? { outcome: "already_committed" } : { outcome: "not_held" };
    },
    async hasCommittedDebit({ userId, paymentId }) { const w = wallets.get(s(userId)); return Boolean(w?.transactions.some((t) => t.referenceId === s(paymentId))); },
    async upsertReservation({ userId, walletId, paymentId, amountPaise, currency }) {
      if (!reservations.has(s(paymentId))) reservations.set(s(paymentId), { _id: makeId(), userId, walletId, paymentId, amountPaise, currency, status: "holding", recoveryAttempts: 0, updatedAt: new Date(0), stateHistory: [] });
      return clone(reservations.get(s(paymentId)));
    },
    async findReservation({ paymentId }) { return clone(reservations.get(s(paymentId))); },
    async casReservation({ id, from, to, set = {}, leaseOwner }) {
      const r = byId(id);
      if (!r || !from.includes(r.status) || (leaseOwner && r.leaseOwner !== leaseOwner)) return null;
      Object.assign(r, set, { status: to, updatedAt: new Date() }); r.stateHistory.push({ to }); return clone(r);
    },
    async patchReservation({ id, set, leaseOwner }) {
      const r = byId(id);
      if (!r || (leaseOwner && r.leaseOwner !== leaseOwner)) return null;
      Object.assign(r, set); return clone(r);
    },
    async claimRecoveryLease({ id, owner, now, leaseMs, statuses }) {
      const r = byId(id);
      if (!r || !statuses.includes(r.status) || (r.leaseUntil && r.leaseUntil > now)) return null;
      Object.assign(r, { leaseOwner: owner, leaseUntil: new Date(now.getTime() + leaseMs), recoveryAttempts: r.recoveryAttempts + 1 });
      return clone(r);
    },
    async listByStatus({ status, limit }) { return [...reservations.values()].filter((r) => r.status === status).slice(0, limit).map(clone); },
    async listRecoverable({ statuses, olderThan, now, limit }) {
      return [...reservations.values()].filter((r) => statuses.includes(r.status) && r.updatedAt < olderThan && (!r.nextRecoveryAt || r.nextRecoveryAt <= now)).slice(0, limit).map(clone);
    },
  };
  return store;
};

/** Make store method `name` throw on its nth call -- before the effect, or after it (a crash past the commit point). */
export const injectFailure = (store, name, { onCall = 1, phase = "after" } = {}) => {
  let calls = 0; const original = store[name].bind(store);
  store[name] = async (...args) => {
    calls += 1;
    if (calls === onCall && phase === "before") throw new Error(`injected crash before ${name}`);
    const result = await original(...args);
    if (calls === onCall && phase === "after") throw new Error(`injected crash after ${name}`);
    return result;
  };
  return () => { store[name] = original; };
};

// Phase 02 — the ONE wallet reservation service.
//
// Invariant: available = balance - sum(active holds). A hold is placed with ONE
// conditional single-document update on the Wallet (`holdFunds`), so two
// concurrent reservations can never both claim the same funds. Commit
// (hold -> posted debit) and release (hold dropped) are each ONE atomic wallet
// update keyed on the hold's presence, so a hold is consumed or released at
// most once no matter how many callers/workers race or replay. The
// WalletReservation document is the durable lifecycle record used for recovery.
//
// No transaction is held and no lock is taken while any gateway call happens:
// reservation is a short state change; the gateway is called afterwards.
//
// All DB access goes through `walletReservationStore` (a seam). Production uses
// the Mongo implementation below; tests substitute an in-memory store whose
// primitives have the same single-operation atomicity, which lets crash
// windows be exercised deterministically by failure injection.
import mongoose from "mongoose";
import Wallet from "../models/Wallet.js";
import WalletReservation, { WALLET_RESERVATION_STATUS as S, WALLET_RESERVATION_TRANSITIONS } from "../models/WalletReservation.js";
import { fromPaise, toPaise } from "./money.js";
import { AppError } from "../middleware/errorMiddleware.js";

export { S as WALLET_RESERVATION_STATUS };

const idStr = (v) => (v === undefined || v === null ? "" : String(v));
const paymentRef = (paymentId) => idStr(paymentId);

export class WalletReservationError extends AppError {
  constructor(message, status, code, extra = {}) { super(message, status, { code, ...extra }); this.code = code; }
}

export const isLegalReservationTransition = (from, to) => (WALLET_RESERVATION_TRANSITIONS[from] || []).includes(to);

// ----------------------------------------------------------------- Mongo store
const PAISE_BALANCE = { $round: [{ $multiply: ["$balance", 100] }, 0] };
const HELD_PAISE = { $sum: { $ifNull: ["$holds.amountPaise", []] } };

export const mongoStore = {
  async ensureWallet(userId) {
    try {
      return await Wallet.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, balance: 0, currency: "INR" } },
        { returnDocument: "after", upsert: true },
      ).lean();
    } catch (error) {
      if (error?.code === 11000) return Wallet.findOne({ userId }).lean(); // concurrent upsert
      throw error;
    }
  },
  async getWallet(userId) { return Wallet.findOne({ userId }).lean(); },

  /** ATOMIC: place the hold only if available funds cover it and it is not already held. */
  async holdFunds({ userId, reservationId, paymentId, amountPaise }) {
    const placed = await Wallet.findOneAndUpdate(
      {
        userId,
        "holds.reservationId": { $ne: reservationId },
        "holds.paymentId": { $ne: paymentId },
        $expr: { $gte: [{ $subtract: [PAISE_BALANCE, HELD_PAISE] }, amountPaise] },
      },
      { $push: { holds: { reservationId, paymentId, amountPaise, createdAt: new Date() } } },
      { returnDocument: "after" },
    ).lean();
    if (placed) return { outcome: "held", walletId: placed._id };
    const current = await Wallet.findOne({ userId }).lean();
    if (!current) return { outcome: "no_wallet" };
    if ((current.holds || []).some((h) => idStr(h.reservationId) === idStr(reservationId) || idStr(h.paymentId) === idStr(paymentId))) {
      return { outcome: "already_held", walletId: current._id };
    }
    return { outcome: "insufficient", walletId: current._id };
  },

  /** ATOMIC: consume the hold -> debit posted balance + record the wallet transaction. */
  async commitHold({ userId, reservationId, paymentId, amountPaise, currency }) {
    const wallet = await Wallet.findOneAndUpdate(
      {
        userId,
        holds: { $elemMatch: { reservationId, amountPaise } },
        $expr: { $gte: [PAISE_BALANCE, amountPaise] },
      },
      {
        $inc: { balance: -fromPaise(amountPaise) },
        $pull: { holds: { reservationId } },
        $push: {
          transactions: {
            type: "payment", amount: fromPaise(amountPaise), currency: currency || "INR", status: "completed",
            referenceType: "payment", referenceId: paymentRef(paymentId), description: "Wallet contribution for appointment payment",
          },
        },
      },
      { returnDocument: "after" },
    ).lean();
    if (wallet) return { outcome: "committed", walletId: wallet._id };
    return this.classifyMissingHold({ userId, reservationId, paymentId });
  },

  /** ATOMIC: drop the hold only. Never touches balance. */
  async dropHold({ userId, reservationId }) {
    const wallet = await Wallet.findOneAndUpdate(
      { userId, "holds.reservationId": reservationId },
      { $pull: { holds: { reservationId } } },
      { returnDocument: "after" },
    ).lean();
    return wallet ? { outcome: "released", walletId: wallet._id } : { outcome: "not_held" };
  },

  /** When a hold is absent: was it already committed (debit recorded), or is it gone/never placed? */
  async classifyMissingHold({ userId, reservationId, paymentId }) {
    const wallet = await Wallet.findOne({ userId }).lean();
    if (!wallet) return { outcome: "not_held" };
    if ((wallet.holds || []).some((h) => idStr(h.reservationId) === idStr(reservationId))) return { outcome: "insufficient_at_commit", walletId: wallet._id };
    const debited = (wallet.transactions || []).some((t) => t.referenceType === "payment" && t.referenceId === paymentRef(paymentId) && t.type === "payment");
    return debited ? { outcome: "already_committed", walletId: wallet._id } : { outcome: "not_held", walletId: wallet._id };
  },
  async hasCommittedDebit({ userId, paymentId }) {
    const wallet = await Wallet.findOne({ userId, transactions: { $elemMatch: { referenceType: "payment", referenceId: paymentRef(paymentId), type: "payment" } } }).select("_id").lean();
    return Boolean(wallet);
  },

  // ---- reservation record
  async upsertReservation({ userId, walletId, paymentId, amountPaise, currency }) {
    const now = new Date();
    try {
      const doc = await WalletReservation.findOneAndUpdate(
        { paymentId },
        { $setOnInsert: { userId, walletId, paymentId, amountPaise, currency, status: S.HOLDING, stateHistory: [{ from: null, to: S.HOLDING, source: "system", reason: "Reservation requested", at: now }] } },
        { returnDocument: "after", upsert: true },
      ).lean();
      return doc;
    } catch (error) {
      if (error?.code === 11000) return WalletReservation.findOne({ paymentId }).lean();
      throw error;
    }
  },
  async findReservation({ paymentId }) { return WalletReservation.findOne({ paymentId }).lean(); },
  /** ATOMIC compare-and-set on the record (and optional fence token). */
  async casReservation({ id, from, to, source = "system", reason = null, set = {}, actorId = null, leaseOwner = null }) {
    const filter = { _id: id, status: { $in: from } };
    if (leaseOwner) filter.leaseOwner = leaseOwner;
    return WalletReservation.findOneAndUpdate(
      filter,
      { $set: { status: to, ...set }, $push: { stateHistory: { to, source, reason, actorId, at: new Date() } } },
      { returnDocument: "after" },
    ).lean();
  },
  async patchReservation({ id, set, leaseOwner = null, inc = null }) {
    const filter = { _id: id };
    if (leaseOwner) filter.leaseOwner = leaseOwner;
    const update = { $set: set };
    if (inc) update.$inc = inc;
    return WalletReservation.findOneAndUpdate(filter, update, { returnDocument: "after" }).lean();
  },
  /** ATOMIC lease acquire for a recovery worker (fencing token = leaseOwner). */
  async claimRecoveryLease({ id, owner, now, leaseMs, statuses }) {
    return WalletReservation.findOneAndUpdate(
      { _id: id, status: { $in: statuses }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + leaseMs), lastRecoveryAt: now }, $inc: { recoveryAttempts: 1 } },
      { returnDocument: "after" },
    ).lean();
  },
  async listRecoverable({ statuses, olderThan, now, limit }) {
    return WalletReservation.find({
      status: { $in: statuses },
      updatedAt: { $lt: olderThan },
      $or: [{ nextRecoveryAt: { $exists: false } }, { nextRecoveryAt: null }, { nextRecoveryAt: { $lte: now } }],
    }).sort({ updatedAt: 1 }).limit(limit).lean();
  },
  async listByStatus({ status, limit }) { return WalletReservation.find({ status }).sort({ updatedAt: -1 }).limit(limit).lean(); },
  async newId() { return new mongoose.Types.ObjectId(); },
};

export const walletReservationDeps = { store: mongoStore };
const store = () => walletReservationDeps.store;

// -------------------------------------------------------------------- helpers
const err = (message, status, code, extra) => new WalletReservationError(message, status, code, extra);

const cas = (reservation, to, opts) => store().casReservation({ id: reservation._id, from: Object.entries(WALLET_RESERVATION_TRANSITIONS).filter(([, tos]) => tos.includes(to)).map(([f]) => f), to, ...opts });

/** Posted-balance minus active holds, in integer paise (never trusts a client value). */
export const getAvailableBalancePaise = async (userId) => {
  const wallet = await store().getWallet(userId);
  if (!wallet) return 0;
  const held = (wallet.holds || []).reduce((sum, h) => sum + Number(h.amountPaise || 0), 0);
  return Math.max(toPaise(wallet.balance || 0) - held, 0);
};

export const getWalletBalances = async (userId) => {
  const wallet = await store().getWallet(userId);
  const balancePaise = toPaise(wallet?.balance || 0);
  const heldPaise = (wallet?.holds || []).reduce((sum, h) => sum + Number(h.amountPaise || 0), 0);
  return { balancePaise, heldPaise, availablePaise: Math.max(balancePaise - heldPaise, 0) };
};

const assertOwnership = (reservation, userId) => {
  if (userId !== undefined && userId !== null && idStr(reservation.userId) !== idStr(userId)) {
    throw err("This wallet reservation does not belong to this user", 403, "RESERVATION_FORBIDDEN");
  }
};

// -------------------------------------------------------------------- reserve
/**
 * Reserve `amount` (INR) of the user's wallet for `paymentId`. Idempotent per
 * payment: repeating returns the existing reservation and never holds twice.
 * Throws 409 WALLET_INSUFFICIENT when available funds do not cover it.
 */
export const reserveWalletFunds = async ({ userId, paymentId, amount, currency = "INR" }) => {
  const amountPaise = toPaise(amount);
  if (!userId || !paymentId) throw err("A user and payment reference are required to reserve wallet funds", 400, "RESERVATION_INVALID");
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw err("A positive wallet amount is required", 400, "RESERVATION_INVALID");

  const wallet = await store().ensureWallet(userId);
  const reservation = await store().upsertReservation({ userId, walletId: wallet._id, paymentId, amountPaise, currency });
  assertOwnership(reservation, userId);
  if (reservation.amountPaise !== amountPaise) {
    throw err("A different wallet amount is already reserved for this payment", 409, "RESERVATION_CONFLICT");
  }
  if ([S.RESERVED, S.COMMITTED].includes(reservation.status)) return { reservation, created: false };
  if (reservation.status === S.RELEASED || reservation.status === S.REJECTED) {
    throw err("The wallet reservation for this payment is no longer active", 409, "RESERVATION_NOT_ACTIVE");
  }
  if (reservation.status === S.RECOVERY_REQUIRED) throw err("The wallet reservation for this payment needs review", 409, "RESERVATION_RECOVERY_REQUIRED");

  // status === holding: apply the (idempotent) hold, then confirm the record.
  const held = await store().holdFunds({ userId, reservationId: reservation._id, paymentId, amountPaise });
  if (held.outcome === "insufficient" || held.outcome === "no_wallet") {
    await cas(reservation, S.REJECTED, { reason: "Insufficient available wallet balance" });
    throw err("Insufficient available wallet balance", 409, "WALLET_INSUFFICIENT");
  }
  const confirmed = await cas(reservation, S.RESERVED, { reason: "Funds held", set: { walletId: held.walletId || wallet._id } });
  if (confirmed) return { reservation: confirmed, created: held.outcome === "held" };
  // Lost a race on the record: read the authoritative result.
  const current = await store().findReservation({ paymentId });
  if ([S.RESERVED, S.COMMITTED].includes(current?.status)) return { reservation: current, created: false };
  throw err("The wallet reservation changed while it was being created", 409, "RESERVATION_CONFLICT");
};

/** Idempotent: reserve for a payment's server-recorded allocation (used before any gateway order). */
export const ensureReservationForPayment = async (payment) => {
  if (!(Number(payment?.walletAmount) > 0)) return null;
  const { reservation } = await reserveWalletFunds({ userId: payment.userId, paymentId: payment._id, amount: payment.walletAmount, currency: payment.currency });
  return reservation;
};

// --------------------------------------------------------------------- commit
/**
 * Consume the reservation exactly once (the wallet is debited in the SAME
 * atomic update that removes the hold). Replays return {committed:true, replay:true}.
 * Release-then-commit fails with RESERVATION_NOT_ACTIVE (funds were returned).
 */
export const commitWalletReservation = async ({ paymentId, userId, source = "system" }) => {
  const reservation = await store().findReservation({ paymentId });
  if (!reservation) throw err("No wallet reservation exists for this payment", 404, "RESERVATION_NOT_FOUND");
  assertOwnership(reservation, userId);
  if (reservation.status === S.COMMITTED) return { reservation, committed: true, replay: true };
  if (reservation.status === S.RELEASED || reservation.status === S.REJECTED) {
    throw err("The wallet reservation was released; funds are not debited", 409, "RESERVATION_NOT_ACTIVE");
  }

  const result = await store().commitHold({ userId: reservation.userId, reservationId: reservation._id, paymentId, amountPaise: reservation.amountPaise, currency: reservation.currency });
  if (result.outcome === "committed" || result.outcome === "already_committed") {
    const done = await cas(reservation, S.COMMITTED, { source, reason: "Funds debited", set: { committedAt: new Date() } });
    return { reservation: done || (await store().findReservation({ paymentId })), committed: true, replay: result.outcome === "already_committed" };
  }
  if (result.outcome === "insufficient_at_commit") {
    await cas(reservation, S.RECOVERY_REQUIRED, { source, reason: "Posted balance no longer covers the hold", set: { lastError: "insufficient_at_commit" } });
    throw err("Wallet balance no longer covers this reservation; payment needs review", 409, "RESERVATION_RECOVERY_REQUIRED");
  }
  // not_held: the hold is gone and no debit exists. Only the record can say why.
  const current = await store().findReservation({ paymentId });
  if (current?.status === S.COMMITTED) return { reservation: current, committed: true, replay: true };
  if (current?.status === S.HOLDING) {
    // Hold was never applied (crash before holdFunds). Do NOT debit unreserved funds here.
    throw err("The wallet reservation was not fully placed; retry the reservation first", 409, "RESERVATION_NOT_ACTIVE");
  }
  await cas(reservation, S.RECOVERY_REQUIRED, { source, reason: "Hold missing without a recorded debit", set: { lastError: "hold_missing" } });
  throw err("Wallet hold is missing; payment needs review", 409, "RESERVATION_RECOVERY_REQUIRED");
};

// -------------------------------------------------------------------- release
/**
 * Return held funds. No-op (never an error, never a refund) if already
 * committed; idempotent if already released. The caller is responsible for
 * establishing that no provider capture can still arrive (see
 * `paymentAllowsRelease`); this function does not guess.
 */
export const releaseWalletReservation = async ({ paymentId, userId, reason = "released", source = "system", actorId = null }) => {
  const reservation = await store().findReservation({ paymentId });
  if (!reservation) return { released: false, outcome: "not_found" };
  assertOwnership(reservation, userId);
  if (reservation.status === S.COMMITTED) return { released: false, outcome: "already_committed", reservation };
  if (reservation.status === S.RELEASED || reservation.status === S.REJECTED) return { released: false, outcome: "already_released", reservation };

  // Record intent first? No: dropping the hold is the atomic effect; the record follows and is recoverable.
  const dropped = await store().dropHold({ userId: reservation.userId, reservationId: reservation._id });
  if (dropped.outcome === "not_held") {
    // Hold absent: either it was committed (debit exists) or it was never placed.
    if (await store().hasCommittedDebit({ userId: reservation.userId, paymentId })) {
      await cas(reservation, S.COMMITTED, { source, reason: "Debit found while releasing; recorded as committed", set: { committedAt: new Date() } });
      return { released: false, outcome: "already_committed", reservation: await store().findReservation({ paymentId }) };
    }
  }
  const done = await cas(reservation, S.RELEASED, { source, actorId, reason, set: { releasedAt: new Date(), releaseReason: String(reason).slice(0, 300) } });
  return { released: true, outcome: dropped.outcome, reservation: done || (await store().findReservation({ paymentId })) };
};

// ------------------------------------------------------------ release safety
const NEVER_CAPTURED_STATES = ["cancelled", "expired"];
/**
 * Pure decision: may the funds of this payment's reservation be released?
 * Only when the payment provably can no longer be fulfilled AND no provider
 * capture exists or may be in flight. A browser timeout is never a reason.
 */
export const paymentAllowsRelease = (payment) => {
  if (!payment) return { ok: false, why: "payment_missing" };
  const state = payment.paymentState || payment.status;
  const captureConfirmed = ["captured", "post_processing", "post_processing_failed", "completed", "partially_refunded", "refunded"].includes(state)
    || ["captured", "post_processing", "post_processing_failed", "completed", "partially_refunded", "refunded"].includes(payment.status);
  if (captureConfirmed) return { ok: false, why: "capture_confirmed" };
  if (["authorized", "verification_pending", "reconciliation_required"].includes(state)) return { ok: false, why: "capture_ambiguous" };
  if (payment.reconciliationState === "required") return { ok: false, why: "reconciliation_required" };
  if (payment.gatewayPaymentId) return { ok: false, why: "provider_payment_exists" };
  if (NEVER_CAPTURED_STATES.includes(state)) return { ok: true, why: state };
  if (state === "failed" && payment.activeAppointmentSlot !== true) return { ok: true, why: "failed_retries_exhausted" };
  return { ok: false, why: "payment_still_payable" };
};

// ------------------------------------------------------------------- recovery
export const RECOVERY_LEASE_MS = 2 * 60 * 1000;
export const MAX_RECOVERY_ATTEMPTS = 6;
export const HOLDING_STALE_MS = 2 * 60 * 1000;
const backoffMs = (attempts) => Math.min(60 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, attempts - 1));

/**
 * Resume/resolve reservations left behind by crashes. `loadPayment` is injected
 * (defaults to the Payment model) so the policy is testable without the
 * payment module graph.
 *
 *   holding   : finish the idempotent hold (or reject when funds are gone).
 *   reserved  : payment captured -> commit; payment provably unpayable -> release;
 *               anything ambiguous -> leave alone (never auto-release).
 *   attempts exhausted -> recovery_required (operator review), observable via lastError.
 */
export const recoverWalletReservations = async ({ now = new Date(), limit = 100, owner = `rec-${process.pid}-${Date.now()}`, loadPayment } = {}) => {
  const results = [];
  const load = loadPayment || (async (id) => (await import("../models/Payment.js")).default.findById(id).lean());
  const candidates = await store().listRecoverable({
    statuses: [S.HOLDING, S.RESERVED], olderThan: new Date(now.getTime() - HOLDING_STALE_MS), now, limit,
  });
  for (const candidate of candidates) {
    const claimed = await store().claimRecoveryLease({ id: candidate._id, owner, now, leaseMs: RECOVERY_LEASE_MS, statuses: [S.HOLDING, S.RESERVED] });
    if (!claimed) { results.push({ paymentId: candidate.paymentId, action: "skipped_claimed" }); continue; }
    try {
      const outcome = await recoverOne({ reservation: claimed, load, owner, now });
      results.push({ paymentId: claimed.paymentId, ...outcome });
      await store().patchReservation({ id: claimed._id, leaseOwner: owner, set: { leaseUntil: null, lastError: null, nextRecoveryAt: new Date(now.getTime() + backoffMs(claimed.recoveryAttempts)) } });
    } catch (error) {
      const exhausted = (claimed.recoveryAttempts || 0) >= MAX_RECOVERY_ATTEMPTS;
      if (exhausted) await cas(claimed, S.RECOVERY_REQUIRED, { source: "recovery", reason: "Recovery attempts exhausted", set: { lastError: String(error?.message).slice(0, 300) } });
      else await store().patchReservation({ id: claimed._id, leaseOwner: owner, set: { leaseUntil: null, lastError: String(error?.message).slice(0, 300), nextRecoveryAt: new Date(now.getTime() + backoffMs(claimed.recoveryAttempts)) } });
      results.push({ paymentId: claimed.paymentId, action: exhausted ? "escalated" : "retry_later", error: error?.message });
    }
  }
  return results;
};

const recoverOne = async ({ reservation, load }) => {
  const payment = await load(reservation.paymentId);
  if (reservation.status === S.HOLDING) {
    if (!payment) { await releaseWalletReservation({ paymentId: reservation.paymentId, reason: "Payment record missing", source: "recovery" }); return { action: "released_orphan_holding" }; }
    const decision = paymentAllowsRelease(payment);
    if (decision.ok) { await releaseWalletReservation({ paymentId: reservation.paymentId, reason: `Recovery: ${decision.why}`, source: "recovery" }); return { action: "released", why: decision.why }; }
    try {
      await reserveWalletFunds({ userId: reservation.userId, paymentId: reservation.paymentId, amount: fromPaise(reservation.amountPaise), currency: reservation.currency });
      return { action: "hold_completed" };
    } catch (error) {
      if (error?.code === "WALLET_INSUFFICIENT") return { action: "rejected_insufficient" };
      throw error;
    }
  }
  // reserved
  if (!payment) return { action: "left_alone", why: "payment_missing" };
  const state = payment.paymentState || payment.status;
  if (["captured", "post_processing", "post_processing_failed", "completed"].includes(state)) {
    await commitWalletReservation({ paymentId: reservation.paymentId, source: "recovery" });
    return { action: "committed", why: "capture_confirmed" };
  }
  const decision = paymentAllowsRelease(payment);
  if (decision.ok) {
    await releaseWalletReservation({ paymentId: reservation.paymentId, reason: `Recovery: ${decision.why}`, source: "recovery" });
    return { action: "released", why: decision.why };
  }
  return { action: "left_alone", why: decision.why };
};

/** SUPER_ADMIN-only privileged release of a stuck reservation. Audited by the caller's req logger. */
export const adminResolveReservation = async ({ actor, paymentId, action, reason }) => {
  if (!actor || actor.role !== "super_admin") throw err("Only a super admin can resolve a wallet reservation", 403, "RESERVATION_FORBIDDEN");
  const text = String(reason || "").trim();
  if (text.length < 10 || text.length > 300) throw err("A reason of 10-300 characters is required", 400, "REASON_REQUIRED");
  if (!["release", "commit"].includes(action)) throw err("Unsupported resolution action", 400, "RESERVATION_INVALID");
  const reservation = await store().findReservation({ paymentId });
  if (!reservation) throw err("Reservation not found", 404, "RESERVATION_NOT_FOUND");
  if (reservation.status !== S.RECOVERY_REQUIRED) throw err("Only a reservation flagged for review can be resolved manually", 409, "RESERVATION_STATE_STALE");
  if (action === "release") {
    const payment = await (await import("../models/Payment.js")).default.findById(paymentId).lean();
    const decision = paymentAllowsRelease(payment);
    if (!decision.ok) throw err(`Release refused: ${decision.why}`, 409, "RELEASE_UNSAFE");
    return releaseWalletReservation({ paymentId, reason: text, source: "admin", actorId: actor._id });
  }
  return commitWalletReservation({ paymentId, source: "admin" });
};

/** Safe operator view of reservations needing review (no patient data). */
export const listReservationsForReview = async ({ limit = 50 } = {}) => {
  const rows = await store().listByStatus({ status: S.RECOVERY_REQUIRED, limit: Math.min(Math.max(Number(limit) || 50, 1), 200) });
  return rows.map((r) => ({ paymentId: String(r.paymentId), amountPaise: r.amountPaise, currency: r.currency, status: r.status, lastError: r.lastError || null, recoveryAttempts: r.recoveryAttempts || 0, updatedAt: r.updatedAt }));
};

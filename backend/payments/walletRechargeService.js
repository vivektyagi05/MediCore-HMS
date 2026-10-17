// Phase 02 -- the ONE wallet-recharge capture/credit pipeline. Browser verify,
// the provider webhook, status polling and the recovery job all converge here.
//
// Credit pipeline (each step idempotent; order chosen so a crash anywhere is
// healed by replay and no success-only ledger row can precede its wallet effect):
//   1. CAS  open|failed|cancelled|expired -> captured   (authoritative capture claim)
//   2. WALLET credit, guarded by a per-recharge marker inside the wallet document
//      (ONE atomic update: $inc balance + $push marker) -> credited at most once
//   3. LEDGER row under unique key wallet:recharge:<id>  (E11000 == already posted)
//   4. CAS  captured -> posted
import Wallet from "../models/Wallet.js";
import WalletRecharge, { WALLET_RECHARGE_STATUS as RS } from "../models/WalletRecharge.js";
import TransactionLedger from "../models/TransactionLedger.js";
import { toPaise } from "./money.js";
import { paymentGateway } from "./paymentGateway.js";
import { logger } from "../utils/logger.js";

const OPEN = [RS.CREATED, RS.ORDER_CREATED, RS.CHECKOUT_STARTED, RS.PENDING, RS.VERIFICATION_PENDING, RS.RECONCILIATION_REQUIRED];
// A provider capture is credited from any non-posted state, including after a reported failure/cancel/expiry.
export const RECHARGE_CAPTURABLE = Object.freeze([...OPEN, RS.FAILED, RS.CANCELLED, RS.EXPIRED]);
export const RECHARGE_PLACEHOLDER_PREFIX = "pending_";
export const MAX_RECHARGE_RECOVERY_ATTEMPTS = 8;
export const rechargeReceipt = (rechargeId) => `wr_${rechargeId}`;
export const rechargeRef = (rechargeId) => `recharge:${rechargeId}`;
export const rechargeLedgerKey = (rechargeId) => `wallet:recharge:${rechargeId}`;

const history = (from, to, source, reason, actorId = null) => ({ from, to, actorId, source, reason, at: new Date() });

/** Step 2: idempotent wallet credit. Returns the wallet. Safe to call any number of times. */
export const creditWalletForRecharge = async (recharge) => {
  const ref = rechargeRef(recharge._id);
  let wallet = await Wallet.findOneAndUpdate(
    { userId: recharge.userId, transactions: { $not: { $elemMatch: { referenceType: "recharge", referenceId: ref } } } },
    {
      $setOnInsert: { userId: recharge.userId, currency: recharge.currency },
      $inc: { balance: recharge.amount },
      $push: { transactions: { type: "credit", amount: recharge.amount, currency: recharge.currency, status: "completed", referenceType: "recharge", referenceId: ref, description: "Wallet recharge" } },
    },
    { returnDocument: "after", upsert: true },
  ).catch((error) => {
    if (error?.code === 11000) return null; // upsert collided with the existing, already-credited wallet
    throw error;
  });
  return wallet || Wallet.findOne({ userId: recharge.userId });
};

/** Step 3: idempotent ledger row, written only AFTER the wallet effect exists. */
export const postRechargeLedger = async (recharge, gatewayPaymentId, walletId) => {
  const key = rechargeLedgerKey(recharge._id);
  try {
    return await TransactionLedger.create({
      userId: recharge.userId, walletId, type: "wallet_credit", direction: "credit", amount: recharge.amount, currency: recharge.currency,
      status: "posted", referenceId: gatewayPaymentId || recharge.gatewayPaymentId, idempotencyKey: key,
      metadata: { rechargeId: String(recharge._id), gatewayOrderId: recharge.gatewayOrderId },
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return TransactionLedger.findOne({ idempotencyKey: key }).lean();
  }
};

/** Finish crediting a recharge whose capture is already claimed. Replay-safe. */
export const finishRechargePosting = async (recharge, { actorId = null, source = "system" } = {}) => {
  const current = await WalletRecharge.findById(recharge._id);
  if (!current) return { recharge: null };
  if (current.status === RS.POSTED) return { recharge: current, wallet: await Wallet.findOne({ userId: current.userId }).lean(), replay: true };
  if (current.status !== RS.CAPTURED) return { recharge: current, skipped: true };
  const wallet = await creditWalletForRecharge(current);
  const ledger = await postRechargeLedger(current, current.gatewayPaymentId, wallet?._id);
  const posted = await WalletRecharge.findOneAndUpdate(
    { _id: current._id, status: RS.CAPTURED },
    {
      $set: { status: RS.POSTED, ledgerEntryId: ledger?._id, reconciliationState: "matched", lastRecoveryError: null },
      $push: { stateHistory: history(RS.CAPTURED, RS.POSTED, source, "Wallet credited and ledger posted", actorId), attempts: { completedAt: new Date(), outcome: "captured", gatewayPaymentId: current.gatewayPaymentId } },
    },
    { returnDocument: "after" },
  );
  return { recharge: posted || (await WalletRecharge.findById(current._id)), wallet, ledger, replay: !posted };
};

/**
 * Claim the capture and credit. Call ONLY after authoritative provider
 * confirmation (verified order/amount/currency/status). Concurrent callers,
 * replays and recovery all converge: one claim wins, the credit is guarded.
 */
export const postRechargeCapture = async (rechargeDoc, { gatewayPaymentId, actorId = null, source = "system" }) => {
  const claimed = await WalletRecharge.findOneAndUpdate(
    { _id: rechargeDoc._id, status: { $in: RECHARGE_CAPTURABLE } },
    {
      $set: { status: RS.CAPTURED, gatewayPaymentId, reconciliationState: "matched" },
      $push: { stateHistory: history(rechargeDoc.status, RS.CAPTURED, source, "Gateway payment captured", actorId) },
    },
    { returnDocument: "after" },
  );
  const current = claimed || (await WalletRecharge.findById(rechargeDoc._id));
  if (!current) return { recharge: null };
  if (!claimed && current.gatewayPaymentId && gatewayPaymentId && current.gatewayPaymentId !== gatewayPaymentId && [RS.CAPTURED, RS.POSTED].includes(current.status)) {
    // A DIFFERENT provider payment for the same order: evidence only, never a second credit.
    await WalletRecharge.updateOne(
      { _id: current._id, "duplicateCaptures.gatewayPaymentId": { $ne: gatewayPaymentId } },
      { $push: { duplicateCaptures: { gatewayPaymentId, at: new Date() } }, $set: { reconciliationState: "required" } },
    );
    return { recharge: await WalletRecharge.findById(current._id), duplicateCapture: true };
  }
  if (current.status === RS.CAPTURED) return finishRechargePosting(current, { actorId, source });
  if (current.status === RS.POSTED) return { recharge: current, wallet: await Wallet.findOne({ userId: current.userId }).lean(), replay: true };
  return { recharge: current, skipped: true };
};

/**
 * Apply a provider payment entity (webhook / recovery) to a recharge with the
 * same strict checks verify uses. Missing/fabricated amount or currency is a
 * mismatch, never a default. Returns an outcome string.
 */
export const settleRechargeFromProviderPayment = async ({ recharge, entity, source }) => {
  const status = String(entity?.status || "").toLowerCase();
  const amount = Number(entity?.amount);
  const currency = typeof entity?.currency === "string" ? entity.currency.trim().toUpperCase() : "";
  if (entity?.order_id && entity.order_id !== recharge.gatewayOrderId) return { outcome: "order_mismatch" };

  if (["captured", "processed"].includes(status) || entity?.captured === true) {
    if (!Number.isInteger(amount) || amount <= 0 || currency.length !== 3) return flag(recharge, "Provider capture is missing amount or currency");
    if (amount !== toPaise(recharge.amount) || currency !== String(recharge.currency).toUpperCase()) return flag(recharge, "Provider capture amount/currency does not match the recharge");
    const result = await postRechargeCapture(recharge, { gatewayPaymentId: entity.id, source });
    return { outcome: result.duplicateCapture ? "duplicate_capture" : result.replay ? "replay" : "credited", ...result };
  }
  if (status === "failed") {
    // Only ever fails an OPEN recharge; a captured/posted one is never downgraded.
    const failed = await WalletRecharge.findOneAndUpdate(
      { _id: recharge._id, status: { $in: OPEN } },
      { $set: { status: RS.FAILED, failureReason: "Gateway payment status: failed", gatewayPaymentId: entity.id }, $push: { stateHistory: history(recharge.status, RS.FAILED, source, "Gateway payment status: failed"), attempts: { completedAt: new Date(), outcome: "failed", gatewayPaymentId: entity.id } } },
      { returnDocument: "after" },
    );
    return { outcome: failed ? "failed" : "ignored_not_open" };
  }
  return { outcome: "still_pending" };
};

/**
 * Persist a verify/status/cancel mutation WITHOUT a whole-document save(): a targeted update that only applies
 * while the recharge is still pre-capture. A concurrent webhook/recovery that already captured or posted it
 * is never overwritten by this (possibly stale) in-memory document. Returns null when skipped.
 */
export const persistRechargeGuarded = async (recharge, { set = {}, attempt = null, transitioned = true } = {}) => {
  const entry = transitioned ? recharge.stateHistory?.[recharge.stateHistory.length - 1] : null;
  const update = { $set: { ...set } };
  if (transitioned) update.$set.status = recharge.status;
  const push = {};
  if (entry) push.stateHistory = typeof entry.toObject === "function" ? entry.toObject() : entry;
  if (attempt) push.attempts = attempt;
  if (Object.keys(push).length) update.$push = push;
  return WalletRecharge.findOneAndUpdate(
    { _id: recharge._id, status: { $in: [...OPEN, RS.FAILED, RS.CANCELLED, RS.EXPIRED] } },
    update,
    { returnDocument: "after" },
  );
};

export const flagRecharge = (recharge, reason, extra = {}) => flag(recharge, reason, extra);

const flag = async (recharge, reason, extra = {}) => {
  await WalletRecharge.updateOne(
    { _id: recharge._id, status: { $in: [...OPEN, RS.FAILED, RS.CANCELLED, RS.EXPIRED] } },
    { $set: { status: RS.RECONCILIATION_REQUIRED, reconciliationState: "required", failureReason: reason, ...extra }, $push: { stateHistory: history(recharge.status, RS.RECONCILIATION_REQUIRED, "gateway", reason) } },
  );
  return { outcome: "mismatch" };
};

/**
 * Persist the recharge intent BEFORE any provider call (deterministic receipt,
 * placeholder order id), so a gateway success followed by a DB failure can
 * always be traced and recovered instead of leaving an untracked order.
 */
export const createRechargeIntent = async ({ userId, amount }) => {
  const mongooseModule = (await import("mongoose")).default;
  const recharge = await WalletRecharge.create({
    userId, amount, currency: "INR", gatewayOrderId: `${RECHARGE_PLACEHOLDER_PREFIX}${new mongooseModule.Types.ObjectId()}`, status: RS.CREATED,
    stateHistory: [history(null, RS.CREATED, "patient", "Recharge intent recorded", userId)],
  });
  let order;
  try {
    order = await paymentGateway.createOrder({ amount, currency: "INR", receipt: rechargeReceipt(recharge._id), notes: { userId: String(userId), rechargeId: String(recharge._id), module: "hms_wallet_recharge" } });
  } catch (error) {
    const code = Number(error?.statusCode || error?.response?.status);
    if (code >= 400 && code < 500) {
      await WalletRecharge.updateOne({ _id: recharge._id, status: RS.CREATED }, { $set: { status: RS.CANCELLED, failureReason: "Gateway rejected order creation" }, $push: { stateHistory: history(RS.CREATED, RS.CANCELLED, "gateway", "Gateway rejected order creation") } });
    }
    throw error; // ambiguous errors keep the placeholder; recovery looks the order up by receipt
  }
  const bound = await WalletRecharge.findOneAndUpdate(
    { _id: recharge._id, gatewayOrderId: recharge.gatewayOrderId, status: RS.CREATED },
    { $set: { gatewayOrderId: order.id, status: RS.ORDER_CREATED }, $push: { stateHistory: history(RS.CREATED, RS.ORDER_CREATED, "patient", "Gateway order created", userId) } },
    { returnDocument: "after" },
  );
  if (!bound) throw new Error("Recharge changed while its order was being created");
  return { recharge: bound, order };
};

const backoff = (n) => Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, n - 1));

/** Recovery sweep (rides the existing leased recoverPaymentEvents job). Bounded, idempotent, observable. */
export const recoverStuckWalletRecharges = async ({ now = new Date(), limit = 50, fetchPayment = (a) => paymentGateway.fetchPayment(a) } = {}) => {
  const grace = new Date(now.getTime() - 2 * 60 * 1000);
  const due = { $or: [{ nextRecoveryAt: { $exists: false } }, { nextRecoveryAt: null }, { nextRecoveryAt: { $lte: now } }] };
  const stuck = await WalletRecharge.find({
    updatedAt: { $lt: grace }, recoveryAttempts: { $lt: MAX_RECHARGE_RECOVERY_ATTEMPTS }, $and: [due, { $or: [
      { status: RS.CAPTURED },
      { gatewayOrderId: new RegExp(`^${RECHARGE_PLACEHOLDER_PREFIX}`), status: RS.CREATED },
      { status: { $in: [RS.PENDING, RS.VERIFICATION_PENDING, RS.RECONCILIATION_REQUIRED, RS.FAILED] }, gatewayPaymentId: { $exists: true, $ne: null } },
    ] }],
  }).sort({ updatedAt: 1 }).limit(limit);
  const results = [];
  for (const recharge of stuck) {
    try {
      let outcome;
      if (recharge.status === RS.CAPTURED) {
        outcome = (await finishRechargePosting(recharge, { source: "recovery" })).recharge?.status === RS.POSTED ? "posted" : "unfinished";
      } else if (recharge.gatewayOrderId.startsWith(RECHARGE_PLACEHOLDER_PREFIX)) {
        const found = typeof paymentGateway.findOrderByReceipt === "function" ? await paymentGateway.findOrderByReceipt({ receipt: rechargeReceipt(recharge._id) }) : null;
        if (found?.id) {
          await WalletRecharge.updateOne({ _id: recharge._id, status: RS.CREATED, gatewayOrderId: recharge.gatewayOrderId }, { $set: { gatewayOrderId: found.id, status: RS.ORDER_CREATED }, $push: { stateHistory: history(RS.CREATED, RS.ORDER_CREATED, "recovery", "Provider order adopted by receipt") } });
          outcome = "order_adopted";
        } else if (now.getTime() - new Date(recharge.createdAt).getTime() > 30 * 60 * 1000) {
          await WalletRecharge.updateOne({ _id: recharge._id, status: RS.CREATED }, { $set: { status: RS.EXPIRED, failureReason: "No provider order was created" }, $push: { stateHistory: history(RS.CREATED, RS.EXPIRED, "recovery", "No provider order found for this intent") } });
          outcome = "expired";
        } else outcome = "waiting";
      } else {
        const entity = await fetchPayment({ paymentId: recharge.gatewayPaymentId, orderId: recharge.gatewayOrderId, amount: recharge.amount, currency: recharge.currency });
        outcome = (await settleRechargeFromProviderPayment({ recharge, entity: { id: recharge.gatewayPaymentId, ...entity }, source: "recovery" })).outcome;
      }
      await WalletRecharge.updateOne({ _id: recharge._id }, { $set: { lastRecoveryAt: now, lastRecoveryError: null, nextRecoveryAt: new Date(now.getTime() + backoff(recharge.recoveryAttempts + 1)) }, $inc: { recoveryAttempts: 1 } });
      results.push({ rechargeId: recharge._id, outcome });
    } catch (error) {
      logger.warn("Wallet recharge recovery failed for one recharge", { rechargeId: String(recharge._id), message: error?.message });
      await WalletRecharge.updateOne({ _id: recharge._id }, { $set: { lastRecoveryAt: now, lastRecoveryError: String(error?.message).slice(0, 300), nextRecoveryAt: new Date(now.getTime() + backoff(recharge.recoveryAttempts + 1)) }, $inc: { recoveryAttempts: 1 } });
      results.push({ rechargeId: recharge._id, outcome: "error" });
    }
  }
  return results;
};

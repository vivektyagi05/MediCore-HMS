import crypto from "crypto";
import mongoose from "mongoose";
import Wallet from "../../models/Wallet.js";
import TransactionLedger from "../../models/TransactionLedger.js";
import ReconciliationRecord from "../../models/ReconciliationRecord.js";
import WalletReservation from "../../models/WalletReservation.js";
import RefundRequest from "../../models/RefundRequest.js";
import Payment from "../../models/Payment.js";
import { toPaise } from "../../payments/money.js";

// Accounting contract (F-012): Wallet.balance is a MATERIALIZED balance. The
// ledger is the history it must be explainable by:
//   expected = sum(ledger wallet_credit) - sum(ledger wallet_debit)   (per user, paise)
// A difference is reported, never silently corrected.
export const computeDrift = ({ expectedPaise, actualPaise }) => ({ expectedPaise, actualPaise, driftPaise: actualPaise - expectedPaise, ok: expectedPaise === actualPaise });

export const calculateExpectedWalletBalance = async (userId) => {
  const rows = await TransactionLedger.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)), type: { $in: ["wallet_credit", "wallet_debit"] }, status: "posted" } },
    { $group: { _id: "$type", amount: { $sum: "$amount" } } },
  ]);
  const sum = (type) => toPaise(rows.find((r) => r._id === type)?.amount || 0);
  return sum("wallet_credit") - sum("wallet_debit");
};

export const reconcileWallet = async (userId) => {
  const wallet = await Wallet.findOne({ userId }).select("balance").lean();
  const result = computeDrift({ expectedPaise: await calculateExpectedWalletBalance(userId), actualPaise: toPaise(wallet?.balance || 0) });
  if (result.ok) {
    // A previously-open discrepancy that now matches is closed explicitly, not deleted.
    await ReconciliationRecord.updateOne({ kind: "wallet_balance", subjectId: userId, status: "open" }, { $set: { status: "resolved", resolutionNote: "Balance now matches ledger", lastSeenAt: new Date() } });
    return result;
  }
  try {
    await ReconciliationRecord.updateOne(
      { kind: "wallet_balance", subjectId: userId, status: "open" },
      { $set: { ...result, lastSeenAt: new Date() }, $setOnInsert: { detectedAt: new Date() } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error; // concurrent run created the open record
  }
  return result;
};

/** Cursor-batched pass over all wallets (resumable via afterId). */
export const reconcileAllWallets = async ({ afterId = null, batchSize = 200, maxBatches = Infinity } = {}) => {
  let cursor = afterId;
  let checked = 0;
  const mismatches = [];
  for (let batches = 0; batches < maxBatches; batches += 1) {
    const wallets = await Wallet.find(cursor ? { _id: { $gt: cursor } } : {}).sort({ _id: 1 }).limit(batchSize).select("userId").lean();
    if (wallets.length === 0) return { checked, mismatches, nextCursor: null, done: true };
    for (const wallet of wallets) {
      const r = await reconcileWallet(wallet.userId);
      checked += 1;
      if (!r.ok) mismatches.push({ userId: String(wallet.userId), ...r });
    }
    cursor = wallets[wallets.length - 1]._id;
    if (wallets.length < batchSize) return { checked, mismatches, nextCursor: null, done: true };
  }
  return { checked, mismatches, nextCursor: cursor, done: false };
};

// ─── Phase 03: READ-ONLY discrepancy report ───────────────────────────────
// Never writes a balance, ledger row or ReconciliationRecord. Every finding has a
// deterministic id and a `certainty`: "confirmed" (two authoritative records
// contradict each other) vs "missing_evidence" (an expected record is absent, which
// can also be legacy data or an in-flight operation). Repairs are a separate,
// audited action and are intentionally NOT part of this report.
export const DISCREPANCY_CATEGORIES = Object.freeze({
  WALLET_BALANCE_DRIFT: "wallet_balance_drift",
  DUPLICATE_LEDGER_REFERENCE: "duplicate_ledger_reference",
  REFUND_WITHOUT_LEDGER: "refund_without_ledger",
  REFUND_TOTAL_MISMATCH: "refund_total_mismatch",
  RESERVATION_STALE: "reservation_stale",
  RESERVATION_CONTRADICTION: "reservation_contradiction",
});
const CATEGORY_VALUES = Object.values(DISCREPANCY_CATEGORIES);
export const RESERVATION_STALE_MS = 30 * 60 * 1000;

export const buildDiscrepancyId = ({ category, subjectId, ref = "" }) =>
  crypto.createHash("sha1").update(`${category}|${String(subjectId)}|${String(ref)}`).digest("hex").slice(0, 24);

export const clampPage = ({ page, limit, maxLimit = 100 }) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), maxLimit);
  const safePage = Math.max(Number(page) || 1, 1);
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

/** Pure: wallet drift finding, or null when the wallet is explained by its ledger. */
export const classifyBalanceDrift = ({ userId, expectedPaise, actualPaise, heldPaise = 0 }) => {
  const drift = actualPaise - expectedPaise;
  if (drift === 0) return null;
  return {
    id: buildDiscrepancyId({ category: DISCREPANCY_CATEGORIES.WALLET_BALANCE_DRIFT, subjectId: userId }),
    category: DISCREPANCY_CATEGORIES.WALLET_BALANCE_DRIFT, certainty: "confirmed", subject: { type: "wallet", userId: String(userId) },
    expectedPaise, actualPaise, driftPaise: drift, heldPaise,
    note: expectedPaise === 0 && actualPaise > 0 ? "Wallet has a balance but no posted ledger credits (possible legacy data)." : "Posted wallet balance differs from the posted ledger.",
  };
};

/** Pure: reservation vs wallet-hold / payment state contradictions. */
export const classifyReservation = ({ reservation, walletHoldPaymentIds = [], now = new Date() }) => {
  const out = [];
  const subject = { type: "wallet_reservation", reservationId: String(reservation._id), paymentId: String(reservation.paymentId), userId: String(reservation.userId) };
  const hasHold = walletHoldPaymentIds.map(String).includes(String(reservation.paymentId));
  const ageMs = now.getTime() - new Date(reservation.updatedAt || reservation.createdAt || now).getTime();
  if (reservation.status === "recovery_required") {
    out.push({ category: DISCREPANCY_CATEGORIES.RESERVATION_STALE, certainty: "confirmed", subject, ageMs, note: "Reservation needs operator review (recovery_required).", lastError: reservation.lastError || null });
  } else if (["holding", "reserved"].includes(reservation.status) && ageMs > RESERVATION_STALE_MS) {
    out.push({ category: DISCREPANCY_CATEGORIES.RESERVATION_STALE, certainty: "missing_evidence", subject, ageMs, note: `Reservation has been ${reservation.status} for longer than the expected window.` });
  }
  if (reservation.status === "reserved" && !hasHold) out.push({ category: DISCREPANCY_CATEGORIES.RESERVATION_CONTRADICTION, certainty: "confirmed", subject, note: "Reservation is reserved but the wallet has no matching active hold." });
  if (["committed", "released", "rejected"].includes(reservation.status) && hasHold) out.push({ category: DISCREPANCY_CATEGORIES.RESERVATION_CONTRADICTION, certainty: "confirmed", subject, note: `Reservation is ${reservation.status} but the wallet still carries an active hold.` });
  return out.map((f) => ({ ...f, id: buildDiscrepancyId({ category: f.category, subjectId: reservation._id, ref: f.note }) }));
};

/** Pure: refund-total contradiction between confirmed refund requests and the payment counters. */
export const classifyRefundTotals = ({ paymentId, confirmedRequestsPaise, paymentRefundedPaise, paymentTotalPaise }) => {
  const out = [];
  const subject = { type: "payment", paymentId: String(paymentId) };
  if (confirmedRequestsPaise > paymentRefundedPaise) out.push({ category: DISCREPANCY_CATEGORIES.REFUND_TOTAL_MISMATCH, certainty: "confirmed", subject, confirmedRequestsPaise, paymentRefundedPaise, note: "Processed refund requests exceed the refunded amount recorded on the payment." });
  if (paymentRefundedPaise > paymentTotalPaise) out.push({ category: DISCREPANCY_CATEGORIES.REFUND_TOTAL_MISMATCH, certainty: "confirmed", subject, paymentRefundedPaise, paymentTotalPaise, note: "Refunded amount exceeds the captured amount." });
  return out.map((f) => ({ ...f, id: buildDiscrepancyId({ category: f.category, subjectId: paymentId, ref: f.note }) }));
};

const dateRange = ({ from, to }, field) => {
  const range = {};
  if (from && !Number.isNaN(new Date(from).getTime())) range.$gte = new Date(from);
  if (to && !Number.isNaN(new Date(to).getTime())) range.$lte = new Date(to);
  return Object.keys(range).length ? { [field]: range } : {};
};

const countOf = async (agg) => (await agg.concat([{ $count: "n" }]))?.[0]?.n || 0;

const finders = {
  async [DISCREPANCY_CATEGORIES.WALLET_BALANCE_DRIFT]({ skip, limit, filters }) {
    const total = await Wallet.countDocuments(dateRange(filters, "updatedAt"));
    const wallets = await Wallet.find(dateRange(filters, "updatedAt")).sort({ _id: 1 }).skip(skip).limit(limit).select("userId balance holds").lean();
    const ids = wallets.map((w) => w.userId);
    const rows = ids.length ? await TransactionLedger.aggregate([
      { $match: { userId: { $in: ids }, type: { $in: ["wallet_credit", "wallet_debit"] }, status: "posted" } },
      { $group: { _id: { u: "$userId", t: "$type" }, amount: { $sum: "$amount" } } },
    ]) : [];
    const sum = (u, t) => toPaise(rows.find((r) => String(r._id.u) === String(u) && r._id.t === t)?.amount || 0);
    const items = wallets.map((w) => classifyBalanceDrift({
      userId: w.userId, expectedPaise: sum(w.userId, "wallet_credit") - sum(w.userId, "wallet_debit"), actualPaise: toPaise(w.balance || 0),
      heldPaise: (w.holds || []).reduce((a, h) => a + (h.amountPaise || 0), 0),
    })).filter(Boolean);
    // `total` counts wallets examined (the scan window), not findings: findings are only known after the comparison.
    return { items, scanned: wallets.length, scanTotal: total };
  },
  async [DISCREPANCY_CATEGORIES.DUPLICATE_LEDGER_REFERENCE]({ skip, limit, filters }) {
    const base = [
      { $match: { referenceId: { $type: "string" }, status: "posted", ...dateRange(filters, "createdAt") } },
      { $group: { _id: { t: "$type", r: "$referenceId" }, count: { $sum: 1 }, ids: { $push: "$_id" }, amounts: { $addToSet: "$amount" } } },
      { $match: { count: { $gt: 1 } } },
    ];
    const total = await countOf(TransactionLedger.aggregate(base));
    const rows = await TransactionLedger.aggregate([...base, { $sort: { "_id.r": 1, "_id.t": 1 } }, { $skip: skip }, { $limit: limit }]);
    return { total, items: rows.map((r) => ({
      id: buildDiscrepancyId({ category: DISCREPANCY_CATEGORIES.DUPLICATE_LEDGER_REFERENCE, subjectId: r._id.r, ref: r._id.t }),
      category: DISCREPANCY_CATEGORIES.DUPLICATE_LEDGER_REFERENCE, certainty: "confirmed",
      subject: { type: "ledger_reference", referenceId: r._id.r, ledgerType: r._id.t }, count: r.count, ledgerEntryIds: r.ids.map(String), distinctAmounts: r.amounts,
      note: "More than one posted ledger row shares the same type and reference.",
    })) };
  },
  async [DISCREPANCY_CATEGORIES.REFUND_WITHOUT_LEDGER]({ skip, limit, filters }) {
    const match = { status: "processed", $or: [{ gatewayRefundAmount: { $gt: 0 } }, { walletRefundAmount: { $gt: 0 } }], ...dateRange(filters, "updatedAt") };
    // Requests whose gateway portion has NO ledger row.
    const missing = [
      { $match: match },
      { $match: { gatewayRefundAmount: { $gt: 0 } } },
      { $lookup: { from: TransactionLedger.collection.name, let: { rid: "$gatewayRefundId" }, pipeline: [{ $match: { $expr: { $eq: ["$idempotencyKey", { $concat: ["refund:gateway:", { $ifNull: ["$$rid", ""] }] }] } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: "gw" } },
      { $match: { gw: { $size: 0 } } },
    ];
    const total = await countOf(RefundRequest.aggregate(missing));
    const rows = await RefundRequest.aggregate([...missing, { $sort: { _id: 1 } }, { $skip: skip }, { $limit: limit }, { $project: { paymentId: 1, amount: 1, gatewayRefundAmount: 1, gatewayRefundId: 1, updatedAt: 1 } }]);
    return { total, items: rows.map((r) => ({
      id: buildDiscrepancyId({ category: DISCREPANCY_CATEGORIES.REFUND_WITHOUT_LEDGER, subjectId: r._id }),
      category: DISCREPANCY_CATEGORIES.REFUND_WITHOUT_LEDGER, certainty: "missing_evidence",
      subject: { type: "refund_request", refundRequestId: String(r._id), paymentId: String(r.paymentId) }, amountPaise: toPaise(r.gatewayRefundAmount), gatewayRefundId: r.gatewayRefundId || null,
      note: "Refund request is processed but no gateway refund ledger row was found (may predate ledger posting).",
    })) };
  },
  async [DISCREPANCY_CATEGORIES.REFUND_TOTAL_MISMATCH]({ skip, limit, filters }) {
    const base = [
      { $match: { status: "processed", ...dateRange(filters, "updatedAt") } },
      { $group: { _id: "$paymentId", confirmed: { $sum: "$amount" } } },
      { $lookup: { from: Payment.collection.name, localField: "_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { $expr: { $gt: ["$confirmed", { $ifNull: ["$p.refundedAmount", 0] }] } } },
    ];
    const total = await countOf(RefundRequest.aggregate(base));
    const rows = await RefundRequest.aggregate([...base, { $sort: { _id: 1 } }, { $skip: skip }, { $limit: limit }, { $project: { confirmed: 1, refunded: "$p.refundedAmount", total: "$p.totalAmount" } }]);
    return { total, items: rows.flatMap((r) => classifyRefundTotals({ paymentId: r._id, confirmedRequestsPaise: toPaise(r.confirmed), paymentRefundedPaise: toPaise(r.refunded || 0), paymentTotalPaise: toPaise(r.total || 0) })) };
  },
  async [DISCREPANCY_CATEGORIES.RESERVATION_STALE]({ skip, limit, filters, now }) {
    return reservationFindings({ skip, limit, filters, now, only: DISCREPANCY_CATEGORIES.RESERVATION_STALE });
  },
  async [DISCREPANCY_CATEGORIES.RESERVATION_CONTRADICTION]({ skip, limit, filters, now }) {
    return reservationFindings({ skip, limit, filters, now, only: DISCREPANCY_CATEGORIES.RESERVATION_CONTRADICTION });
  },
};

async function reservationFindings({ skip, limit, filters, now, only }) {
  const staleBefore = new Date(now.getTime() - RESERVATION_STALE_MS);
  const filter = only === DISCREPANCY_CATEGORIES.RESERVATION_STALE
    ? { $or: [{ status: "recovery_required" }, { status: { $in: ["holding", "reserved"] }, updatedAt: { $lt: staleBefore } }], ...dateRange(filters, "updatedAt") }
    : { status: { $in: ["reserved", "committed", "released", "rejected"] }, ...dateRange(filters, "updatedAt") };
  const total = await WalletReservation.countDocuments(filter);
  const reservations = await WalletReservation.find(filter).sort({ _id: 1 }).skip(skip).limit(limit).lean();
  const wallets = await Wallet.find({ userId: { $in: reservations.map((r) => r.userId) } }).select("userId holds").lean();
  const holdsByUser = new Map(wallets.map((w) => [String(w.userId), (w.holds || []).map((h) => h.paymentId)]));
  const items = reservations.flatMap((reservation) => classifyReservation({ reservation, walletHoldPaymentIds: holdsByUser.get(String(reservation.userId)) || [], now })).filter((f) => f.category === only);
  return { total, items };
}

/**
 * Bounded, paginated, read-only report. `category` selects one class (required for
 * paging); omitted = first page of every class with per-class counts. No fixed
 * record ceiling: totals come from counts/aggregation, pages are skip/limit.
 */
export const buildWalletLedgerDiscrepancyReport = async ({ category, page, limit, from, to, now = new Date() } = {}) => {
  if (category && !CATEGORY_VALUES.includes(category)) { const e = new Error("Unknown discrepancy category"); e.statusCode = 400; throw e; }
  const { page: p, limit: l, skip } = clampPage({ page, limit });
  const filters = { from, to };
  const categories = category ? [category] : CATEGORY_VALUES;
  const sections = {};
  for (const c of categories) {
    const r = await finders[c]({ skip, limit: l, filters, now });
    sections[c] = { items: r.items, ...(r.total !== undefined ? { total: r.total, pages: Math.max(Math.ceil(r.total / l), 1) } : { scanned: r.scanned, scanTotal: r.scanTotal, pages: Math.max(Math.ceil((r.scanTotal || 0) / l), 1) }) };
  }
  const summary = Object.fromEntries(categories.map((c) => [c, sections[c].items.length]));
  return { generatedAt: now.toISOString(), readOnly: true, page: p, limit: l, filters: { category: category || null, from: from || null, to: to || null }, summary, sections };
};

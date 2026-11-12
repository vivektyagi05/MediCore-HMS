import crypto from "crypto";
import mongoose from "mongoose";
import Wallet from "../../models/Wallet.js";
import TransactionLedger from "../../models/TransactionLedger.js";
import ReconciliationRecord from "../../models/ReconciliationRecord.js";
import WalletReservation from "../../models/WalletReservation.js";
import RefundRequest from "../../models/RefundRequest.js";
import Payment from "../../models/Payment.js";
import { CAPTURE_CONFIRMED_STATES, effectiveState, isCaptureConfirmed } from "../../payments/paymentTransitions.js";
import WalletRecharge from "../../models/WalletRecharge.js";
import DoctorPayout from "../../models/DoctorPayout.js";
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
  // Phase 03 completion: the remaining reconciliation classes.
  RECHARGE_LEDGER_MISMATCH: "recharge_ledger_mismatch",
  RECHARGE_LEDGER_ORPHAN: "recharge_ledger_orphan",
  PAYMENT_ALLOCATION_MISMATCH: "payment_allocation_mismatch",
  EARNING_REVERSAL_MISSING: "earning_reversal_missing",
  EARNING_ADJUSTMENT_INCONSISTENT: "earning_adjustment_inconsistent",
  CAPTURE_CASE_OPEN: "capture_case_open",
  STALE_REFUND: "stale_refund",
  STALE_RECHARGE: "stale_recharge",
  STALE_PAYMENT: "stale_payment",
  REFERENCE_INCONSISTENCY: "reference_inconsistency",
  DUPLICATE_REFUND_REFERENCE: "duplicate_refund_reference",
});
// How the categories group into the classes an operator thinks in.
export const CATEGORY_CLASS = Object.freeze({
  wallet_balance_drift: "wallet", duplicate_ledger_reference: "references", refund_without_ledger: "refund", refund_total_mismatch: "refund",
  reservation_stale: "operations", reservation_contradiction: "wallet",
  recharge_ledger_mismatch: "recharge", recharge_ledger_orphan: "recharge", payment_allocation_mismatch: "payment",
  earning_reversal_missing: "earning", earning_adjustment_inconsistent: "earning", capture_case_open: "capture",
  stale_refund: "operations", stale_recharge: "operations", stale_payment: "operations",
  reference_inconsistency: "references", duplicate_refund_reference: "references",
});
// certainty: confirmed (two authoritative records contradict) | missing_evidence (an expected record is absent: needs
// manual investigation) | expected_pending (an in-flight state still inside its normal window: not a discrepancy yet).
// "Resolved" findings are not emitted as items; they are counted (summary.resolved).
export const CERTAINTY = Object.freeze({ CONFIRMED: "confirmed", MISSING_EVIDENCE: "missing_evidence", EXPECTED_PENDING: "expected_pending" });
export const PENDING_WINDOW_MS = 15 * 60 * 1000; // normal time for post-processing / finalisation to complete
export const reconciliationDeps = { walletCreditRefs: null }; // overridable in tests; production uses the aggregation below

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


// ─── Phase 03 completion: pure classifiers for the remaining classes ──────────
const ageOf = (doc, now, ...fields) => {
  const at = fields.map((f) => doc?.[f]).find(Boolean);
  return at ? now.getTime() - new Date(at).getTime() : Infinity;
};
const mk = (category, subjectId, ref, body) => ({ id: buildDiscrepancyId({ category, subjectId, ref }), category, class: CATEGORY_CLASS[category], ...body });
const finish = (list) => list.filter(Boolean);

/** Pure. Recharge vs wallet credit vs ledger row. `ledger` = the posted row keyed wallet:recharge:<id>. */
export const classifyRechargeLedger = ({ recharge, ledger, walletHasCredit, now = new Date() }) => {
  const C = DISCREPANCY_CATEGORIES.RECHARGE_LEDGER_MISMATCH;
  const subject = { type: "wallet_recharge", rechargeId: String(recharge._id), userId: String(recharge.userId), gatewayOrderId: recharge.gatewayOrderId || null };
  const amountPaise = toPaise(recharge.amount);
  const out = [];
  if (recharge.status === "posted") {
    if (walletHasCredit && !ledger) out.push(mk(C, recharge._id, "credit_without_ledger", { certainty: CERTAINTY.CONFIRMED, subject, amountPaise, evidence: { walletCredit: true, ledgerRow: false }, note: "Recharge is posted and the wallet was credited, but no wallet_credit ledger row exists." }));
    else if (!walletHasCredit && ledger) out.push(mk(C, recharge._id, "ledger_without_credit", { certainty: CERTAINTY.CONFIRMED, subject, amountPaise, evidence: { walletCredit: false, ledgerRow: true }, note: "A ledger credit exists for this recharge but the wallet carries no matching credit transaction." }));
    else if (!walletHasCredit && !ledger) out.push(mk(C, recharge._id, "posted_without_effects", { certainty: CERTAINTY.CONFIRMED, subject, amountPaise, evidence: { walletCredit: false, ledgerRow: false }, note: "Recharge is marked posted but neither a wallet credit nor a ledger row exists." }));
    if (ledger && toPaise(ledger.amount) !== amountPaise) out.push(mk(C, recharge._id, "amount_mismatch", { certainty: CERTAINTY.CONFIRMED, subject, amountPaise, ledgerAmountPaise: toPaise(ledger.amount), note: "Ledger credit amount differs from the recharge amount." }));
  } else if (recharge.status === "captured") {
    // captured = provider-confirmed, posting not finished. Normal for a short window.
    const pending = ageOf(recharge, now, "updatedAt", "createdAt") <= PENDING_WINDOW_MS;
    out.push(mk(C, recharge._id, "captured_not_posted", {
      certainty: pending ? CERTAINTY.EXPECTED_PENDING : CERTAINTY.MISSING_EVIDENCE, subject, amountPaise, evidence: { walletCredit: Boolean(walletHasCredit), ledgerRow: Boolean(ledger) },
      note: pending ? "Capture confirmed; wallet posting is still within its normal window." : "Capture was confirmed but posting never finished; verify the wallet/ledger state before any action.",
    }));
  }
  return finish(out);
};

/** Pure. A recharge ledger row with no valid recharge behind it. */
export const classifyRechargeLedgerOrphan = ({ ledgerRow, recharge }) => {
  const C = DISCREPANCY_CATEGORIES.RECHARGE_LEDGER_ORPHAN;
  const subject = { type: "ledger_entry", ledgerEntryId: String(ledgerRow._id), userId: ledgerRow.userId ? String(ledgerRow.userId) : null, idempotencyKey: ledgerRow.idempotencyKey };
  if (!recharge) return [mk(C, ledgerRow._id, "no_recharge", { certainty: CERTAINTY.CONFIRMED, subject, amountPaise: toPaise(ledgerRow.amount), note: "Wallet recharge ledger credit has no corresponding recharge record." })];
  if (!["captured", "posted"].includes(recharge.status)) return [mk(C, ledgerRow._id, `recharge_${recharge.status}`, { certainty: CERTAINTY.CONFIRMED, subject, amountPaise: toPaise(ledgerRow.amount), note: `Ledger credit exists but the recharge is ${recharge.status}, not captured/posted.` })];
  if (toPaise(recharge.amount) !== toPaise(ledgerRow.amount)) return [mk(C, ledgerRow._id, "amount_mismatch", { certainty: CERTAINTY.CONFIRMED, subject, amountPaise: toPaise(ledgerRow.amount), rechargeAmountPaise: toPaise(recharge.amount), note: "Ledger credit amount differs from the recharge amount." })];
  return [];
};

// Payment.status is the legacy financial status and can LAG paymentState (the workflow state), so capture is judged on
// BOTH fields with the same helper the payment pipeline uses (isCaptureConfirmed / effectiveState), never on status alone.
const STALE_STATES = ["reconciliation_required", "post_processing_failed", "verification_pending", "post_processing"];
const captureConfirmedFilter = { $or: [{ status: { $in: CAPTURE_CONFIRMED_STATES } }, { paymentState: { $in: CAPTURE_CONFIRMED_STATES } }] };
/** Pure. A captured payment vs its wallet/gateway allocation and ledger rows. */
export const classifyPaymentAllocation = ({ payment, walletDebit, captureLedger, now = new Date() }) => {
  const C = DISCREPANCY_CATEGORIES.PAYMENT_ALLOCATION_MISMATCH;
  if (!isCaptureConfirmed(payment)) return [];
  const subject = { type: "payment", paymentId: String(payment._id), appointmentId: payment.appointmentId ? String(payment.appointmentId) : null };
  const totalP = toPaise(payment.totalAmount); const walletP = toPaise(payment.walletAmount || 0); const gatewayP = toPaise(payment.gatewayAmount || 0);
  const recent = ageOf(payment, now, "paidAt", "updatedAt", "createdAt") <= PENDING_WINDOW_MS;
  const out = [];
  if (walletP + gatewayP !== totalP) out.push(mk(C, payment._id, "allocation_sum", { certainty: CERTAINTY.CONFIRMED, subject, totalPaise: totalP, walletPaise: walletP, gatewayPaise: gatewayP, note: "Wallet + gateway allocation does not equal the payment total." }));
  if (walletP > 0 && !walletDebit) out.push(mk(C, payment._id, "wallet_debit_missing", { certainty: recent ? CERTAINTY.EXPECTED_PENDING : CERTAINTY.CONFIRMED, subject, walletPaise: walletP, note: recent ? "Wallet debit ledger row not posted yet (within normal window)." : "Payment has a wallet allocation but no wallet_debit ledger row." }));
  if (walletDebit && walletP > 0 && toPaise(walletDebit.amount) !== walletP) out.push(mk(C, payment._id, "wallet_debit_amount", { certainty: CERTAINTY.CONFIRMED, subject, walletPaise: walletP, ledgerPaise: toPaise(walletDebit.amount), note: "Wallet debit ledger amount differs from the payment's wallet allocation." }));
  if (walletP === 0 && walletDebit) out.push(mk(C, payment._id, "unexpected_wallet_debit", { certainty: CERTAINTY.CONFIRMED, subject, ledgerPaise: toPaise(walletDebit.amount), note: "A wallet debit ledger row exists for a payment with no wallet allocation." }));
  if (!captureLedger) out.push(mk(C, payment._id, "capture_ledger_missing", { certainty: recent ? CERTAINTY.EXPECTED_PENDING : CERTAINTY.MISSING_EVIDENCE, subject, totalPaise: totalP, note: recent ? "Capture ledger row not posted yet (post-processing window)." : "No capture ledger row for this payment (may predate ledger posting or post-processing did not finish)." }));
  else if (toPaise(captureLedger.amount) !== totalP) out.push(mk(C, payment._id, "capture_ledger_amount", { certainty: CERTAINTY.CONFIRMED, subject, totalPaise: totalP, ledgerPaise: toPaise(captureLedger.amount), note: "Capture ledger amount differs from the payment total." }));
  return finish(out);
};

/** Pure. Refund exists on the payment: has the doctor's earning been reversed, with ledger evidence? */
export const classifyEarningReversal = ({ payment, payout, ledgerKeys = new Set(), now = new Date() }) => {
  const C = DISCREPANCY_CATEGORIES.EARNING_REVERSAL_MISSING;
  const refundedP = toPaise(payment.refundedAmount || 0);
  if (refundedP <= 0) return [];
  const subject = { type: "payment", paymentId: String(payment._id), payoutId: payout ? String(payout._id) : null };
  if (!payout) return [];  // no payout recorded: nothing to reverse (captured-without-payout is the existing repair class)
  const recent = ageOf(payment, now, "updatedAt") <= PENDING_WINDOW_MS;
  const doctorP = toPaise(payout.doctorAmount); const doneP = toPaise(payout.refundAdjustmentAmount || 0);
  const out = [];
  if (!(payout.refundAdjustments || []).length) out.push(mk(C, payment._id, "no_adjustment", { certainty: recent ? CERTAINTY.EXPECTED_PENDING : CERTAINTY.CONFIRMED, subject, refundedPaise: refundedP, note: recent ? "Refund recorded; earning reversal still within its normal window." : "Payment has refunded money but the doctor earning was never adjusted." }));
  else if (refundedP >= toPaise(payment.totalAmount) && doneP < doctorP) out.push(mk(C, payment._id, "incomplete_full_reversal", { certainty: recent ? CERTAINTY.EXPECTED_PENDING : CERTAINTY.CONFIRMED, subject, doctorSharePaise: doctorP, reversedPaise: doneP, note: "Payment is fully refunded but the doctor share has not been fully reversed." }));
  for (const adj of payout.refundAdjustments || []) {
    if (toPaise(adj.doctorAdjustment) > 0 && !ledgerKeys.has(`refund:earning:${adj.refundKey}`)) out.push(mk(C, payment._id, `ledger_missing:${adj.refundKey}`, { certainty: CERTAINTY.MISSING_EVIDENCE, subject, refundKey: adj.refundKey, amountPaise: toPaise(adj.doctorAdjustment), note: "Earning adjustment recorded without its compensating ledger row (replaying the refund posts it idempotently)." }));
  }
  return finish(out);
};

/** Pure. Payout adjustments that contradict themselves or the payment. */
export const classifyEarningAdjustment = ({ payout, payment }) => {
  const C = DISCREPANCY_CATEGORIES.EARNING_ADJUSTMENT_INCONSISTENT;
  const subject = { type: "doctor_payout", payoutId: String(payout._id), paymentId: String(payout.paymentId) };
  const sumP = (payout.refundAdjustments || []).reduce((a, e) => a + toPaise(e.doctorAdjustment), 0);
  const platSumP = (payout.refundAdjustments || []).reduce((a, e) => a + toPaise(e.platformAdjustment), 0);
  const doneP = toPaise(payout.refundAdjustmentAmount || 0);
  const out = [];
  if (sumP !== doneP) out.push(mk(C, payout._id, "doctor_sum", { certainty: CERTAINTY.CONFIRMED, subject, entriesPaise: sumP, totalPaise: doneP, note: "Sum of doctor adjustment entries differs from the payout's refundAdjustmentAmount." }));
  if (platSumP !== toPaise(payout.platformRefundAdjustmentAmount || 0)) out.push(mk(C, payout._id, "platform_sum", { certainty: CERTAINTY.CONFIRMED, subject, entriesPaise: platSumP, totalPaise: toPaise(payout.platformRefundAdjustmentAmount || 0), note: "Sum of platform adjustment entries differs from the payout's platformRefundAdjustmentAmount." }));
  if (doneP > toPaise(payout.doctorAmount)) out.push(mk(C, payout._id, "over_reversal", { certainty: CERTAINTY.CONFIRMED, subject, doctorSharePaise: toPaise(payout.doctorAmount), reversedPaise: doneP, note: "More has been reversed than the doctor's share." }));
  const keys = (payout.refundAdjustments || []).map((e) => e.refundKey);
  if (new Set(keys).size !== keys.length) out.push(mk(C, payout._id, "duplicate_refund_key", { certainty: CERTAINTY.CONFIRMED, subject, note: "The same refund key is recorded more than once on this payout." }));
  if (!payment) out.push(mk(C, payout._id, "payment_missing", { certainty: CERTAINTY.CONFIRMED, subject, note: "Payout carries refund adjustments but its payment record does not exist." }));
  else if (toPaise(payment.refundedAmount || 0) <= 0 && doneP > 0) out.push(mk(C, payout._id, "adjustment_without_refund", { certainty: CERTAINTY.CONFIRMED, subject, reversedPaise: doneP, note: "Payout was adjusted for a refund but the payment shows no refunded amount." }));
  return finish(out);
};

/** Pure. One unresolved capture evidence entry awaiting a decision. Resolved entries are counted, not listed. */
export const classifyCaptureEvidence = ({ payment, evidence }) => {
  const state = evidence?.resolution?.state || "open";
  if (["verified_no_action", "refund_required"].includes(state)) return [];
  const C = DISCREPANCY_CATEGORIES.CAPTURE_CASE_OPEN;
  return [mk(C, payment._id, `${evidence.gatewayPaymentId}:${evidence.disposition}`, {
    certainty: state === "insufficient_evidence" ? CERTAINTY.MISSING_EVIDENCE : CERTAINTY.CONFIRMED,
    subject: { type: "payment", paymentId: String(payment._id), gatewayPaymentId: evidence.gatewayPaymentId },
    disposition: evidence.disposition, resolutionState: state, amountPaise: evidence.amountPaise ?? null, recordedAt: evidence.at || null,
    note: state === "insufficient_evidence" ? "Capture evidence was reviewed but remains inconclusive." : "Capture evidence recorded by the webhook pipeline is awaiting an operator decision.",
  })];
};

/** Pure. Refund requests parked in a non-terminal gateway state. */
export const classifyStaleRefund = ({ refundRequest, now = new Date() }) => {
  const C = DISCREPANCY_CATEGORIES.STALE_REFUND;
  if (!["gateway_processing", "reconciliation_required", "retry_required"].includes(refundRequest.refundState)) return [];
  const subject = { type: "refund_request", refundRequestId: String(refundRequest._id), paymentId: String(refundRequest.paymentId) };
  const age = ageOf(refundRequest, now, "lastAttemptAt", "updatedAt", "createdAt");
  const inFlight = refundRequest.refundState === "gateway_processing" && age <= PENDING_WINDOW_MS;
  return [mk(C, refundRequest._id, refundRequest.refundState, {
    certainty: inFlight ? CERTAINTY.EXPECTED_PENDING : CERTAINTY.MISSING_EVIDENCE, subject, refundState: refundRequest.refundState, ageMs: Number.isFinite(age) ? age : null,
    amountPaise: toPaise(refundRequest.amount), gatewayRefundId: refundRequest.gatewayRefundId || null,
    note: inFlight ? "Refund is being processed (inside the normal window)." : refundRequest.refundState === "retry_required" ? "Provider rejected the refund; an operator retry is required." : "Provider outcome is unconfirmed; run provider reconciliation (never retry blindly).",
  })];
};

/** Pure. Recharges that need a human or exhausted automated recovery. */
export const classifyStaleRecharge = ({ recharge, maxRecoveryAttempts = 8, now = new Date() }) => {
  const C = DISCREPANCY_CATEGORIES.STALE_RECHARGE;
  const subject = { type: "wallet_recharge", rechargeId: String(recharge._id), userId: String(recharge.userId) };
  const exhausted = (recharge.recoveryAttempts || 0) >= maxRecoveryAttempts;
  if (recharge.status === "reconciliation_required" || (exhausted && recharge.status !== "posted")) {
    return [mk(C, recharge._id, exhausted ? "exhausted" : "reconciliation_required", { certainty: CERTAINTY.CONFIRMED, subject, recoveryAttempts: recharge.recoveryAttempts || 0, status: recharge.status, lastRecoveryError: recharge.lastRecoveryError || null, note: exhausted ? "Automated recovery attempts are exhausted; manual investigation is required." : "Recharge is flagged reconciliation_required." })];
  }
  const age = ageOf(recharge, now, "updatedAt", "createdAt");
  if (recharge.status === "verification_pending" && age > PENDING_WINDOW_MS) return [mk(C, recharge._id, "verification_stale", { certainty: CERTAINTY.MISSING_EVIDENCE, subject, status: recharge.status, ageMs: age, note: "Verification has been pending longer than the normal window; check the provider." })];
  return [];
};

/** Pure. Payments flagged for reconciliation or stuck in post-processing. */
export const classifyStalePayment = ({ payment, now = new Date() }) => {
  const C = DISCREPANCY_CATEGORIES.STALE_PAYMENT;
  const subject = { type: "payment", paymentId: String(payment._id), appointmentId: payment.appointmentId ? String(payment.appointmentId) : null };
  const state = effectiveState(payment); // workflow state wins; legacy status may lag
  const flagged = payment.reconciliationState === "required" || ["reconciliation_required", "post_processing_failed"].includes(state) || ["reconciliation_required", "post_processing_failed"].includes(payment.status);
  const stuck = ["verification_pending", "post_processing"].includes(state) && ageOf(payment, now, "updatedAt", "createdAt") > PENDING_WINDOW_MS;
  if (!flagged && !stuck) return [];
  return [mk(C, payment._id, flagged ? "flagged" : "stuck", {
    certainty: flagged ? CERTAINTY.CONFIRMED : CERTAINTY.MISSING_EVIDENCE, subject, status: payment.status, paymentState: payment.paymentState || null, reconciliationState: payment.reconciliationState || null,
    note: flagged ? "Payment is flagged for reconciliation by the payment pipeline." : `Payment has been ${state} longer than the normal window.`,
  })];
};

/** Pure. Refund references that contradict the payment's own refund bookkeeping. */
export const classifyRefundReferences = ({ payment, refundRequests = [] }) => {
  const C = DISCREPANCY_CATEGORIES.REFERENCE_INCONSISTENCY;
  const subject = { type: "payment", paymentId: String(payment._id) };
  const counted = new Set(payment.processedGatewayRefundIds || []);
  const referenced = new Set(refundRequests.map((r) => r.gatewayRefundId).filter(Boolean));
  const out = [];
  for (const r of refundRequests.filter((x) => x.status === "processed")) {
    if ((r.gatewayRefundAmount || 0) > 0 && !r.gatewayRefundId) out.push(mk(C, payment._id, `missing_ref:${r._id}`, { certainty: CERTAINTY.CONFIRMED, subject, refundRequestId: String(r._id), note: "Processed refund request has a gateway amount but no gateway refund reference." }));
    else if (r.gatewayRefundId && (r.gatewayRefundAmount || 0) > 0 && !counted.has(r.gatewayRefundId)) out.push(mk(C, payment._id, `uncounted:${r.gatewayRefundId}`, { certainty: CERTAINTY.CONFIRMED, subject, refundRequestId: String(r._id), gatewayRefundId: r.gatewayRefundId, note: "Refund request is processed but its gateway refund id is not counted on the payment." }));
  }
  for (const id of counted) if (!referenced.has(id)) out.push(mk(C, payment._id, `unreferenced:${id}`, { certainty: CERTAINTY.MISSING_EVIDENCE, subject, gatewayRefundId: id, note: "Payment counts a gateway refund that no refund request references (provider-initiated or legacy)." }));
  const sumP = refundRequests.filter((r) => r.status === "processed").reduce((a, r) => a + toPaise(r.amount), 0);
  if (sumP > 0 && refundRequests.every((r) => r.status === "processed" ? true : true) && toPaise(payment.walletRefundedAmount || 0) + toPaise(payment.gatewayRefundedAmount || 0) !== toPaise(payment.refundedAmount || 0)) out.push(mk(C, payment._id, "counter_split", { certainty: CERTAINTY.CONFIRMED, subject, note: "walletRefundedAmount + gatewayRefundedAmount does not equal refundedAmount." }));
  return finish(out);
};

const toObjectId = (value, name) => {
  if (value === undefined || value === null || value === "") return null;
  if (!mongoose.Types.ObjectId.isValid(String(value))) { const e = new Error(`Invalid ${name}`); e.statusCode = 400; throw e; }
  return new mongoose.Types.ObjectId(String(value));
};
const byPayment = (filters, field = "paymentId") => (filters.paymentId ? { [field]: filters.paymentId } : {});

// Production lookup: which of `refs` appear as a recharge credit on the user's wallet. Aggregation keeps the
// payload bounded (only matching reference ids are projected, never the whole transactions array).
const walletCreditRefsAggregate = async ({ userIds, refs }) => {
  if (!userIds.length) return new Set();
  const rows = await Wallet.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $project: { _id: 0, refs: { $map: { input: { $filter: { input: { $ifNull: ["$transactions", []] }, as: "t", cond: { $and: [{ $eq: ["$$t.referenceType", "recharge"] }, { $in: ["$$t.referenceId", refs] }] } } }, as: "t", in: "$$t.referenceId" } } } },
  ]);
  return new Set(rows.flatMap((r) => r.refs));
};
const creditRefs = (args) => (reconciliationDeps.walletCreditRefs || walletCreditRefsAggregate)(args);
const objKey = (id) => String(id);
const paged = (q, skip, limit) => q.sort({ _id: 1 }).skip(skip).limit(limit).lean();

Object.assign(finders, {
  async [DISCREPANCY_CATEGORIES.RECHARGE_LEDGER_MISMATCH]({ skip, limit, filters, now }) {
    const filter = { status: { $in: ["captured", "posted"] }, ...dateRange(filters, "updatedAt") };
    const total = await WalletRecharge.countDocuments(filter);
    const recharges = await paged(WalletRecharge.find(filter), skip, limit);
    const keys = recharges.map((r) => `wallet:recharge:${r._id}`);
    const ledger = recharges.length ? await TransactionLedger.find({ idempotencyKey: { $in: keys }, status: "posted" }).select("idempotencyKey amount").lean() : [];
    const ledgerBy = new Map(ledger.map((l) => [l.idempotencyKey, l]));
    const credited = await creditRefs({ userIds: [...new Set(recharges.map((r) => objKey(r.userId)))].map((u) => new mongoose.Types.ObjectId(u)), refs: recharges.map((r) => `recharge:${r._id}`) });
    return { total, items: recharges.flatMap((recharge) => classifyRechargeLedger({ recharge, ledger: ledgerBy.get(`wallet:recharge:${recharge._id}`), walletHasCredit: credited.has(`recharge:${recharge._id}`), now })) };
  },
  async [DISCREPANCY_CATEGORIES.RECHARGE_LEDGER_ORPHAN]({ skip, limit, filters }) {
    const filter = { idempotencyKey: { $regex: "^wallet:recharge:" }, status: "posted", ...dateRange(filters, "createdAt") };
    const total = await TransactionLedger.countDocuments(filter);
    const rows = await paged(TransactionLedger.find(filter), skip, limit);
    const ids = rows.map((r) => r.idempotencyKey.slice("wallet:recharge:".length)).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const recharges = ids.length ? await WalletRecharge.find({ _id: { $in: ids } }).select("status amount").lean() : [];
    const by = new Map(recharges.map((r) => [objKey(r._id), r]));
    return { total, items: rows.flatMap((ledgerRow) => classifyRechargeLedgerOrphan({ ledgerRow, recharge: by.get(ledgerRow.idempotencyKey.slice("wallet:recharge:".length)) })) };
  },
  async [DISCREPANCY_CATEGORIES.PAYMENT_ALLOCATION_MISMATCH]({ skip, limit, filters, now }) {
    const filter = { ...captureConfirmedFilter, ...(filters.paymentId ? { _id: filters.paymentId } : {}), ...dateRange(filters, "updatedAt") };
    const total = await Payment.countDocuments(filter);
    const payments = await paged(Payment.find(filter).select("totalAmount walletAmount gatewayAmount status paymentState appointmentId paidAt updatedAt createdAt"), skip, limit);
    const keys = payments.flatMap((p) => [`wallet:debit:${p._id}`, `payment:capture:${p._id}`]);
    const rows = keys.length ? await TransactionLedger.find({ idempotencyKey: { $in: keys }, status: "posted" }).select("idempotencyKey amount").lean() : [];
    const by = new Map(rows.map((l) => [l.idempotencyKey, l]));
    return { total, items: payments.flatMap((payment) => classifyPaymentAllocation({ payment, walletDebit: by.get(`wallet:debit:${payment._id}`), captureLedger: by.get(`payment:capture:${payment._id}`), now })) };
  },
  async [DISCREPANCY_CATEGORIES.EARNING_REVERSAL_MISSING]({ skip, limit, filters, now }) {
    const filter = { refundedAmount: { $gt: 0 }, ...(filters.paymentId ? { _id: filters.paymentId } : {}), ...dateRange(filters, "updatedAt") };
    const total = await Payment.countDocuments(filter);
    const payments = await paged(Payment.find(filter).select("totalAmount refundedAmount updatedAt"), skip, limit);
    const payouts = payments.length ? await DoctorPayout.find({ paymentId: { $in: payments.map((p) => p._id) } }).select("paymentId doctorAmount refundAdjustmentAmount refundAdjustments.refundKey refundAdjustments.doctorAdjustment").lean() : [];
    const payoutBy = new Map(payouts.map((p) => [objKey(p.paymentId), p]));
    const keys = payouts.flatMap((p) => (p.refundAdjustments || []).map((a) => `refund:earning:${a.refundKey}`));
    const rows = keys.length ? await TransactionLedger.find({ idempotencyKey: { $in: keys } }).select("idempotencyKey").lean() : [];
    const ledgerKeys = new Set(rows.map((r) => r.idempotencyKey));
    return { total, items: payments.flatMap((payment) => classifyEarningReversal({ payment, payout: payoutBy.get(objKey(payment._id)), ledgerKeys, now })) };
  },
  async [DISCREPANCY_CATEGORIES.EARNING_ADJUSTMENT_INCONSISTENT]({ skip, limit, filters }) {
    const filter = { refundAdjustmentAmount: { $gt: 0 }, ...byPayment(filters), ...dateRange(filters, "updatedAt") };
    const total = await DoctorPayout.countDocuments(filter);
    const payouts = await paged(DoctorPayout.find(filter), skip, limit);
    const payments = payouts.length ? await Payment.find({ _id: { $in: payouts.map((p) => p.paymentId) } }).select("refundedAmount").lean() : [];
    const by = new Map(payments.map((p) => [objKey(p._id), p]));
    return { total, items: payouts.flatMap((payout) => classifyEarningAdjustment({ payout, payment: by.get(objKey(payout.paymentId)) })) };
  },
  async [DISCREPANCY_CATEGORIES.CAPTURE_CASE_OPEN]({ skip, limit, filters }) {
    const filter = { "captureEvidence.0": { $exists: true }, ...(filters.paymentId ? { _id: filters.paymentId } : {}), ...dateRange(filters, "updatedAt") };
    const total = await Payment.countDocuments(filter);
    const payments = await paged(Payment.find(filter).select("+captureEvidence"), skip, limit);
    return { total, items: payments.flatMap((payment) => (payment.captureEvidence || []).flatMap((evidence) => classifyCaptureEvidence({ payment, evidence }))) };
  },
  async [DISCREPANCY_CATEGORIES.STALE_REFUND]({ skip, limit, filters, now }) {
    const filter = { refundState: { $in: ["gateway_processing", "reconciliation_required", "retry_required"] }, ...byPayment(filters), ...dateRange(filters, "updatedAt") };
    const total = await RefundRequest.countDocuments(filter);
    const rows = await paged(RefundRequest.find(filter), skip, limit);
    return { total, items: rows.flatMap((refundRequest) => classifyStaleRefund({ refundRequest, now })) };
  },
  async [DISCREPANCY_CATEGORIES.STALE_RECHARGE]({ skip, limit, filters, now }) {
    const filter = { $or: [{ status: { $in: ["reconciliation_required", "verification_pending"] } }, { recoveryAttempts: { $gte: 8 }, status: { $ne: "posted" } }], ...dateRange(filters, "updatedAt") };
    const total = await WalletRecharge.countDocuments(filter);
    const rows = await paged(WalletRecharge.find(filter), skip, limit);
    return { total, items: rows.flatMap((recharge) => classifyStaleRecharge({ recharge, now })) };
  },
  async [DISCREPANCY_CATEGORIES.STALE_PAYMENT]({ skip, limit, filters, now }) {
    const filter = { $or: [{ reconciliationState: "required" }, { status: { $in: STALE_STATES } }, { paymentState: { $in: STALE_STATES } }], ...(filters.paymentId ? { _id: filters.paymentId } : {}), ...dateRange(filters, "updatedAt") };
    const total = await Payment.countDocuments(filter);
    const rows = await paged(Payment.find(filter).select("status paymentState reconciliationState appointmentId updatedAt createdAt"), skip, limit);
    return { total, items: rows.flatMap((payment) => classifyStalePayment({ payment, now })) };
  },
  async [DISCREPANCY_CATEGORIES.REFERENCE_INCONSISTENCY]({ skip, limit, filters }) {
    const filter = { refundedAmount: { $gt: 0 }, ...(filters.paymentId ? { _id: filters.paymentId } : {}), ...dateRange(filters, "updatedAt") };
    const total = await Payment.countDocuments(filter);
    const payments = await paged(Payment.find(filter).select("processedGatewayRefundIds refundedAmount walletRefundedAmount gatewayRefundedAmount"), skip, limit);
    const requests = payments.length ? await RefundRequest.find({ paymentId: { $in: payments.map((p) => p._id) } }).select("paymentId status gatewayRefundId gatewayRefundAmount amount").lean() : [];
    return { total, items: payments.flatMap((payment) => classifyRefundReferences({ payment, refundRequests: requests.filter((r) => objKey(r.paymentId) === objKey(payment._id)) })) };
  },
  async [DISCREPANCY_CATEGORIES.DUPLICATE_REFUND_REFERENCE]({ skip, limit, filters }) {
    const base = [
      { $match: { gatewayRefundId: { $type: "string" }, ...(filters.paymentId ? { paymentId: filters.paymentId } : {}), ...dateRange(filters, "updatedAt") } },
      { $group: { _id: "$gatewayRefundId", count: { $sum: 1 }, ids: { $push: "$_id" }, payments: { $addToSet: "$paymentId" } } },
      { $match: { count: { $gt: 1 } } },
    ];
    const total = await countOf(RefundRequest.aggregate(base));
    const rows = await RefundRequest.aggregate([...base, { $sort: { _id: 1 } }, { $skip: skip }, { $limit: limit }]);
    return { total, items: rows.map((r) => mk(DISCREPANCY_CATEGORIES.DUPLICATE_REFUND_REFERENCE, r._id, "dup", {
      certainty: CERTAINTY.CONFIRMED, subject: { type: "gateway_refund", gatewayRefundId: r._id }, count: r.count, refundRequestIds: r.ids.map(String), paymentIds: r.payments.map(String),
      note: r.payments.length > 1 ? "The same provider refund id is attached to refund requests on different payments." : "The same provider refund id is attached to more than one refund request.",
    })) };
  },
});

/**
 * Bounded, paginated, read-only report. `category` selects one class (required for
 * paging); omitted = first page of every class with per-class counts. No fixed
 * record ceiling: totals come from counts/aggregation, pages are skip/limit.
 */
export const buildWalletLedgerDiscrepancyReport = async ({ category, certainty, paymentId, page, limit, from, to, now = new Date() } = {}) => {
  if (category && !CATEGORY_VALUES.includes(category)) { const e = new Error("Unknown discrepancy category"); e.statusCode = 400; throw e; }
  if (certainty && !Object.values(CERTAINTY).includes(certainty)) { const e = new Error("Unknown certainty filter"); e.statusCode = 400; throw e; }
  const { page: p, limit: l, skip } = clampPage({ page, limit });
  const filters = { from, to, paymentId: toObjectId(paymentId, "paymentId") };
  const categories = category ? [category] : CATEGORY_VALUES;
  const sections = {};
  for (const c of categories) {
    const r = await finders[c]({ skip, limit: l, filters, now });
    const items = r.items.map((item) => ({ class: CATEGORY_CLASS[c], ...item })).filter((item) => !certainty || item.certainty === certainty);
    sections[c] = { class: CATEGORY_CLASS[c], items, ...(r.total !== undefined ? { total: r.total, pages: Math.max(Math.ceil(r.total / l), 1) } : { scanned: r.scanned, scanTotal: r.scanTotal, pages: Math.max(Math.ceil((r.scanTotal || 0) / l), 1) }) };
  }
  const summary = Object.fromEntries(categories.map((c) => [c, sections[c].items.length]));
  const byCertainty = { confirmed: 0, missing_evidence: 0, expected_pending: 0 };
  for (const c of categories) for (const item of sections[c].items) byCertainty[item.certainty] = (byCertainty[item.certainty] || 0) + 1;
  // Resolved discrepancies are counted, never re-listed: closed ReconciliationRecords and operator-resolved capture evidence.
  const resolved = { wallet_balance: await ReconciliationRecord.countDocuments({ kind: "wallet_balance", status: "resolved" }) };
  return { generatedAt: now.toISOString(), readOnly: true, page: p, limit: l, filters: { category: category || null, certainty: certainty || null, paymentId: paymentId || null, from: from || null, to: to || null }, summary, byCertainty, resolved, sections };
};

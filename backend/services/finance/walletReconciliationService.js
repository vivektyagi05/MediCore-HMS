import mongoose from "mongoose";
import Wallet from "../../models/Wallet.js";
import TransactionLedger from "../../models/TransactionLedger.js";
import ReconciliationRecord from "../../models/ReconciliationRecord.js";
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

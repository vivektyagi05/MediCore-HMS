import Wallet from "../models/Wallet.js";
import TransactionLedger from "../models/TransactionLedger.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const getWallet = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOneAndUpdate(
    { userId: req.user._id },
    { $setOnInsert: { userId: req.user._id, balance: 0, currency: "INR" } },
    { returnDocument: "after", upsert: true },
  ).lean();

  res.status(200).json({
    success: true,
    data: { wallet },
    message: "Wallet fetched successfully",
  });
});

// Wallet analytics: monthly credit/debit trend + category breakdown, built
// entirely from the existing TransactionLedger (financeController already
// writes wallet_credit/wallet_debit/refund entries there) — no new model,
// no fabricated data.
export const getWalletAnalytics = asyncHandler(async (req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const walletRelatedTypes = ["wallet_credit", "wallet_debit", "refund"];
  // P23 Section 11 FIX — AUDIT FINDING: this match had no status filter,
  // so pending/failed/reversed ledger rows (e.g. a wallet recharge still
  // awaiting gateway confirmation, or one that failed) were being summed
  // into the trend/breakdown alongside genuinely completed activity,
  // overstating both. Only "posted" entries represent real, completed
  // financial activity.
  const baseMatch = { userId: req.user._id, type: { $in: walletRelatedTypes }, status: "posted" };

  const [monthlyTrend, categoryBreakdown, securityHistory] = await Promise.all([
    TransactionLedger.aggregate([
      { $match: { ...baseMatch, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, direction: "$direction" },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    TransactionLedger.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$type", totalAmount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    // Security history reuses the ledger itself (every credit/debit is
    // already an auditable, timestamped record) rather than a separate
    // "security log" that doesn't exist in this schema.
    TransactionLedger.find(baseMatch).sort({ createdAt: -1 }).limit(10).select("type direction amount status createdAt").lean(),
  ]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const trendByMonth = {};
  monthlyTrend.forEach((entry) => {
    const key = `${monthNames[entry._id.month - 1]} ${entry._id.year}`;
    if (!trendByMonth[key]) trendByMonth[key] = { month: key, credit: 0, debit: 0 };
    trendByMonth[key][entry._id.direction] = entry.totalAmount;
  });

  res.status(200).json({
    success: true,
    data: {
      monthlyTrend: Object.values(trendByMonth),
      categoryBreakdown: categoryBreakdown.map((entry) => ({
        type: entry._id,
        totalAmount: entry.totalAmount,
        count: entry.count,
      })),
      recentActivity: securityHistory,
    },
    message: "Wallet analytics fetched successfully",
  });
});

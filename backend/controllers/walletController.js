import Wallet from "../models/Wallet.js";
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

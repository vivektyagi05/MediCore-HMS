// P23 Section 22/23/27 — the doctor-facing half of the withdrawal domain.
import mongoose from "mongoose";
import Doctor from "../../models/Doctor.js";
import Withdrawal from "../../models/Withdrawal.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";
import {
  computeDoctorWithdrawableBalance,
  getWithdrawalLimits,
  reserveWithdrawal,
} from "../../services/finance/withdrawalService.js";

async function resolveDoctorId(req) {
  const doctor = await Doctor.findOne({ userId: req.user._id }).select("_id").lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  return doctor._id;
}

// STEP 3 of the withdrawal flow (Section 23) — "Server calculates actual
// available amount". Exposed as its own read so the frontend never has to
// guess or reuse a stale earnings number when opening the withdraw form.
export const getWithdrawalBalance = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const balance = await computeDoctorWithdrawableBalance(doctorId);
  const limits = getWithdrawalLimits();
  res.status(200).json({
    success: true,
    data: { ...balance, ...limits },
    message: "Withdrawable balance fetched successfully",
  });
});

export const requestWithdrawal = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const { amount, destinationLabel, idempotencyKey } = req.body;

  const requestedAmount = Number(amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new AppError("A valid withdrawal amount is required", 400);
  }
  if (!destinationLabel || typeof destinationLabel !== "string" || !destinationLabel.trim()) {
    throw new AppError("A payout destination is required", 400);
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length < 8) {
    throw new AppError("A valid idempotency key is required", 400);
  }

  const { minAmount, maxAmount, dailyMaxAmount } = getWithdrawalLimits();
  if (requestedAmount < minAmount) {
    throw new AppError(`Minimum withdrawal amount is ${minAmount}`, 400);
  }
  if (maxAmount && requestedAmount > maxAmount) {
    throw new AppError(`Maximum withdrawal amount is ${maxAmount}`, 400);
  }
  if (dailyMaxAmount) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todaysTotal = await Withdrawal.aggregate([
      { $match: { doctorId, createdAt: { $gte: startOfDay }, status: { $ne: "cancelled" } } },
      { $group: { _id: null, sum: { $sum: "$requestedAmount" } } },
    ]);
    const usedToday = todaysTotal[0]?.sum || 0;
    if (usedToday + requestedAmount > dailyMaxAmount) {
      throw new AppError(`This would exceed today's withdrawal limit of ${dailyMaxAmount}`, 400);
    }
  }

  const existing = await Withdrawal.findOne({ idempotencyKey }).lean();
  if (existing) {
    return res.status(200).json({ success: true, data: { withdrawal: existing }, message: "Existing withdrawal request returned" });
  }

  let withdrawal;
  try {
    withdrawal = await reserveWithdrawal({
      doctorId,
      requestedAmount,
      destinationLabel: destinationLabel.trim(),
      requestedBy: req.user._id,
      idempotencyKey,
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.idempotencyKey) {
      const raced = await Withdrawal.findOne({ idempotencyKey }).lean();
      if (raced) return res.status(200).json({ success: true, data: { withdrawal: raced }, message: "Existing withdrawal request returned" });
    }
    throw error;
  }

  res.status(201).json({
    success: true,
    data: { withdrawal },
    message: "Withdrawal requested successfully",
  });
});

export const getMyWithdrawals = asyncHandler(async (req, res) => {
  const doctorId = await resolveDoctorId(req);
  const { page, pageSize } = clampPagination(req.query.page, req.query.pageSize);
  const filter = { doctorId };
  if (req.query.status) filter.status = req.query.status;

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { withdrawals, pagination: buildPaginationMeta(page, pageSize, total) },
    message: "Withdrawals fetched successfully",
  });
});

export const getWithdrawalDetail = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid withdrawal id", 400);
  const doctorId = await resolveDoctorId(req);
  const withdrawal = await Withdrawal.findOne({ _id: req.params.id, doctorId }).lean();
  if (!withdrawal) throw new AppError("Withdrawal not found", 404);
  res.status(200).json({ success: true, data: { withdrawal }, message: "Withdrawal detail fetched successfully" });
});

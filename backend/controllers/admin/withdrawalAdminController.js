import mongoose from "mongoose";
import Withdrawal, { WITHDRAWAL_STATUS } from "../../models/Withdrawal.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { appendWithdrawalTransition } from "../../payments/withdrawalStateMachine.js";
import { computeDoctorWithdrawableBalance } from "../../services/finance/withdrawalService.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

// Admin withdrawal workspace list (Section 28). No arbitrary status
// dropdown is exposed by this endpoint's shape — the frontend renders
// only the specific transition actions valid from each row's current
// status, sourced from withdrawalStateMachine's own WITHDRAWAL_TRANSITIONS.
export const listWithdrawalsAdmin = asyncHandler(async (req, res) => {
  const { page, pageSize } = clampPagination(req.query.page, req.query.pageSize);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.doctorId && mongoose.Types.ObjectId.isValid(req.query.doctorId)) filter.doctorId = req.query.doctorId;

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate({ path: "doctorId", select: "specialization userId", populate: { path: "userId", select: "name email" } })
      .populate("requestedBy", "name email")
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

export const getWithdrawalDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid withdrawal id", 400);
  const withdrawal = await Withdrawal.findById(req.params.id)
    .populate({ path: "doctorId", select: "specialization userId", populate: { path: "userId", select: "name email" } })
    .populate("requestedBy", "name email")
    .populate("processedBy", "name email")
    .lean();
  if (!withdrawal) throw new AppError("Withdrawal not found", 404);
  const currentBalance = await computeDoctorWithdrawableBalance(withdrawal.doctorId._id);
  res.status(200).json({ success: true, data: { withdrawal, currentBalance }, message: "Withdrawal detail fetched successfully" });
});

// Shared transition applier — every admin action below funnels through
// this so no route can assign an arbitrary status directly.
const applyTransition = async ({ req, res, to, reasonFallback }) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid withdrawal id", 400);
  const withdrawal = await Withdrawal.findById(req.params.id);
  if (!withdrawal) throw new AppError("Withdrawal not found", 404);

  appendWithdrawalTransition(withdrawal, to, {
    actorId: req.user._id,
    source: "admin",
    reason: req.body.reason || reasonFallback,
  });

  if (to === WITHDRAWAL_STATUS.PROCESSING) {
    withdrawal.approvedAmount = req.body.approvedAmount ? Number(req.body.approvedAmount) : withdrawal.requestedAmount;
    withdrawal.processedBy = req.user._id;
  }
  if (to === WITHDRAWAL_STATUS.COMPLETED) {
    withdrawal.processedAmount = withdrawal.approvedAmount || withdrawal.requestedAmount;
    withdrawal.completedAt = new Date();
    withdrawal.processedBy = req.user._id;
  }
  if (to === WITHDRAWAL_STATUS.FAILED) {
    withdrawal.failureReason = req.body.reason || "Withdrawal could not be completed";
    withdrawal.processedBy = req.user._id;
  }

  await withdrawal.save();

  await writeAdminLog({
    actorId: req.user._id,
    action: `withdrawal:${to}`,
    entityType: "withdrawal",
    entityId: withdrawal._id,
    details: { to, reason: req.body.reason || reasonFallback },
  }).catch(() => {});

  res.status(200).json({ success: true, data: { withdrawal }, message: `Withdrawal moved to ${to}` });
};

export const markWithdrawalProcessing = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.PROCESSING, reasonFallback: "Admin approved for processing" }));

export const completeWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.COMPLETED, reasonFallback: "Admin marked settled" }));

export const failWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.FAILED, reasonFallback: "Admin marked failed" }));

export const retryWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.RETRY_REQUIRED, reasonFallback: "Admin flagged for retry" }));

export const cancelWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.CANCELLED, reasonFallback: "Admin cancelled withdrawal" }));

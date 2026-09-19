import mongoose from "mongoose";
import Withdrawal, { WITHDRAWAL_STATUS } from "../../models/Withdrawal.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { assertWithdrawalTransition } from "../../payments/withdrawalStateMachine.js";
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

// PHASE 2-C — Section 16/33 bugfix: this was a load -> mutate in memory ->
// save() sequence with no atomicity between the read and the write. Two
// concurrent admin actions on the same withdrawal (double-click "Complete",
// or "Complete" racing "Fail" from two admin tabs) could both load the same
// `from` status, both pass appendWithdrawalTransition's in-memory
// assertWithdrawalTransition check, and both write -- doubling the
// financial mutation this guards (a withdrawal marked both completed AND
// failed, or processedAmount/completedAt set twice by two different
// admins). Fixed the same way as the doctor approval race (Section 8/9):
// the transition's `from` status becomes part of the atomic
// findOneAndUpdate filter itself, so only the one request that observes
// the expected current status in the database ever applies its side
// effects; every other concurrent caller gets an honest 409 instead of a
// silently-doubled mutation.
const applyTransition = async ({ req, res, to, reasonFallback }) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid withdrawal id", 400);

  const existing = await Withdrawal.findById(req.params.id);
  if (!existing) throw new AppError("Withdrawal not found", 404);

  const from = existing.status || "requested";
  // Validate the transition shape up front (also throws the friendly 409
  // if the currently-known status already forbids it) before touching the
  // database, exactly as the prior single-document flow did.
  assertWithdrawalTransition(from, to);

  const reason = req.body.reason || reasonFallback;
  const setFields = {
    status: to,
  };
  if (to === WITHDRAWAL_STATUS.PROCESSING) {
    setFields.approvedAmount = req.body.approvedAmount ? Number(req.body.approvedAmount) : existing.requestedAmount;
    setFields.processedBy = req.user._id;
  }
  if (to === WITHDRAWAL_STATUS.COMPLETED) {
    setFields.processedAmount = existing.approvedAmount || existing.requestedAmount;
    setFields.completedAt = new Date();
    setFields.processedBy = req.user._id;
  }
  if (to === WITHDRAWAL_STATUS.FAILED) {
    setFields.failureReason = req.body.reason || "Withdrawal could not be completed";
    setFields.processedBy = req.user._id;
  }

  const withdrawal = await Withdrawal.findOneAndUpdate(
    { _id: req.params.id, status: from },
    {
      $set: setFields,
      $push: { stateHistory: { from, to, actorId: req.user._id, source: "admin", reason, at: new Date() } },
    },
    { new: true },
  );

  if (!withdrawal) {
    // Lost the race: someone else's request already moved this withdrawal
    // out of the `from` status we validated against. Re-read for an
    // honest response instead of a false "moved to X" success.
    const current = await Withdrawal.findById(req.params.id).lean();
    throw new AppError(
      `Withdrawal is no longer in "${from}" status (current status: ${current?.status || "unknown"})`,
      409,
    );
  }

  await writeAdminLog({
    actorId: req.user._id,
    action: `withdrawal:${to}`,
    entityType: "withdrawal",
    entityId: withdrawal._id,
    details: { to, reason },
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

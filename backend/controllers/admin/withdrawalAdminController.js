import mongoose from "mongoose";
import { financeEmitter } from "../../realtime/financeEmitter.js";
import Doctor from "../../models/Doctor.js";
import { financialEmails } from "../../services/financialEmails.js";
import Withdrawal, { WITHDRAWAL_STATUS } from "../../models/Withdrawal.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { assertWithdrawalTransition } from "../../payments/withdrawalStateMachine.js";
import { computeDoctorWithdrawableBalance, claimBalance, releaseBalance, postWithdrawalLedger, reconcileWithdrawalGate } from "../../services/finance/withdrawalService.js";
import { toPaise } from "../../payments/money.js";
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
  assertWithdrawalTransition(from, to);

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  const setFields = { status: to };
  let claimedPaise = 0; // balance re-claimed for a retry; released if the update loses a race

  if (to === WITHDRAWAL_STATUS.MANUAL_PENDING) {
    setFields.approvedAmount = existing.requestedAmount; // amount is never taken from the request body
    setFields.processedBy = req.user._id;
    setFields.settlementMode = "manual";
  }
  if (to === WITHDRAWAL_STATUS.MANUAL_COMPLETED) {
    // F-002: this records that an authorized admin confirmed an OUT-OF-BAND
    // settlement. It requires an external reference and a reason, and it is
    // never presented as a verified bank transfer.
    const reference = typeof req.body.settlementReference === "string" ? req.body.settlementReference.trim() : "";
    if (!reference) throw new AppError("A manual settlement reference (e.g. bank/UTR reference) is required", 400);
    if (!reason) throw new AppError("A reason is required to record manual settlement", 400);
    setFields.processedAmount = existing.approvedAmount || existing.requestedAmount;
    setFields.completedAt = new Date();
    setFields.settledAt = new Date();
    setFields.settledBy = req.user._id;
    setFields.processedBy = req.user._id;
    setFields.settlementMode = "manual";
    setFields.settlementReference = reference;
    setFields.settlementReason = reason;
  }
  if (to === WITHDRAWAL_STATUS.FAILED) {
    setFields.failureReason = reason || "Withdrawal could not be completed";
    setFields.processedBy = req.user._id;
  }

  const releasing = (to === WITHDRAWAL_STATUS.FAILED || to === WITHDRAWAL_STATUS.CANCELLED) && existing.reservationHeld;
  const reclaiming = from === WITHDRAWAL_STATUS.FAILED && to === WITHDRAWAL_STATUS.RETRY_REQUIRED && !existing.reservationHeld;
  if (releasing) setFields.reservationHeld = false;
  if (reclaiming) {
    claimedPaise = toPaise(existing.requestedAmount);
    if (!(await claimBalance(existing.doctorId, claimedPaise))) {
      throw new AppError("The doctor's available balance no longer covers this withdrawal, so it cannot be retried", 409);
    }
    setFields.reservationHeld = true;
  }

  const withdrawal = await Withdrawal.findOneAndUpdate(
    { _id: req.params.id, status: from, reservationHeld: Boolean(existing.reservationHeld) },
    {
      $set: setFields,
      $push: { stateHistory: { from, to, actorId: req.user._id, source: "admin", reason: reason || reasonFallback, at: new Date() } },
    },
    { new: true },
  );

  if (!withdrawal) {
    if (claimedPaise) await releaseBalance(existing.doctorId, claimedPaise);
    const current = await Withdrawal.findById(req.params.id).lean();
    throw new AppError(
      `Withdrawal is no longer in "${from}" status (current status: ${current?.status || "unknown"})`,
      409,
    );
  }

  // Post-commit accounting. The conditional update above is the exactly-once
  // guard; these are idempotent (ledger keys) / drift-detectable (gate counter).
  if (releasing) {
    await releaseBalance(withdrawal.doctorId, toPaise(withdrawal.requestedAmount));
    await postWithdrawalLedger({ withdrawal, type: "withdrawal_release", direction: "credit", amount: withdrawal.requestedAmount, key: "release" });
  }
  if (to === WITHDRAWAL_STATUS.MANUAL_COMPLETED) {
    await postWithdrawalLedger({ withdrawal, type: "withdrawal_settlement", direction: "debit", amount: withdrawal.processedAmount, key: "settle" });
  }

  {
    const doctorForSync = await Doctor.findById(withdrawal.doctorId).select("userId").lean();
    financeEmitter.invalidate({ userIds: [doctorForSync?.userId], domain: "withdrawal", entityId: withdrawal._id });
  }
  if (to === WITHDRAWAL_STATUS.MANUAL_COMPLETED || to === WITHDRAWAL_STATUS.FAILED) {
    const doctor = await Doctor.findById(withdrawal.doctorId).populate("userId", "name email").lean();
    const user = doctor?.userId;
    if (to === WITHDRAWAL_STATUS.MANUAL_COMPLETED) await financialEmails.withdrawalManuallySettled({ withdrawal, user });
    else await financialEmails.withdrawalFailed({ withdrawal, user });
  }

  await writeAdminLog({
    actorId: req.user._id,
    action: `withdrawal:${to}`,
    entityType: "withdrawal",
    entityId: withdrawal._id,
    details: { to, reason, settlementReference: setFields.settlementReference },
  }).catch(() => {});

  res.status(200).json({ success: true, data: { withdrawal }, message: `Withdrawal moved to ${to}` });
};

export const markWithdrawalProcessing = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.MANUAL_PENDING, reasonFallback: "Admin approved for manual settlement" }));

export const completeWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.MANUAL_COMPLETED, reasonFallback: "Admin recorded manual settlement" }));

export const failWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.FAILED, reasonFallback: "Admin marked failed" }));

export const retryWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.RETRY_REQUIRED, reasonFallback: "Admin flagged for retry" }));

export const cancelWithdrawal = asyncHandler((req, res) =>
  applyTransition({ req, res, to: WITHDRAWAL_STATUS.CANCELLED, reasonFallback: "Admin cancelled withdrawal" }));

// F-012/F-014: read-only drift report between the reservation gate and the
// Withdrawal rows. Never repairs; repair is a separate, reasoned, audited action.
export const reconcileDoctorWithdrawalGate = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.doctorId)) throw new AppError("Invalid doctor id", 400);
  const report = await reconcileWithdrawalGate(req.params.doctorId);
  res.status(200).json({ success: true, data: { report }, message: report.ok ? "Withdrawal reservations reconcile" : "Withdrawal reservation drift detected" });
});

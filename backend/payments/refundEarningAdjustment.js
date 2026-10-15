import DoctorPayout from "../models/DoctorPayout.js";
import Doctor from "../models/Doctor.js";
import TransactionLedger from "../models/TransactionLedger.js";
import { fromPaise, toPaise } from "./money.js";

// Round-half-up integer proportion: round(a * b / c) without float error or
// 2^53 overflow (a*b can reach 1e16 paise^2).
const proportion = (a, b, c) => {
  if (c <= 0) return 0;
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return Number((num * 2n + den) / (2n * den));
};

/**
 * PURE. How much of a refund reverses the doctor's earning vs. the platform's
 * revenue. Proportional for a partial refund; the FINAL refund (the one that
 * brings the cumulative refunded amount to the payment total) takes the exact
 * remainder so rounding can never leave dust and doctor + platform adjustments
 * always sum to the gross in the end. Never exceeds what remains un-adjusted.
 */
export const computeEarningAdjustment = ({ payout, refundAmount, paymentTotal, refundedBefore = 0 }) => {
  const grossP = toPaise(payout.grossAmount);
  const doctorP = toPaise(payout.doctorAmount);
  const platformP = Math.max(0, grossP - doctorP);
  const doctorDoneP = toPaise(payout.refundAdjustmentAmount || 0);
  const platformDoneP = toPaise(payout.platformRefundAdjustmentAmount || 0);
  const refundP = toPaise(refundAmount);
  const totalP = toPaise(paymentTotal);
  const isFinal = toPaise(refundedBefore) + refundP >= totalP;

  const doctorRoom = Math.max(0, doctorP - doctorDoneP);
  const platformRoom = Math.max(0, platformP - platformDoneP);
  const doctorAdjP = Math.min(doctorRoom, isFinal ? doctorRoom : proportion(doctorP, refundP, totalP));
  const platformAdjP = Math.min(platformRoom, isFinal ? platformRoom : proportion(platformP, refundP, totalP));
  return { doctorAdjustment: fromPaise(doctorAdjP), platformAdjustment: fromPaise(platformAdjP), isFinal };
};

/**
 * Apply one refund to the doctor's earning, exactly once per `refundKey`.
 *  - pending payout, partial refund: the payout stays pending; its NET amount
 *    (doctorAmount - refundAdjustmentAmount) shrinks. It is only cancelled
 *    once the whole doctor share has been reversed.
 *  - settled (paid) payout: the reversal becomes a recoverable liability that
 *    the withdrawable-balance calculation subtracts (never money from nowhere).
 * Original gross/platform/doctor amounts are never mutated; every adjustment is
 * an immutable entry plus compensating ledger postings.
 * Optimistic conditional update: safe against a concurrent settlement.
 */
export const applyRefundToDoctorEarning = async ({ paymentId, refundAmount, paymentTotal, refundedBefore, refundKey, gatewayRefundId = null, actorId = null }) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payout = await DoctorPayout.findOne({ paymentId }).lean();
    if (!payout) return { applied: false, reason: "no_payout" };
    if ((payout.refundAdjustments || []).some((entry) => entry.refundKey === refundKey)) {
      return { applied: false, replay: true, payout };
    }

    const { doctorAdjustment, platformAdjustment } = computeEarningAdjustment({ payout, refundAmount, paymentTotal, refundedBefore });
    const newDoctorTotalP = toPaise(payout.refundAdjustmentAmount || 0) + toPaise(doctorAdjustment);
    const fullyReversed = newDoctorTotalP >= toPaise(payout.doctorAmount);

    const set = { adjustedAt: new Date() };
    if (gatewayRefundId) set.refundReference = gatewayRefundId;
    if (payout.status === "pending") {
      set.liabilityStatus = "adjusted_settled"; // reduction applied before any money moved
      if (fullyReversed) {
        set.status = "cancelled";
        set.cancelReason = `Fully refunded (${gatewayRefundId || "wallet-only"})`;
        if (actorId) set.settledBy = actorId;
      }
    } else if (payout.status === "paid") {
      set.liabilityStatus = "adjusted_pending"; // already settled: recoverable balance offset
    }

    const updated = await DoctorPayout.findOneAndUpdate(
      {
        _id: payout._id,
        status: payout.status,
        "refundAdjustments.refundKey": { $ne: refundKey },
        refundAdjustmentAmount: payout.refundAdjustmentAmount || 0,
      },
      {
        $set: set,
        $inc: { refundAdjustmentAmount: doctorAdjustment, platformRefundAdjustmentAmount: platformAdjustment },
        $push: {
          refundAdjustments: {
            refundKey, refundAmount, doctorAdjustment, platformAdjustment, gatewayRefundId,
            payoutStatusAtAdjustment: payout.status, actorId, at: new Date(),
          },
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) continue; // lost a race with settlement/another adjustment: re-read and recompute

    // Compensating, immutable ledger postings (idempotent via unique keys).
    const doctor = await Doctor.findById(payout.doctorId).select("userId").lean();
    const base = { paymentId, doctorId: payout.doctorId, userId: doctor?.userId, currency: "INR", referenceId: refundKey, direction: "debit" };
    for (const [type, amount, key] of [
      ["doctor_earning_reversal", doctorAdjustment, `refund:earning:${refundKey}`],
      ["platform_fee_reversal", platformAdjustment, `refund:platform:${refundKey}`],
    ]) {
      if (amount <= 0) continue;
      try {
        await TransactionLedger.create({ ...base, type, amount, idempotencyKey: key, metadata: { payoutId: payout._id, payoutStatus: payout.status, gatewayRefundId } });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
    return { applied: true, payout: updated, doctorAdjustment, platformAdjustment, becameLiability: payout.status === "paid", doctorUserId: doctor?.userId };
  }
  throw new Error("Could not apply refund to doctor earning after repeated concurrent changes");
};

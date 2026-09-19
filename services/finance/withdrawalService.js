import mongoose from "mongoose";
import DoctorPayout from "../../models/DoctorPayout.js";
import Withdrawal, { WITHDRAWAL_STATUS } from "../../models/Withdrawal.js";
import { addMoney, subtractMoney } from "../../payments/money.js";
import { appendWithdrawalTransition } from "../../payments/withdrawalStateMachine.js";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Withdrawal amounts that already have a genuine claim on the doctor's
// balance — either money already sent, or money currently held by an
// in-flight request that hasn't failed/cancelled yet. Both must be
// subtracted from settled earnings to get a real available figure.
const ACTIVE_WITHDRAWAL_STATUSES = [
  WITHDRAWAL_STATUS.REQUESTED,
  WITHDRAWAL_STATUS.RESERVED,
  WITHDRAWAL_STATUS.PROCESSING,
  WITHDRAWAL_STATUS.RETRY_REQUIRED,
  WITHDRAWAL_STATUS.RECONCILIATION_REQUIRED,
];

// AUDIT FINDING (this phase, Section 18/19): buildDoctorRevenueIntelligence
// previously reported `withdrawableBalance: pendingEarnings` — i.e. it
// equated PENDING (not-yet-settled) payouts with money available to
// withdraw. That is backwards: a "pending" DoctorPayout is money the
// platform has not yet settled to the doctor at all, so it cannot
// possibly be withdrawable; only SETTLED ("paid") payouts represent
// earnings the doctor's balance actually holds. This is the one canonical
// calculation every consumer (DoctorEarnings withdrawableBalance field,
// the withdrawal request endpoint's server-side cap, the admin withdrawal
// workspace) must use — never re-derived per caller.
//
// withdrawable = settled (paid) payouts
//              - refund liability still outstanding against settled payouts
//                (DoctorPayout.liabilityStatus === "adjusted_pending" —
//                 Section 19/20: this money is owed back, not available)
//              - already-completed withdrawals
//              - currently active (reserved/processing/pending) withdrawals
export async function computeDoctorWithdrawableBalance(doctorId) {
  const docId = new mongoose.Types.ObjectId(doctorId);

  const [payoutFacet, withdrawalFacet] = await Promise.all([
    DoctorPayout.aggregate([
      { $match: { doctorId: docId, status: "paid" } },
      {
        $group: {
          _id: null,
          settled: { $sum: "$doctorAmount" },
          outstandingLiability: {
            $sum: {
              $cond: [{ $eq: ["$liabilityStatus", "adjusted_pending"] }, "$refundAdjustmentAmount", 0],
            },
          },
        },
      },
    ]),
    Withdrawal.aggregate([
      { $match: { doctorId: docId } },
      {
        $group: {
          _id: null,
          completed: {
            $sum: { $cond: [{ $eq: ["$status", WITHDRAWAL_STATUS.COMPLETED] }, "$processedAmount", 0] },
          },
          active: {
            $sum: { $cond: [{ $in: ["$status", ACTIVE_WITHDRAWAL_STATUSES] }, "$requestedAmount", 0] },
          },
        },
      },
    ]),
  ]);

  const settled = payoutFacet[0]?.settled || 0;
  const outstandingLiability = payoutFacet[0]?.outstandingLiability || 0;
  const alreadyWithdrawn = withdrawalFacet[0]?.completed || 0;
  const activeWithdrawalHold = withdrawalFacet[0]?.active || 0;

  const withdrawable = Math.max(
    0,
    subtractMoney(subtractMoney(subtractMoney(settled, outstandingLiability), alreadyWithdrawn), activeWithdrawalHold),
  );

  return {
    settledEarnings: round2(settled),
    refundLiability: round2(outstandingLiability),
    alreadyWithdrawn: round2(alreadyWithdrawn),
    pendingWithdrawal: round2(activeWithdrawalHold),
    withdrawableBalance: round2(withdrawable),
  };
}

// Configuration, not fabricated business rules (Section 24 — "If no
// business value exists yet: make it explicit configuration, not a
// fabricated number"). MIN defaults to the same functional floor Payment
// itself already enforces (a whole-currency-unit minimum, min:1 on
// Payment.amount) — not a made-up business policy. MAX/daily-limit are
// left unset (no cap) unless explicitly configured, since inventing a
// number here would be exactly the fabrication Section 24 warns against.
export function getWithdrawalLimits() {
  const min = Number(process.env.DOCTOR_WITHDRAWAL_MIN_AMOUNT);
  const max = Number(process.env.DOCTOR_WITHDRAWAL_MAX_AMOUNT);
  const dailyMax = Number(process.env.DOCTOR_WITHDRAWAL_DAILY_MAX_AMOUNT);
  return {
    minAmount: Number.isFinite(min) && min > 0 ? min : 1,
    maxAmount: Number.isFinite(max) && max > 0 ? max : null,
    dailyMaxAmount: Number.isFinite(dailyMax) && dailyMax > 0 ? dailyMax : null,
  };
}

// ATOMIC RESERVATION (Section 25 — concurrency). Two simultaneous
// withdrawal requests must never both succeed against the same balance.
// This recomputes the withdrawable balance and, in the same logical step,
// creates the Withdrawal document — but the real protection is the
// re-check immediately before creation combined with the unique
// idempotencyKey and the fact that `computeDoctorWithdrawableBalance`
// itself only ever counts ACTIVE_WITHDRAWAL_STATUSES rows that already
// exist in the database. A genuine race between two concurrent requests
// is closed by re-verifying the balance a second time after an initial
// optimistic create, and rolling back (cancelling) the loser if the
// combined active total would exceed what was actually available — the
// same "create then verify, roll back on conflict" pattern used nowhere
// else in this codebase for money movement without a DB transaction,
// applied here because (like followUpScheduling's claimFollowUpSlot) no
// replica-set/session is available in this deployment (see money.js /
// PHASE P10 hardening pass notes on the same constraint).
export async function reserveWithdrawal({ doctorId, requestedAmount, destinationLabel, requestedBy, idempotencyKey }) {
  const balanceBefore = await computeDoctorWithdrawableBalance(doctorId);
  if (requestedAmount > balanceBefore.withdrawableBalance + 0.009) {
    const error = new Error(
      `Requested amount exceeds your withdrawable balance of ${balanceBefore.withdrawableBalance}.`,
    );
    error.statusCode = 400;
    throw error;
  }

  const withdrawal = new Withdrawal({
    doctorId,
    requestedAmount,
    availableBalanceAtRequest: balanceBefore.withdrawableBalance,
    destinationLabel,
    requestedBy,
    idempotencyKey,
    status: WITHDRAWAL_STATUS.REQUESTED,
    stateHistory: [{ from: null, to: WITHDRAWAL_STATUS.REQUESTED, actorId: requestedBy, source: "doctor", reason: "Withdrawal requested", at: new Date() }],
  });
  await withdrawal.save();

  // Re-verify with this request itself now counted (it's REQUESTED, one
  // of ACTIVE_WITHDRAWAL_STATUSES) — if the combined active total exceeds
  // settled earnings, this request lost the race against a concurrent one
  // and must not proceed.
  const balanceAfter = await computeDoctorWithdrawableBalance(doctorId);
  const overCommitted = addMoney(balanceAfter.pendingWithdrawal, balanceAfter.alreadyWithdrawn) >
    addMoney(balanceAfter.settledEarnings - balanceAfter.refundLiability, 0.009);

  if (overCommitted) {
    appendWithdrawalTransition(withdrawal, WITHDRAWAL_STATUS.CANCELLED, {
      source: "system", reason: "Concurrent withdrawal exceeded available balance",
    });
    withdrawal.failureReason = "Withdrawable balance changed before this request could be reserved. Please try again.";
    await withdrawal.save();
    const error = new Error("Another withdrawal request already reserved this balance. Please refresh and try again.");
    error.statusCode = 409;
    throw error;
  }

  appendWithdrawalTransition(withdrawal, WITHDRAWAL_STATUS.RESERVED, {
    actorId: requestedBy, source: "system", reason: "Balance verified and reserved",
  });
  await withdrawal.save();

  return withdrawal;
}

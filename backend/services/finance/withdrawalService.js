import mongoose from "mongoose";
import DoctorPayout from "../../models/DoctorPayout.js";
import Withdrawal, { WITHDRAWAL_STATUS } from "../../models/Withdrawal.js";
import WithdrawalReservationGate from "../../models/WithdrawalReservationGate.js";
import TransactionLedger from "../../models/TransactionLedger.js";
import { subtractMoney, toPaise, fromPaise } from "../../payments/money.js";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Withdrawal amounts that already have a genuine claim on the doctor's
// balance — either money already sent, or money currently held by an
// in-flight request that hasn't failed/cancelled yet. Both must be
// subtracted from settled earnings to get a real available figure.
const ACTIVE_WITHDRAWAL_STATUSES = [
  WITHDRAWAL_STATUS.REQUESTED,
  WITHDRAWAL_STATUS.RESERVED,
  WITHDRAWAL_STATUS.PROCESSING,
  WITHDRAWAL_STATUS.MANUAL_PENDING,
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
          // Every settled payout's refund reversal (whether it was recorded
          // before or after settlement) reduces what is withdrawable.
          outstandingLiability: { $sum: { $ifNull: ["$refundAdjustmentAmount", 0] } },
        },
      },
    ]),
    Withdrawal.aggregate([
      { $match: { doctorId: docId } },
      {
        $group: {
          _id: null,
          completed: {
            $sum: { $cond: [{ $in: ["$status", [WITHDRAWAL_STATUS.COMPLETED, WITHDRAWAL_STATUS.MANUAL_COMPLETED]] }, "$processedAmount", 0] },
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

const COMMITTED_STATUSES = [...ACTIVE_WITHDRAWAL_STATUSES, WITHDRAWAL_STATUS.COMPLETED, WITHDRAWAL_STATUS.MANUAL_COMPLETED];

const postWithdrawalLedger = async ({ withdrawal, type, direction, amount, key }) => {
  try {
    await TransactionLedger.create({
      doctorId: withdrawal.doctorId, type, direction, amount, referenceId: String(withdrawal._id),
      idempotencyKey: `withdrawal:${key}:${withdrawal._id}`, metadata: { settlementMode: withdrawal.settlementMode || "manual" },
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
};
export { postWithdrawalLedger };

/** Net settled earnings (paise): settled payouts minus outstanding refund liability. */
const netEarningsPaise = async (doctorId) => {
  const b = await computeDoctorWithdrawableBalance(doctorId);
  return toPaise(b.settledEarnings) - toPaise(b.refundLiability);
};

/** What the gate SHOULD hold: every withdrawal that claims balance, in paise. */
export const expectedCommittedPaise = async (doctorId) => {
  const rows = await Withdrawal.find({ doctorId, status: { $in: COMMITTED_STATUSES } }).select("requestedAmount processedAmount status").lean();
  return rows.reduce((sum, w) => {
    const done = w.status === WITHDRAWAL_STATUS.COMPLETED || w.status === WITHDRAWAL_STATUS.MANUAL_COMPLETED;
    return sum + toPaise(done ? (w.processedAmount ?? w.requestedAmount) : w.requestedAmount);
  }, 0);
};

const ensureGate = async (doctorId) => {
  try {
    await WithdrawalReservationGate.updateOne({ doctorId }, { $setOnInsert: { committedPaise: await expectedCommittedPaise(doctorId) } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error; // concurrent creator won
  }
};

/** Atomic claim of `amountPaise` against the doctor's net earnings. Returns true if claimed. */
export const claimBalance = async (doctorId, amountPaise) => {
  await ensureGate(doctorId);
  const net = await netEarningsPaise(doctorId);
  const claimed = await WithdrawalReservationGate.findOneAndUpdate(
    { doctorId, committedPaise: { $lte: net - amountPaise } },
    { $inc: { committedPaise: amountPaise } },
    { returnDocument: "after" },
  );
  return Boolean(claimed);
};

export const releaseBalance = async (doctorId, amountPaise) => {
  await WithdrawalReservationGate.updateOne({ doctorId, committedPaise: { $gte: amountPaise } }, { $inc: { committedPaise: -amountPaise } });
};

/** Reports drift between the gate counter and the Withdrawal rows. Never auto-repairs. */
export const reconcileWithdrawalGate = async (doctorId) => {
  const gate = await WithdrawalReservationGate.findOne({ doctorId }).lean();
  const expected = await expectedCommittedPaise(doctorId);
  const actual = gate?.committedPaise ?? 0;
  return { doctorId: String(doctorId), expectedPaise: expected, actualPaise: actual, driftPaise: actual - expected, ok: actual === expected };
};

/**
 * F-014: reservation is ONE conditional $inc on the per-doctor gate, then the
 * Withdrawal row is written already `reserved` with reservationHeld=true. If the
 * row cannot be written the claim is released. A crash between the two leaves a
 * detectable gate drift (reconcileWithdrawalGate), never a silent double-spend.
 */
export async function reserveWithdrawal({ doctorId, requestedAmount, destinationLabel, requestedBy, idempotencyKey }) {
  const amountPaise = toPaise(requestedAmount);
  if (!(amountPaise > 0)) {
    const error = new Error("A valid withdrawal amount is required");
    error.statusCode = 400;
    throw error;
  }
  const balanceBefore = await computeDoctorWithdrawableBalance(doctorId);
  if (!(await claimBalance(doctorId, amountPaise))) {
    const error = new Error(`Requested amount exceeds your withdrawable balance of ${balanceBefore.withdrawableBalance}.`);
    error.statusCode = 400;
    throw error;
  }
  let withdrawal;
  try {
    withdrawal = await Withdrawal.create({
      doctorId,
      requestedAmount: fromPaise(amountPaise),
      availableBalanceAtRequest: balanceBefore.withdrawableBalance,
      destinationLabel,
      requestedBy,
      idempotencyKey,
      status: WITHDRAWAL_STATUS.RESERVED,
      reservationHeld: true,
      settlementMode: "manual",
      stateHistory: [{ from: null, to: WITHDRAWAL_STATUS.RESERVED, actorId: requestedBy, source: "doctor", reason: "Balance atomically reserved", at: new Date() }],
    });
  } catch (error) {
    await releaseBalance(doctorId, amountPaise);
    throw error;
  }
  await postWithdrawalLedger({ withdrawal, type: "withdrawal_reservation", direction: "debit", amount: withdrawal.requestedAmount, key: "reserve" });
  return withdrawal;
}

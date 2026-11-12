// Phase 03 completion: the evidence behind one payment, for the SUPER_ADMIN drill-down. Read-only and a SAFE projection:
// no signatures, webhook payloads, raw provider responses, secrets or patient identity (the page already shows the patient
// block it always had). Every list is bounded.
import PaymentAttempt from "../../models/PaymentAttempt.js";
import WalletReservation from "../../models/WalletReservation.js";
import TransactionLedger from "../../models/TransactionLedger.js";
import DoctorPayout from "../../models/DoctorPayout.js";
import { toPaise } from "../../payments/money.js";

export const EVIDENCE_LIMITS = Object.freeze({ attempts: 20, transitions: 50, ledger: 100 });

/** Pure: how the payment's own counters line up, for display (not a repair input). */
export const summarizeAllocation = (payment) => ({
  totalPaise: toPaise(payment.totalAmount || 0), walletPaise: toPaise(payment.walletAmount || 0), gatewayPaise: toPaise(payment.gatewayAmount || 0),
  refundedPaise: toPaise(payment.refundedAmount || 0), walletRefundedPaise: toPaise(payment.walletRefundedAmount || 0), gatewayRefundedPaise: toPaise(payment.gatewayRefundedAmount || 0),
  providerRefundsCounted: (payment.processedGatewayRefundIds || []).length,
  allocationConsistent: toPaise(payment.walletAmount || 0) + toPaise(payment.gatewayAmount || 0) === toPaise(payment.totalAmount || 0),
  refundSplitConsistent: toPaise(payment.walletRefundedAmount || 0) + toPaise(payment.gatewayRefundedAmount || 0) === toPaise(payment.refundedAmount || 0),
});

export const buildPaymentEvidence = async (payment) => {
  const paymentId = payment._id;
  const [attempts, reservation, ledger, payout] = await Promise.all([
    PaymentAttempt.find({ paymentId }).select("attemptNumber status gatewayOrderId gatewayPaymentId amount currency failureReason failureCode startedAt completedAt").sort({ attemptNumber: -1 }).limit(EVIDENCE_LIMITS.attempts).lean(),
    WalletReservation.findOne({ paymentId }).select("status amountPaise releaseReason committedAt releasedAt recoveryAttempts lastError updatedAt").lean(),
    TransactionLedger.find({ paymentId }).select("type direction amount currency status referenceId idempotencyKey createdAt").sort({ createdAt: 1 }).limit(EVIDENCE_LIMITS.ledger).lean(),
    DoctorPayout.findOne({ paymentId }).select("status grossAmount platformFee doctorAmount refundAdjustmentAmount platformRefundAdjustmentAmount liabilityStatus").lean(),
  ]);
  const unresolvedCaptureCases = (payment.captureEvidence || []).filter((e) => !["verified_no_action", "refund_required"].includes(e?.resolution?.state || "open")).length;
  return {
    allocation: summarizeAllocation(payment),
    attempts: attempts.map((a) => ({ ...a, _id: undefined })),
    stateTransitions: (payment.stateHistory || []).slice(-EVIDENCE_LIMITS.transitions).map((t) => ({ from: t.from, to: t.to, source: t.source, reason: t.reason, at: t.at })),
    walletReservation: reservation || null,
    ledger,
    ledgerTruncated: ledger.length >= EVIDENCE_LIMITS.ledger,
    earning: payout || null,
    reconciliation: {
      paymentState: payment.paymentState || null, reconciliationState: payment.reconciliationState || "not_required",
      unresolvedCaptureCases, hasProviderPaymentId: Boolean(payment.paymentId),
    },
  };
};

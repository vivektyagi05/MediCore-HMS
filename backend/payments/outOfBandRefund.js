import { toPaise, fromPaise } from "./money.js";

const REFUNDABLE_STATUSES = new Set(["captured", "completed", "partially_refunded"]);

/**
 * F-003: pure decision for a provider refund this app did not initiate (e.g.
 * issued from the Razorpay dashboard). Integer paise only (A2). Never posts
 * money itself: it only says whether the canonical finalizer may run.
 */
export const planOutOfBandRefund = ({ payment, gatewayRefundId, providerAmountPaise }) => {
  if (!payment) return { action: "unknown_payment" };
  if ((payment.processedGatewayRefundIds || []).includes(gatewayRefundId)) return { action: "skip_duplicate" };
  const paise = Number(providerAmountPaise);
  if (!Number.isInteger(paise) || paise <= 0) return { action: "reconciliation_required", reason: "invalid_provider_amount" };
  if (!REFUNDABLE_STATUSES.has(payment.status)) return { action: "reconciliation_required", reason: `payment_status_${payment.status}` };
  const refundablePaise = toPaise(payment.totalAmount) - toPaise(payment.refundedAmount || 0);
  if (paise > refundablePaise) return { action: "reconciliation_required", reason: "exceeds_refundable_amount" };
  return { action: "finalize", amount: fromPaise(paise), paise };
};

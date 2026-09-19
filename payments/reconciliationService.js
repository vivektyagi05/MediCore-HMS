import Payment from "../models/Payment.js";
import Invoice from "../models/Invoice.js";
import DoctorPayout from "../models/DoctorPayout.js";
import TransactionLedger from "../models/TransactionLedger.js";
import RefundRequest from "../models/RefundRequest.js";
import Wallet from "../models/Wallet.js";
import { logger } from "../utils/logger.js";

export const reconciliationService = {
  async generateReport() {
    const payments = await Payment.find().limit(500).lean();
    const issues = [];
    for (const payment of payments) {
      if (!payment.razorpayOrderId) issues.push({ type: "missing_gateway_order", paymentId: payment._id });
      if (payment.status === "captured" || payment.status === "completed") {
        if (!payment.paymentId) issues.push({ type: "missing_capture_reference", paymentId: payment._id });
        const [invoice, payout, ledger] = await Promise.all([
          Invoice.findOne({ paymentId: payment._id }).lean(),
          DoctorPayout.findOne({ paymentId: payment._id }).lean(),
          TransactionLedger.findOne({ paymentId: payment._id, type: "payment", status: { $in: ["posted", "pending"] } }).lean(),
        ]);
        if (!invoice) issues.push({ type: "captured_missing_invoice", paymentId: payment._id });
        if (!payout) issues.push({ type: "captured_missing_payout", paymentId: payment._id });
        if (!ledger) issues.push({ type: "captured_missing_ledger", paymentId: payment._id });
      }
      if (Number(payment.refundedAmount || 0) > Number(payment.totalAmount || 0)) {
        issues.push({ type: "refund_exceeds_payment", paymentId: payment._id });
      }
      if (payment.refundStatus !== "none") {
        const refunds = await RefundRequest.find({ paymentId: payment._id, status: "processed" }).lean();
        const processedRefundTotal = refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
        if (Math.abs(processedRefundTotal - Number(payment.refundedAmount || 0)) > 0.01) {
          issues.push({ type: "refund_amount_mismatch", paymentId: payment._id, paymentRefundedAmount: payment.refundedAmount, processedRefundTotal });
        }
        for (const refund of refunds) {
          if (!refund.gatewayRefundId && !refund.razorpayRefundId) {
            issues.push({ type: "processed_refund_missing_gateway_reference", refundRequestId: refund._id });
          }
          const refundLedger = await TransactionLedger.findOne({ paymentId: payment._id, type: "refund", referenceId: refund.gatewayRefundId || refund.razorpayRefundId }).lean();
          if (!refundLedger) issues.push({ type: "refund_missing_ledger", refundRequestId: refund._id });
        }
      }
      if (payment.reconciliationState === "required" || payment.paymentState === "reconciliation_required") {
        issues.push({ type: "payment_requires_reconciliation", paymentId: payment._id });
      }
    }
    return { checked: payments.length, issues, generatedAt: new Date() };
  },

  // Finds payments that reached "captured" (money already taken) but never
  // finished the post-processing chain (verifyPayment's downstream steps
  // failed after capture — see completePaymentPostProcessing). Detected by
  // absence of an Invoice or DoctorPayout for a captured payment.
  async findIncompletePayments() {
    const capturedPayments = await Payment.find({ status: "captured" }).limit(500).lean();
    const incomplete = [];
    for (const payment of capturedPayments) {
      const [invoice, payout, ledger] = await Promise.all([
        Invoice.findOne({ paymentId: payment._id }).lean(),
        DoctorPayout.findOne({ paymentId: payment._id }).lean(),
        TransactionLedger.findOne({ paymentId: payment._id, type: "payment", status: { $in: ["posted", "pending"] } }).lean(),
      ]);
      if (!invoice || !payout || !ledger || payment.postProcessingState !== "complete") {
        incomplete.push({ paymentId: payment._id, missingInvoice: !invoice, missingPayout: !payout, missingLedger: !ledger, postProcessingIncomplete: payment.postProcessingState !== "complete" });
      }
    }
    return incomplete;
  },

  // Re-runs the idempotent post-processing chain for every incomplete
  // captured payment found above. Safe to run repeatedly — every step inside
  // completePaymentPostProcessing checks-before-writing.
  async repairIncompletePayments() {
    // Imported lazily to avoid a circular import (paymentController already
    // imports models this service also touches).
    const { completePaymentPostProcessing } = await import("../controllers/paymentController.js");
    const incomplete = await this.findIncompletePayments();
    const results = [];
    for (const item of incomplete) {
      try {
        const payment = await Payment.findById(item.paymentId);
        await completePaymentPostProcessing(payment);
        results.push({ paymentId: item.paymentId, repaired: true });
      } catch (error) {
        logger.error("Reconciliation repair failed for payment", {
          paymentId: item.paymentId.toString(),
          error: error.message,
        });
        results.push({ paymentId: item.paymentId, repaired: false, error: error.message });
      }
    }
    return results;
  },
};

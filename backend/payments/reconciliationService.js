import Payment from "../models/Payment.js";

export const reconciliationService = {
  async generateReport() {
    const payments = await Payment.find().limit(500).lean();
    const seenOrders = new Map();
    const issues = [];
    payments.forEach((payment) => {
      if (seenOrders.has(payment.razorpayOrderId)) {
        issues.push({ type: "duplicate_order", paymentId: payment._id, orderId: payment.razorpayOrderId });
      }
      seenOrders.set(payment.razorpayOrderId, payment._id);
      if (payment.status === "captured" && !payment.paymentId) {
        issues.push({ type: "missing_capture_reference", paymentId: payment._id });
      }
      if (payment.refundedAmount > payment.totalAmount) {
        issues.push({ type: "refund_exceeds_payment", paymentId: payment._id });
      }
    });
    return { checked: payments.length, issues, generatedAt: new Date() };
  },
};

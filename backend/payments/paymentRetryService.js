import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import TransactionLedger from "../models/TransactionLedger.js";

const MAX_RETRIES = 3;

export const paymentRetryService = {
  async scheduleFailedPayment(paymentId) {
    const payment = await Payment.findById(paymentId);
    if (!payment || payment.retryCount >= MAX_RETRIES) return payment;
    payment.retryCount += 1;
    payment.nextRetryAt = new Date(Date.now() + payment.retryCount * 60 * 60 * 1000);
    await payment.save();
    await TransactionLedger.create({
      userId: payment.userId,
      paymentId: payment._id,
      type: "payment",
      direction: "debit",
      amount: payment.totalAmount,
      currency: payment.currency,
      status: "failed",
      referenceId: payment.paymentId || payment.razorpayOrderId,
      idempotencyKey: `retry:${payment._id}:${payment.retryCount}`,
      metadata: { nextRetryAt: payment.nextRetryAt },
    });
    return payment;
  },

  async retryDuePayments() {
    const duePayments = await Payment.find({
      status: PAYMENT_STATUS.FAILED,
      retryCount: { $lt: MAX_RETRIES },
      nextRetryAt: { $lte: new Date() },
      lockedAt: { $exists: false },
    }).limit(100);
    return Promise.all(duePayments.map((payment) => this.scheduleFailedPayment(payment._id)));
  },
};

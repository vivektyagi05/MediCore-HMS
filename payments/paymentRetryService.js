import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { paymentGateway } from "./paymentGateway.js";

const MAX_RETRIES = 3;

export const paymentRetryService = {
  async scheduleFailedPayment(paymentId) {
    const payment = await Payment.findById(paymentId);
    if (!payment || payment.status !== PAYMENT_STATUS.FAILED || payment.retryCount >= MAX_RETRIES) return payment;
    const attemptNumber = (await PaymentAttempt.countDocuments({ paymentId })) + 1;
    const order = await paymentGateway.createOrder({
      amount: payment.gatewayAmount || payment.totalAmount,
      currency: payment.currency,
      receipt: payment.metadata?.receipt || `retry_${payment._id}`,
      notes: { paymentId: payment._id.toString(), retryAttempt: String(attemptNumber), module: "hms_finance" },
    });
    payment.retryCount += 1;
    payment.nextRetryAt = new Date();
    payment.gatewayOrderId = order.id;
    payment.razorpayOrderId = order.id;
    payment.paymentState = "pending";
    payment.reconciliationState = "not_required";
    payment.stateHistory = payment.stateHistory || [];
    payment.stateHistory.push({ from: "failed", to: "pending", source: "retry", reason: `Retry attempt ${payment.retryCount} created`, at: new Date() });
    await payment.save();
    await PaymentAttempt.create({
      paymentId: payment._id,
      attemptNumber,
      gateway: paymentGateway.mode(),
      gatewayOrderId: order.id,
      status: "created",
      amount: payment.gatewayAmount || payment.totalAmount,
      currency: payment.currency,
    });
    return payment;
  },

  async retryDuePayments() {
    const duePayments = await Payment.find({
      status: PAYMENT_STATUS.FAILED,
      retryCount: { $lt: MAX_RETRIES },
      nextRetryAt: { $lte: new Date() },
    }).limit(100);
    return Promise.all(duePayments.map((payment) => this.scheduleFailedPayment(payment._id)));
  },
};

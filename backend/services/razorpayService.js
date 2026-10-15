import crypto from "crypto";
import Razorpay from "razorpay";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { toPaise } from "../payments/money.js";

let razorpayClient;

const getRazorpayClient = () => {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new AppError("Razorpay credentials are not configured", 500);
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: env.razorpayKeyId,
      key_secret: env.razorpayKeySecret,
    });
  }

  return razorpayClient;
};

export const razorpayService = {
  mode: "razorpay",
  keyId: env.razorpayKeyId,
  async createOrder({ amount, currency, receipt, notes }) {
    const client = getRazorpayClient();

    return client.orders.create({
      amount: Math.round(amount * 100),
      currency,
      receipt,
      notes,
      payment_capture: 1,
    });
  },

  // Phase 01: deterministic-receipt lookup so an ambiguous order creation (timeout)
  // is checked at the provider instead of being blindly repeated.
  async findOrderByReceipt({ receipt }) {
    const result = await getRazorpayClient().orders.all({ receipt, count: 5 });
    return (result?.items || []).find((order) => order.receipt === receipt) || null;
  },

  async fetchPayment({ paymentId }) {
    const client = getRazorpayClient();
    return client.payments.fetch(paymentId);
  },

  verifyPaymentSignature({ razorpayOrderId, paymentId, signature }) {
    const expectedSignature = crypto
      .createHmac("sha256", env.razorpayKeySecret)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest("hex");

    const expected = Buffer.from(expectedSignature);
    const received = Buffer.from(signature);

    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  },

  async refundPayment({ paymentId, amount, notes }) {
    const client = getRazorpayClient();

    return client.payments.refund(paymentId, {
      amount: toPaise(amount),
      notes,
    });
  },

  async listPaymentRefunds({ paymentId }) {
    const result = await getRazorpayClient().payments.fetchMultipleRefund(paymentId, { count: 100 });
    return result?.items || [];
  },

  async fetchRefund({ refundId }) {
    return getRazorpayClient().refunds.fetch(refundId);
  },
};

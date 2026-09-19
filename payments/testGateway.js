import crypto from "crypto";

const TEST_SECRET = process.env.TEST_PAYMENT_GATEWAY_SECRET || "p23-test-gateway-secret";

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", TEST_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

const scenario = () => String(process.env.TEST_PAYMENT_SCENARIO || "success").toLowerCase();
const payments = new Map();

export const testGateway = {
  mode: "test",
  keyId: "test_gateway",
  async createOrder({ amount, currency, receipt, notes }) {
    const id = `test_order_${crypto.randomUUID()}`;
    return { id, amount: Math.round(Number(amount) * 100), currency, receipt, notes: notes || {}, status: "created" };
  },
  async fetchPayment({ paymentId, orderId, amount, currency = "INR" }) {
    if (scenario() === "timeout") throw new Error("Test gateway timeout");
    const stored = payments.get(paymentId);
    return {
      id: paymentId,
      status: scenario() === "failure" ? "failed" : "captured",
      order_id: stored?.orderId || orderId,
      amount: stored?.amountPaise ?? Math.round(Number(amount) * 100),
      currency: stored?.currency || currency,
    };
  },
  verifyPaymentSignature({ razorpayOrderId, paymentId, signature }) {
    if (scenario() === "invalid_signature") return false;
    return sign(razorpayOrderId, paymentId) === signature;
  },
  buildPaymentResponse(orderId, paymentId, amount, currency = "INR") {
    payments.set(paymentId, { orderId, amountPaise: Math.round(Number(amount) * 100), currency });
    return {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId),
      amount: Math.round(Number(amount) * 100),
      currency,
    };
  },
  async refundPayment({ paymentId, amount, notes }) {
    const current = scenario();
    if (current === "refund_failure") throw new Error("Test gateway refund failure");
    return {
      id: `test_refund_${crypto.randomUUID()}`,
      payment_id: paymentId,
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      status: "processed",
      notes: notes || {},
    };
  },
};

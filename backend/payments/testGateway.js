import crypto from "crypto";

const TEST_SECRET = process.env.TEST_PAYMENT_GATEWAY_SECRET || "p23-test-gateway-secret";

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", TEST_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

const scenario = () => String(process.env.TEST_PAYMENT_SCENARIO || "success").toLowerCase();
const payments = new Map();
const refunds = new Map();
const ordersByReceipt = new Map();

export const testGateway = {
  mode: "test",
  keyId: "test_gateway",
  async createOrder({ amount, currency, receipt, notes }) {
    if (scenario() === "order_timeout") { const error = new Error("Test gateway order timeout"); error.code = "ETIMEDOUT"; throw error; }
    const id = `test_order_${crypto.randomUUID()}`;
    const order = { id, amount: Math.round(Number(amount) * 100), currency, receipt, notes: notes || {}, status: "created" };
    if (receipt) ordersByReceipt.set(receipt, order);
    return order;
  },
  async findOrderByReceipt({ receipt }) {
    return ordersByReceipt.get(receipt) || null;
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
    if (current === "refund_failure") {
      const error = new Error("Test gateway refund rejected");
      error.statusCode = 400; // definitive provider rejection
      throw error;
    }
    if (current === "refund_timeout") {
      const error = new Error("Test gateway refund timeout"); // ambiguous: no statusCode
      error.code = "ETIMEDOUT";
      throw error;
    }
    const refund = {
      id: `test_refund_${crypto.randomUUID()}`,
      payment_id: paymentId,
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      status: current === "refund_pending" ? "pending" : "processed",
      notes: notes || {},
    };
    if (current === "refund_unknown") delete refund.status;
    refunds.set(refund.id, refund);
    return refund;
  },
  async listPaymentRefunds({ paymentId }) {
    return [...refunds.values()].filter((item) => item.payment_id === paymentId);
  },
  async fetchRefund({ refundId }) {
    const stored = refunds.get(refundId);
    if (!stored) throw Object.assign(new Error("Refund not found"), { statusCode: 404 });
    // A pending test refund settles when the provider is queried again.
    if (stored.status === "pending") stored.status = "processed";
    return stored;
  },
};

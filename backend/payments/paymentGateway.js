import { razorpayService } from "../services/razorpayService.js";
import { testGateway } from "./testGateway.js";

const adapter = () => process.env.PAYMENT_GATEWAY_MODE === "test" ? testGateway : razorpayService;

export const paymentGateway = {
  mode() { return adapter().mode || "razorpay"; },
  keyId() { return adapter().keyId || null; },
  createOrder(args) { return adapter().createOrder(args); },
  fetchPayment(args) { return adapter().fetchPayment(args); },
  verifyPaymentSignature(args) { return adapter().verifyPaymentSignature(args); },
  refundPayment(args) { return adapter().refundPayment(args); },
  buildPaymentResponse(...args) {
    if (!adapter().buildPaymentResponse) throw new Error("The configured gateway does not support browser response generation");
    return adapter().buildPaymentResponse(...args);
  },
};

import { razorpayService } from "../services/razorpayService.js";
import { PAYMENT_GATEWAY_MODES, resolvePaymentGatewayMode } from "../config/productionGuards.js";

// The in-memory test gateway can fabricate captures, signatures and refunds
// and carries a hardcoded secret. It must therefore never even be LOADED in a
// production process. config/env.js already refuses to boot in production
// with PAYMENT_GATEWAY_MODE=test; this is the second, independent layer:
// the module is only imported outside production, and adapter() refuses to
// select it if production somehow reaches this point.
const isProductionProcess = () => process.env.NODE_ENV === "production";

const testGateway = isProductionProcess()
  ? null
  : (await import("./testGateway.js")).testGateway;

const adapter = () => {
  const mode = resolvePaymentGatewayMode(process.env);
  if (mode === PAYMENT_GATEWAY_MODES.TEST) {
    if (isProductionProcess() || !testGateway) {
      throw new Error("The test payment gateway is not available in production");
    }
    return testGateway;
  }
  return razorpayService;
};

export const paymentGateway = {
  mode() { return adapter().mode || PAYMENT_GATEWAY_MODES.RAZORPAY; },
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

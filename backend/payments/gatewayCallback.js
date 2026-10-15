// Single place that understands the field names a gateway hands back to the
// browser. Razorpay Checkout (and the test gateway, which deliberately mimics
// it) use snake_case; this API's verify contract uses camelCase. Accepting
// both here means the verify endpoint can never be defeated again by a shape
// mismatch between a gateway adapter and the controller. Nothing is trusted:
// values are only coerced to trimmed strings, then signature/amount/currency
// are verified server-side exactly as before.
const clean = (value) => (typeof value === "string" ? value.trim() : "");

export const normalizeGatewayCallback = (body = {}) => ({
  razorpayOrderId: clean(body.razorpayOrderId ?? body.razorpay_order_id),
  paymentId: clean(body.paymentId ?? body.razorpay_payment_id),
  signature: clean(body.signature ?? body.razorpay_signature),
});

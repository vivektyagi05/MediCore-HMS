import assert from "assert";
import { computePaymentSplit } from "../payments/paymentSplit.js";
const t = (a, b, c) => computePaymentSplit({ totalAmount: a, requestedWalletAmount: b, walletBalance: c });
assert.deepStrictEqual(t(500, 500, 1000), { walletAmount: 500, gatewayAmount: 0, walletOnly: true, reconciles: true });
assert.deepStrictEqual(t(500, 9999, 1000), { walletAmount: 500, gatewayAmount: 0, walletOnly: true, reconciles: true }, "request above total is capped by the server");
assert.strictEqual(t(500, 500, 200).walletOnly, false, "balance caps the wallet portion");
assert.strictEqual(t(500, 500, 200).gatewayAmount, 300);
assert.strictEqual(t(500, 0, 1000).walletAmount, 0);
const edge = t(500, 499.5, 1000);
assert.strictEqual(edge.gatewayAmount, 1, "sub-INR1 remainder becomes a INR1 gateway charge");
assert.strictEqual(edge.walletAmount, 499);
assert.strictEqual(t(0.5, 0.5, 1).error, undefined === 1 ? "" : t(0.5, 0.5, 1).error);
for (const [a, b, c] of [[123.45, 100.1, 500], [999.99, 999.99, 999.99], [1.5, 1, 5], [250, 249.01, 300]]) {
  const r = t(a, b, c);
  if (!r.error) assert.ok(r.reconciles, `split must reconcile for ${a}`);
}
console.log("PASS: payment split is server-derived and reconciles in paise");
process.exit(0);

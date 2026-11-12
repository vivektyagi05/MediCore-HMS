import assert from "node:assert/strict";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x"; process.env.JWT_SECRET ||= "evidence-secret-evidence-secret-123456";
mongoose.set("bufferCommands", false);
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const m = async (n) => (await import(`../models/${n}.js`)).default;
const [PaymentAttempt, WalletReservation, TransactionLedger, DoctorPayout] = await Promise.all(["PaymentAttempt", "WalletReservation", "TransactionLedger", "DoctorPayout"].map(m));
const { buildPaymentEvidence, summarizeAllocation, EVIDENCE_LIMITS } = await import("../services/finance/paymentEvidence.js");
installMemoryModels([{ model: PaymentAttempt }, { model: WalletReservation }, { model: TransactionLedger }, { model: DoctorPayout }]);

const payment = { _id: newId(), totalAmount: 1000, walletAmount: 300, gatewayAmount: 700, refundedAmount: 400, walletRefundedAmount: 100, gatewayRefundedAmount: 300, processedGatewayRefundIds: ["rf1"], paymentState: "completed", paymentId: "pay_1",
  stateHistory: Array.from({ length: 60 }, (_, i) => ({ from: "a", to: "b", source: "s", reason: `r${i}`, at: new Date(i) })), captureEvidence: [{ gatewayPaymentId: "g1" }, { gatewayPaymentId: "g2", resolution: { state: "verified_no_action" } }] };
assert.deepEqual(summarizeAllocation(payment), { totalPaise: 100000, walletPaise: 30000, gatewayPaise: 70000, refundedPaise: 40000, walletRefundedPaise: 10000, gatewayRefundedPaise: 30000, providerRefundsCounted: 1, allocationConsistent: true, refundSplitConsistent: true });
assert.equal(summarizeAllocation({ ...payment, gatewayAmount: 600 }).allocationConsistent, false);
assert.equal(summarizeAllocation({ ...payment, walletRefundedAmount: 50 }).refundSplitConsistent, false);

await PaymentAttempt.create({ paymentId: payment._id, attemptNumber: 1, gateway: "razorpay", gatewayOrderId: "o1", amount: 700, currency: "INR", status: "captured", metadata: { secret: "x" } });
await TransactionLedger.create({ userId: newId(), paymentId: payment._id, type: "payment", direction: "debit", amount: 1000, status: "posted", referenceId: "pay_1", idempotencyKey: `payment:capture:${payment._id}`, metadata: { invoiceId: "i" } });
await DoctorPayout.create({ doctorId: newId(), appointmentId: newId(), paymentId: payment._id, grossAmount: 1000, doctorAmount: 700, platformFee: 300, status: "pending", refundAdjustmentAmount: 280 });
const ev = await buildPaymentEvidence(payment);
assert.equal(ev.attempts.length, 1); assert.equal(ev.attempts[0].gatewayOrderId, "o1");
assert.equal(ev.stateTransitions.length, EVIDENCE_LIMITS.transitions, "transition history is bounded to the most recent entries");
assert.equal(ev.stateTransitions.at(-1).reason, "r59");
assert.equal(ev.ledger.length, 1); assert.equal(ev.ledger[0].idempotencyKey, `payment:capture:${payment._id}`);
assert.equal(ev.earning.refundAdjustmentAmount, 280); assert.equal(ev.walletReservation, null);
assert.equal(ev.reconciliation.unresolvedCaptureCases, 1, "resolved capture evidence is not counted as open");
const text = JSON.stringify(ev);
for (const f of ["secret", "signature", "metadata", "razorpaySignature"]) assert.ok(!text.includes(f), `evidence leaked ${f}`);
console.log("paymentEvidence: 13 checks passed"); process.exit(0);

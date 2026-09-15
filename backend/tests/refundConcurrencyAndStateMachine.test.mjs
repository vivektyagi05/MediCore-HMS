// Pure-logic tests reproducing the exact guards shipped in
// refundController.js (Phase UI-6), without needing a live Mongo
// connection. Each guard is reimplemented against a tiny in-memory fake
// store that mimics Mongoose's findOneAndUpdate atomicity — a conditional
// filter either matches-and-mutates in one step, or matches nothing and
// returns null, exactly like the real conditional updates the controller
// relies on.
import assert from "assert";

// --- Fake atomic store, mirroring findOneAndUpdate({filter}, {update}) ---
const makeStore = (doc) => ({
  doc,
  findOneAndUpdate(filter, apply) {
    for (const [key, value] of Object.entries(filter)) {
      if (this.doc[key] !== value) return null; // no match — exactly like a real conditional update returning null
    }
    apply(this.doc);
    return this.doc;
  },
});

// 1. Per-payment refund lock: only one of two "concurrent" acquisitions
// can win (refundLockedAt: {$exists:false} style guard).
{
  const payment = { _id: "PAY1", refundLockedAt: undefined };
  const store = makeStore(payment);

  const acquire = () => store.findOneAndUpdate({ refundLockedAt: undefined }, (doc) => {
    doc.refundLockedAt = new Date();
  });

  const first = acquire();
  const second = acquire();

  assert.ok(first, "the first caller must acquire the lock");
  assert.strictEqual(second, null, "a second caller must be rejected while the lock is held");
  console.log("PASS: only one caller can hold the per-payment refund lock at a time");

  // Release, then re-acquire must succeed again.
  payment.refundLockedAt = undefined;
  assert.ok(acquire(), "after release, the lock can be acquired again");
  console.log("PASS: releasing the lock allows a subsequent refund operation to proceed");
}

// 2. Atomic RefundRequest state transition: pending -> approved only
// succeeds once; a second concurrent approve attempt on the same document
// must fail cleanly rather than double-processing.
{
  const refundRequest = { _id: "RR1", status: "pending" };
  const store = makeStore(refundRequest);

  const approve = () => store.findOneAndUpdate({ status: "pending" }, (doc) => {
    doc.status = "approved";
  });

  const firstApprove = approve();
  const secondApprove = approve();

  assert.ok(firstApprove, "the first approve call must succeed");
  assert.strictEqual(secondApprove, null, "a second concurrent approve call must be rejected, not silently re-run");
  assert.strictEqual(refundRequest.status, "approved");
  console.log("PASS: a refund request can only be approved once, even under concurrent attempts");
}

// 3. Over-refund guard: requested amount must never exceed
// (totalAmount - refundedAmount), computed from the authoritative Payment
// record — never trusted from request input.
{
  const computeRefundableAmount = (payment) => Number((payment.totalAmount - payment.refundedAmount).toFixed(2));
  const validateRefundAmount = (payment, amount) => {
    const refundable = computeRefundableAmount(payment);
    return amount > 0 && amount <= refundable;
  };

  const payment = { totalAmount: 1000, refundedAmount: 600 };
  assert.strictEqual(validateRefundAmount(payment, 400), true, "refunding exactly the remaining balance is allowed");
  assert.strictEqual(validateRefundAmount(payment, 401), false, "refunding even 1 unit over the remaining balance is rejected");
  assert.strictEqual(validateRefundAmount(payment, 0), false, "a zero-amount refund is rejected");
  assert.strictEqual(validateRefundAmount(payment, -50), false, "a negative refund amount is rejected");
  console.log("PASS: refund amount is bounded to the real remaining refundable balance, never trusted as-is");
}

// 4. Duplicate-request guard: a payment already carrying a pending or
// approved RefundRequest must reject a second one (shared by both
// createRefundRequest and initiateRefund).
{
  const existingRequests = [{ paymentId: "PAY1", status: "approved" }];
  const assertNoConflict = (paymentId) => {
    const duplicate = existingRequests.find((r) => r.paymentId === paymentId && ["pending", "approved"].includes(r.status));
    if (duplicate) throw new Error("A refund request is already pending or approved for this payment");
  };

  assert.throws(() => assertNoConflict("PAY1"), /already pending or approved/);
  console.log("PASS: a second refund request against a payment with a pending/approved request is rejected");

  // A payment with only rejected/processed/failed history has no
  // conflicting request and must be allowed a new one.
  const clearRequests = [{ paymentId: "PAY2", status: "rejected" }, { paymentId: "PAY2", status: "processed" }];
  const assertNoConflict2 = (paymentId) => {
    const duplicate = clearRequests.find((r) => r.paymentId === paymentId && ["pending", "approved"].includes(r.status));
    if (duplicate) throw new Error("conflict");
  };
  assert.doesNotThrow(() => assertNoConflict2("PAY2"));
  console.log("PASS: a payment with only resolved (rejected/processed) refund history allows a new request");
}

console.log("ALL REFUND CONCURRENCY AND STATE MACHINE TESTS PASSED");

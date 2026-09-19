// P23 — Refund Policy Engine tests. Pure-logic, dependency-free (no live
// Mongo), matching this codebase's established test convention. Covers the
// brief's named scenarios directly against the real implementation in
// backend/payments/refundPolicyEngine.js.
import assert from "assert";
import {
  computeFundingAllocation,
  computeRefundableAmount,
  evaluateRefundEligibility,
  validateRefundReason,
  isMeaninglessDescription,
  REFUND_REASON_CATEGORIES,
} from "../payments/refundPolicyEngine.js";

// --- Scenario 1: wallet 300 / gateway 700, full refund routes exactly ---
{
  const payment = { totalAmount: 1000, walletAmount: 300, gatewayAmount: 700, walletRefundedAmount: 0, gatewayRefundedAmount: 0 };
  const { walletRefundAmount, gatewayRefundAmount } = computeFundingAllocation({ payment, refundAmount: 1000 });
  assert.strictEqual(walletRefundAmount, 300, "wallet-funded portion must be restored to the wallet");
  assert.strictEqual(gatewayRefundAmount, 700, "gateway-funded portion must be refunded via the gateway");
  assert.strictEqual(walletRefundAmount + gatewayRefundAmount, 1000, "no unexplained money — must sum exactly");
  console.log("PASS: Scenario 1 — wallet/gateway funding split routes exactly (300/700)");
}

// --- Scenario 1 continued: the OLD bug is impossible now — full amount is
// never sent to BOTH buckets simultaneously ---
{
  const payment = { totalAmount: 1000, walletAmount: 300, gatewayAmount: 700, walletRefundedAmount: 0, gatewayRefundedAmount: 0 };
  const { walletRefundAmount, gatewayRefundAmount } = computeFundingAllocation({ payment, refundAmount: 1000 });
  assert.notStrictEqual(gatewayRefundAmount, 1000, "gateway must never be asked to refund money it never captured");
  assert.ok(walletRefundAmount <= payment.walletAmount, "wallet refund can never exceed the wallet-funded amount");
  assert.ok(gatewayRefundAmount <= payment.gatewayAmount, "gateway refund can never exceed the gateway-funded amount");
  console.log("PASS: double-payout bug (full amount to gateway AND wallet) is structurally impossible");
}

// --- Scenario 2: partial refunds 600 then 400 allowed, then 1 more rejected ---
{
  let payment = { totalAmount: 1000, refundedAmount: 0, walletAmount: 0, gatewayAmount: 1000, walletRefundedAmount: 0, gatewayRefundedAmount: 0 };
  assert.strictEqual(computeRefundableAmount(payment), 1000);

  payment.refundedAmount = 600;
  payment.gatewayRefundedAmount = 600;
  assert.strictEqual(computeRefundableAmount(payment), 400, "400 remains refundable after a 600 partial refund");

  payment.refundedAmount = 1000;
  payment.gatewayRefundedAmount = 1000;
  assert.strictEqual(computeRefundableAmount(payment), 0, "nothing remains refundable after 600+400");

  assert.throws(
    () => computeFundingAllocation({ payment, refundAmount: 1 }),
    /exceeds remaining funding capacity/,
    "a further ₹1 refund attempt must be rejected once fully refunded",
  );
  console.log("PASS: Scenario 2 — sequential partial refunds (600, 400) allowed, further ₹1 rejected");
}

// --- Scenario 3: completed appointment blocks direct patient refund,
// routes to report-a-problem instead ---
{
  const payment = { totalAmount: 1000, refundedAmount: 0 };
  const appointment = { status: "completed" };
  const result = evaluateRefundEligibility({ payment, appointment, actorRole: "patient", requestedAmount: 1000 });
  assert.strictEqual(result.eligible, false, "a completed appointment must not be directly refundable by the patient");
  assert.strictEqual(result.action, "REPORT_PROBLEM", "the only available action must be report-a-problem");
  console.log("PASS: Scenario 3 — completed appointment blocks instant refund, directs to Report a Problem");
}

// Non-completed appointment (e.g. payment_completed, pre-consultation) IS
// eligible for the normal cancellation-refund path.
{
  const payment = { totalAmount: 1000, refundedAmount: 0 };
  const appointment = { status: "payment_completed" };
  const result = evaluateRefundEligibility({ payment, appointment, actorRole: "patient", requestedAmount: 1000 });
  assert.strictEqual(result.eligible, true, "a pre-consultation payment must remain refundable through cancellation");
  assert.strictEqual(result.action, "REFUND_REQUEST");
  console.log("PASS: pre-consultation payment remains eligible for a normal refund request");
}

// Admin actor is not blocked by the completed-appointment restriction
// (Section 7 — admin operation is a separate, authorized override).
{
  const payment = { totalAmount: 1000, refundedAmount: 0 };
  const appointment = { status: "completed" };
  const result = evaluateRefundEligibility({ payment, appointment, actorRole: "super_admin", requestedAmount: 500 });
  assert.strictEqual(result.eligible, true, "an admin-initiated refund on a completed appointment is an authorized override");
  console.log("PASS: admin actor can still process a refund on a completed appointment (authorized override)");
}

// --- Section 6: reason category / meaningless free text ---
{
  assert.strictEqual(isMeaninglessDescription("test"), true);
  assert.strictEqual(isMeaninglessDescription("abc"), true);
  assert.strictEqual(isMeaninglessDescription("give money"), true);
  assert.strictEqual(isMeaninglessDescription(""), true);
  assert.strictEqual(
    isMeaninglessDescription("The doctor never joined the video call after 20 minutes of waiting"),
    false,
  );
  console.log("PASS: meaningless free-text descriptions are flagged; a real description is not");

  const missingCode = validateRefundReason({ reasonCode: null, description: "something", entryPoint: "cancellation" });
  assert.strictEqual(missingCode.ok, false, "a missing reason category must be rejected");

  const wrongEntryPoint = validateRefundReason({
    reasonCode: REFUND_REASON_CATEGORIES.DOCTOR_NO_SHOW, description: "doctor did not show up", entryPoint: "cancellation",
  });
  assert.strictEqual(wrongEntryPoint.ok, false, "a report-problem-only category is not valid on the cancellation entry point");

  const meaninglessOther = validateRefundReason({
    reasonCode: REFUND_REASON_CATEGORIES.OTHER, description: "refund", entryPoint: "report_problem",
  });
  assert.strictEqual(meaninglessOther.ok, false, "category OTHER with a meaningless description must be rejected");

  const validReport = validateRefundReason({
    reasonCode: REFUND_REASON_CATEGORIES.DOCTOR_NO_SHOW, description: "Doctor never joined the call", entryPoint: "report_problem",
  });
  assert.strictEqual(validReport.ok, true, "a valid category + real description on the correct entry point must pass");
  console.log("PASS: reason-category validation enforces category + entry-point + meaningful description");
}

// --- Section 28 invariant sweep: allocation always sums exactly across a
// range of partial refunds against a mixed-funding payment ---
{
  const payment = { totalAmount: 999, walletAmount: 333, gatewayAmount: 666, walletRefundedAmount: 0, gatewayRefundedAmount: 0 };
  let remaining = 999;
  for (const chunk of [250, 250, 250, 249]) {
    const { walletRefundAmount, gatewayRefundAmount } = computeFundingAllocation({ payment, refundAmount: chunk });
    assert.strictEqual(
      Number((walletRefundAmount + gatewayRefundAmount).toFixed(2)),
      chunk,
      "each partial allocation must sum exactly to the requested chunk",
    );
    payment.walletRefundedAmount = Number((payment.walletRefundedAmount + walletRefundAmount).toFixed(2));
    payment.gatewayRefundedAmount = Number((payment.gatewayRefundedAmount + gatewayRefundAmount).toFixed(2));
    remaining -= chunk;
  }
  assert.ok(payment.walletRefundedAmount <= payment.walletAmount + 0.01, "cumulative wallet refund never exceeds wallet-funded amount");
  assert.ok(payment.gatewayRefundedAmount <= payment.gatewayAmount + 0.01, "cumulative gateway refund never exceeds gateway-funded amount");
  assert.strictEqual(remaining, 0);
  console.log("PASS: repeated partial refunds against mixed funding never exceed either bucket's capacity");
}

console.log("ALL REFUND POLICY ENGINE TESTS PASSED");

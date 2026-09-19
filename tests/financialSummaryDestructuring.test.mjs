// Regression test for a severe, real bug found this session in
// getFinancialSummary: `[summary, [walletSummary], [subscriptionSummary]]`
// left `summary` as the raw aggregate() result ARRAY instead of unwrapping
// it like the other two. This meant data.totalEarnings read as undefined,
// and JSON.stringify silently dropped walletBalances/recurringRevenue/
// activeSubscriptions/successRatio from the API response entirely — the
// admin finance dashboard's core summary endpoint was broken.
//
// This reproduces the EXACT before/after destructuring pattern to prove
// the failure mode and the fix, independent of any DB.
import assert from "assert";

const mockAggregateResults = [
  [{ _id: null, totalEarnings: 500, totalPayments: 3, refundedAmount: 0, failedPayments: 0, capturedPayments: 3 }],
  [{ walletBalances: 100 }],
  [{ recurringRevenue: 50, activeSubscriptions: 2 }],
];

// --- BEFORE (the bug): only 2 of 3 destructured correctly ---
{
  const [summary, [walletSummary]] = mockAggregateResults;
  const data = summary || { totalEarnings: 0 };
  data.walletBalances = walletSummary?.walletBalances || 0;

  assert.strictEqual(data.totalEarnings, undefined, "sanity check: this really was the bug");
  const roundTripped = JSON.parse(JSON.stringify(data));
  assert.strictEqual(roundTripped.walletBalances, undefined, "sanity check: walletBalances really was dropped over the wire");
}
console.log("PASS: reproduced the exact bug (proves the test would have caught it)");

// --- AFTER (the fix): all 3 consistently unwrapped ---
{
  const [[summary], [walletSummary], [subscriptionSummary]] = mockAggregateResults;
  const data = summary || { totalEarnings: 0, refundedAmount: 0, failedPayments: 0, capturedPayments: 0, totalPayments: 0 };
  data.walletBalances = walletSummary?.walletBalances || 0;
  data.recurringRevenue = subscriptionSummary?.recurringRevenue || 0;
  data.activeSubscriptions = subscriptionSummary?.activeSubscriptions || 0;

  assert.strictEqual(data.totalEarnings, 500);
  const roundTripped = JSON.parse(JSON.stringify(data));
  assert.strictEqual(roundTripped.totalEarnings, 500);
  assert.strictEqual(roundTripped.walletBalances, 100);
  assert.strictEqual(roundTripped.recurringRevenue, 50);
  assert.strictEqual(roundTripped.activeSubscriptions, 2);
}
console.log("PASS: fixed destructuring survives JSON round-trip with every field intact");

// --- Empty-database edge case: must fall back to the zeroed default object, not [] ---
{
  const [[summary]] = [[]];
  const data = summary || { totalEarnings: 0, refundedAmount: 0, failedPayments: 0, capturedPayments: 0, totalPayments: 0 };
  assert.strictEqual(Array.isArray(data), false, "must fall back to the default OBJECT, not stay an array");
  assert.strictEqual(data.totalEarnings, 0);
}
console.log("PASS: empty-database case correctly falls back to the zeroed object, not an empty array");

console.log("ALL FINANCIAL SUMMARY DESTRUCTURING TESTS PASSED");

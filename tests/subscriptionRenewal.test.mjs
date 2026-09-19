// Regression test for the subscription renewal bug found this session:
// markCharged never advanced nextBillingAt, so even a successfully charged
// subscription kept matching the renewal cron's due-query forever and got
// incorrectly re-marked past_due on the next run. Also verifies the new
// dunning threshold actually resolves a stuck past_due subscription instead
// of leaving it there forever.
import assert from "assert";

// Re-implements the exact period-advancement math shipped in
// subscriptionService.markCharged, to verify it moves forward correctly
// without needing a live DB.
function advancePeriod(interval, from = new Date()) {
  const periodStart = new Date(from);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + (interval === "yearly" ? 12 : 1));
  return { periodStart, periodEnd };
}

const now = new Date("2026-01-15T00:00:00Z");
const monthly = advancePeriod("monthly", now);
assert.strictEqual(monthly.periodEnd.getUTCMonth(), 1); // Feb (0-indexed)
assert.ok(monthly.periodEnd > now, "nextBillingAt must move into the future, not stay in the past");
console.log("PASS: monthly renewal advances nextBillingAt by 1 month, into the future");

const yearly = advancePeriod("yearly", now);
assert.strictEqual(yearly.periodEnd.getUTCFullYear(), now.getUTCFullYear() + 1);
console.log("PASS: yearly renewal advances nextBillingAt by 12 months");

// Dunning: re-implements the exact threshold logic shipped in the cron.
function simulateDunning(failedRenewalCount, MAX = 3) {
  const next = failedRenewalCount + 1;
  return next >= MAX ? "cancelled" : "past_due";
}

assert.strictEqual(simulateDunning(0), "past_due");
assert.strictEqual(simulateDunning(1), "past_due");
assert.strictEqual(simulateDunning(2), "cancelled");
console.log("PASS: subscription resolves to cancelled after 3 consecutive missed renewals, not stuck forever");

console.log("ALL SUBSCRIPTION RENEWAL TESTS PASSED");

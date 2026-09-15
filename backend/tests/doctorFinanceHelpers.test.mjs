// PHASE DOC-09 — Doctor Earnings / Financial Control Center.
//
// Dependency-free regression test for the two pure helpers extracted out
// of doctorEarningsController.js: the payout deep-link page-resolution
// math (Section 7 — payout scale bug fix) and the income-forecast basis
// logic (Section 13 — forecast honesty).
import assert from "assert";
import { resolvePageFromIndex, computeIncomeForecast } from "../services/finance/doctorFinanceHelpers.js";

// ── resolvePageFromIndex ────────────────────────────────────────────────
{
  assert.strictEqual(resolvePageFromIndex(0, 10), 1);
  console.log("PASS: the very first record (0 before it) resolves to page 1");
}
{
  assert.strictEqual(resolvePageFromIndex(9, 10), 1);
  console.log("PASS: the last record on page 1 (index 9, pageSize 10) still resolves to page 1");
}
{
  assert.strictEqual(resolvePageFromIndex(10, 10), 2);
  console.log("PASS: the first record on page 2 (index 10, pageSize 10) resolves to page 2");
}
{
  assert.strictEqual(resolvePageFromIndex(25, 10), 3);
  console.log("PASS: index 25 with pageSize 10 resolves to page 3");
}
{
  // Malformed/untrusted inputs must never throw or produce NaN/negative
  // pages — same defensive posture as clampPagination.
  assert.strictEqual(resolvePageFromIndex(-5, 10), 1);
  assert.strictEqual(resolvePageFromIndex(NaN, 10), 1);
  assert.strictEqual(resolvePageFromIndex(5, 0), 1);
  console.log("PASS: malformed index/pageSize inputs fall back to safe defaults, never throw");
}

// ── computeIncomeForecast ────────────────────────────────────────────────
{
  // Fewer than 2 months of data at all — must not fabricate a forecast.
  const result = computeIncomeForecast([{ label: "Aug 26", amount: 5000 }]);
  assert.strictEqual(result.value, null);
  assert.strictEqual(result.basisMonths, 0);
  console.log("PASS: a single month of trend data (nothing complete yet) returns a null forecast, not a fabricated number");
}
{
  // Exactly 2 months: 1 complete month (current excluded) — still not
  // enough (requires >= 2 complete months).
  const result = computeIncomeForecast([
    { label: "Jul 26", amount: 4000 },
    { label: "Aug 26", amount: 5000 }, // current, excluded
  ]);
  assert.strictEqual(result.value, null);
  assert.strictEqual(result.basisMonths, 1);
  console.log("PASS: exactly one complete month is still insufficient — null, not a single-point forecast presented as a projection");
}
{
  // 3 months: 2 complete + current — enough for a real average.
  const result = computeIncomeForecast([
    { label: "Jun 26", amount: 3000 },
    { label: "Jul 26", amount: 5000 },
    { label: "Aug 26", amount: 9000 }, // current, excluded
  ]);
  assert.strictEqual(result.value, 4000); // avg(3000, 5000)
  assert.strictEqual(result.basisMonths, 2);
  console.log("PASS: two complete months produces a real averaged forecast, excluding the in-progress current month");
}
{
  // More than 3 complete months — only the last 3 are used.
  const result = computeIncomeForecast([
    { label: "Apr 26", amount: 1000 }, // outside the 3-month window
    { label: "May 26", amount: 2000 },
    { label: "Jun 26", amount: 4000 },
    { label: "Jul 26", amount: 6000 },
    { label: "Aug 26", amount: 999999 }, // current, excluded
  ]);
  assert.strictEqual(result.value, 4000); // avg(2000, 4000, 6000)
  assert.strictEqual(result.basisMonths, 3);
  console.log("PASS: forecast basis is capped at the last 3 complete months, older history doesn't dilute it");
}

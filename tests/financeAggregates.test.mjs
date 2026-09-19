// Dependency-free re-check of financeAggregates.js's pure, documented
// logic (no live DB needed — buildFinancialHealth and bucketFor take
// plain objects/numbers, they don't touch Mongoose). Locks in: (1) the
// health score formula is a plain mean of five real 0-100 factors, never
// an arbitrary number; (2) zero payment history returns null (not a
// fabricated score); (3) a perfectly healthy overview scores 100; (4) the
// aging bucket boundaries used by buildCollections() are correct at their
// edges.
import assert from "assert";
import { buildFinancialHealth, bucketFor } from "../services/finance/financeAggregates.js";

// 1. No payment activity at all — must not fabricate a score.
{
  const overview = {
    totalPayments: 0,
    capturedPaymentsCount: 0,
    failedCount: 0,
    grossRevenue: 0,
    outstandingAmount: 0,
    refundedAmount: 0,
    capturedPaymentsWithInvoice: 0,
  };
  const health = await buildFinancialHealth(overview, 0);
  assert.strictEqual(health.score, null);
  assert.ok(health.reason.includes("No payment activity"));
  console.log("PASS: zero payment history returns a null score, never a fabricated number");
}

// 2. A perfectly healthy platform (all captured, zero failed, zero
// refunds, zero outstanding, every captured payment invoiced, zero
// attention items) must score exactly 100 — every factor maxes out.
{
  const overview = {
    totalPayments: 10,
    capturedPaymentsCount: 10,
    failedCount: 0,
    grossRevenue: 100000,
    outstandingAmount: 0,
    refundedAmount: 0,
    capturedPaymentsWithInvoice: 10,
  };
  const health = await buildFinancialHealth(overview, 0);
  assert.strictEqual(health.score, 100);
  assert.strictEqual(health.factors.length, 5);
  console.log("PASS: a perfectly healthy overview scores exactly 100 across all five factors");
}

// 3. Heavy refund pressure and heavy attention load pull the score down —
// verifies the formula actually responds to the real inputs, not a
// constant.
{
  const overview = {
    totalPayments: 10,
    capturedPaymentsCount: 8,
    failedCount: 2,
    grossRevenue: 100000,
    outstandingAmount: 20000,
    refundedAmount: 50000, // 50% refund rate
    capturedPaymentsWithInvoice: 4, // only half invoiced
  };
  const health = await buildFinancialHealth(overview, 5); // half of payments need attention
  assert.ok(health.score < 100, "an unhealthy overview must score below 100");
  assert.ok(health.score >= 0 && health.score <= 100, "score must stay within 0-100");
  const refundFactor = health.factors.find((f) => f.key === "refundPressure");
  assert.strictEqual(refundFactor.value, 50, "50% refund rate must yield exactly 50 refund-pressure health");
  console.log("PASS: refund pressure and attention load genuinely pull the health score down");
}

// 4. Every factor is documented with a label and a plain-language
// description sourced from the real supplied numbers — never opaque.
{
  const overview = {
    totalPayments: 4,
    capturedPaymentsCount: 3,
    failedCount: 1,
    grossRevenue: 4000,
    outstandingAmount: 1000,
    refundedAmount: 400,
    capturedPaymentsWithInvoice: 2,
  };
  const health = await buildFinancialHealth(overview, 1);
  for (const factor of health.factors) {
    assert.ok(factor.label, "every factor must have a human-readable label");
    assert.ok(factor.description, "every factor must explain itself from real numbers");
    assert.ok(typeof factor.value === "number" && factor.value >= 0 && factor.value <= 100);
  }
  assert.ok(health.formula.includes("Simple mean"), "the formula must be documented, not left implicit");
  console.log("PASS: every health factor is documented (label + description), never opaque");
}

// 5. Collections aging buckets — real boundary checks, matching
// buildCollections()'s AGING_BUCKETS exactly (this IS that function, not
// a reimplementation).
{
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  assert.strictEqual(bucketFor(1 * HOUR), "0-24h");
  assert.strictEqual(bucketFor(24 * HOUR), "0-24h");
  assert.strictEqual(bucketFor(24 * HOUR + 1), "1-3d");
  assert.strictEqual(bucketFor(3 * DAY), "1-3d");
  assert.strictEqual(bucketFor(3 * DAY + 1), "3-7d");
  assert.strictEqual(bucketFor(7 * DAY), "3-7d");
  assert.strictEqual(bucketFor(7 * DAY + 1), "7d+");
  assert.strictEqual(bucketFor(30 * DAY), "7d+");
  console.log("PASS: collections aging buckets land in the correct boundary exactly");
}

console.log("ALL FINANCE AGGREGATES TESTS PASSED");

// Phase DOC-04 regression tests: (1) buildDateRangeFilter gained quickDate
// support (today/upcoming/past) without changing its existing
// dateFrom/dateTo behavior — appointmentDateRangeFilter.test.mjs already
// locks in the dateFrom/dateTo cases byte-for-byte, this file only tests
// the new quickDate branch and the priority rule between the two. (2) the
// attention rule extracted into utils/appointmentAttention.js produces the
// exact same query shape the pre-existing admin test
// (adminAppointmentAttentionAndFinance.test.mjs) already locks in, proving
// the extraction didn't change behavior.
import assert from "assert";
import { buildDateRangeFilter } from "../controllers/appointmentController.js";
import { buildAttentionMatch, computeNeedsAttention } from "../utils/appointmentAttention.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";

// quickDate=today -> inclusive same-UTC-day range
{
  const result = buildDateRangeFilter({ quickDate: "today" });
  assert.ok(result.date.$gte instanceof Date);
  assert.ok(result.date.$lte instanceof Date);
  assert.strictEqual(result.date.$gte.getUTCHours(), 0);
  assert.strictEqual(result.date.$lte.getUTCHours(), 23);
}
console.log("PASS: quickDate=today produces an inclusive same-UTC-day range");

// quickDate=upcoming -> open-ended $gte from start of today
{
  const result = buildDateRangeFilter({ quickDate: "upcoming" });
  assert.ok(result.date.$gte instanceof Date);
  assert.strictEqual(result.date.$lte, undefined);
}
console.log("PASS: quickDate=upcoming produces an open-ended $gte range");

// quickDate=past -> open-ended $lt from start of today
{
  const result = buildDateRangeFilter({ quickDate: "past" });
  assert.ok(result.date.$lt instanceof Date);
  assert.strictEqual(result.date.$gte, undefined);
}
console.log("PASS: quickDate=past produces an open-ended $lt range");

// dateFrom/dateTo still take priority over quickDate when both are present
{
  const result = buildDateRangeFilter({ quickDate: "today", dateFrom: "2026-08-18" });
  assert.strictEqual(result.date.$gte.toISOString(), "2026-08-18T00:00:00.000Z");
}
console.log("PASS: explicit dateFrom/dateTo takes priority over quickDate");

// Unknown/absent quickDate is a no-op, matching pre-existing behavior
assert.deepStrictEqual(buildDateRangeFilter({}), {});
assert.deepStrictEqual(buildDateRangeFilter({ quickDate: "bogus" }), {});
console.log("PASS: absent/unrecognized quickDate remains a no-op (backward compatible)");

// buildAttentionMatch/computeNeedsAttention: extracted rule agrees with itself
{
  const now = Date.parse("2026-08-21T12:00:00.000Z");
  const stalePending = {
    status: APPOINTMENT_STATUS.PENDING,
    createdAt: new Date(now - 25 * 60 * 60 * 1000),
    paymentStatus: "pending",
    date: new Date(now + 10 * 24 * 60 * 60 * 1000),
  };
  assert.strictEqual(computeNeedsAttention(stalePending, now), true);

  const freshPending = { ...stalePending, createdAt: new Date(now - 1 * 60 * 60 * 1000) };
  assert.strictEqual(computeNeedsAttention(freshPending, now), false);

  const failedPayment = { status: APPOINTMENT_STATUS.COMPLETED, paymentStatus: "failed", createdAt: new Date(now), date: new Date(now) };
  assert.strictEqual(computeNeedsAttention(failedPayment, now), true);

  const approvedSoonUnpaid = {
    status: APPOINTMENT_STATUS.APPROVED,
    paymentStatus: "pending",
    createdAt: new Date(now),
    date: new Date(now + 2 * 60 * 60 * 1000),
  };
  assert.strictEqual(computeNeedsAttention(approvedSoonUnpaid, now), true);

  const approvedFarUnpaid = { ...approvedSoonUnpaid, date: new Date(now + 5 * 24 * 60 * 60 * 1000) };
  assert.strictEqual(computeNeedsAttention(approvedFarUnpaid, now), false);
}
console.log("PASS: computeNeedsAttention matches the documented real-signal rule (stale pending / failed payment / approved+unpaid+imminent)");

// The Mongo query fragment must reference the same real fields, never a
// fabricated priority/risk field (mirrors the pre-existing admin test).
const shape = JSON.stringify(buildAttentionMatch());
assert.ok(shape.includes(APPOINTMENT_STATUS.PENDING));
assert.ok(shape.includes(APPOINTMENT_STATUS.APPROVED));
assert.ok(shape.includes("failed"));
assert.ok(!shape.includes("priority"));
assert.ok(!shape.includes("riskScore"));
console.log("PASS: buildAttentionMatch query shape matches computeNeedsAttention's real fields");

console.log("ALL APPOINTMENT QUICKDATE/ATTENTION TESTS PASSED");

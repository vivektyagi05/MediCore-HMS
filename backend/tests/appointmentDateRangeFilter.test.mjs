// Regression test for Phase DOC-01: the Doctor Dashboard used to fetch
// GET /appointments?limit=200 with no date filter. That request was silently
// capped at 100 (getPagination's hard max) and sorted oldest-first, so a
// doctor with more than ~100 historical appointments could see today's and
// upcoming appointments never appear at all. buildDateRangeFilter is the
// fix's pure, dependency-free core -- tested directly without a DB.
import assert from "assert";
import { buildDateRangeFilter } from "../controllers/appointmentController.js";

// No range params -> no-op filter (existing unscoped callers unaffected)
assert.deepStrictEqual(buildDateRangeFilter({}), {});
assert.deepStrictEqual(buildDateRangeFilter({ status: "pending" }), {});
console.log("PASS: no dateFrom/dateTo -> filter unchanged (backward compatible)");

// dateFrom only -> $gte at start of that UTC day
{
  const result = buildDateRangeFilter({ dateFrom: "2026-08-18" });
  assert.ok(result.date.$gte instanceof Date);
  assert.strictEqual(result.date.$gte.toISOString(), "2026-08-18T00:00:00.000Z");
  assert.strictEqual(result.date.$lte, undefined);
}
console.log("PASS: dateFrom alone produces an open-ended $gte range (Dashboard's 'today onward' query)");

// dateFrom + dateTo -> full inclusive day range
{
  const result = buildDateRangeFilter({ dateFrom: "2026-08-18", dateTo: "2026-08-18" });
  assert.strictEqual(result.date.$gte.toISOString(), "2026-08-18T00:00:00.000Z");
  assert.strictEqual(result.date.$lte.toISOString(), "2026-08-18T23:59:59.999Z");
}
console.log("PASS: dateFrom+dateTo produces an inclusive same-day range");

// Invalid date strings are ignored rather than producing "Invalid Date" queries
{
  const result = buildDateRangeFilter({ dateFrom: "not-a-date" });
  assert.deepStrictEqual(result, {});
}
console.log("PASS: invalid dateFrom is rejected, not silently passed to Mongo as Invalid Date");

console.log("ALL APPOINTMENT DATE RANGE FILTER TESTS PASSED");

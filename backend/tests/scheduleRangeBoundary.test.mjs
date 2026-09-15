// Regression tests for Phase DOC-07 final pass additions.
// Pure, dependency-free — no MongoDB required, matching the project's
// established pattern (slotEngine.test.mjs, capacityAggregates.test.mjs).
import assert from "assert";
import { countInclusiveDays, MAX_RANGE_DAYS } from "../controllers/doctor/workflowController.js";

// 1. Inclusive day counting — a same-day range is 1 day, not 0.
assert.strictEqual(countInclusiveDays(new Date("2026-08-24T00:00:00Z"), new Date("2026-08-24T00:00:00Z")), 1);
console.log("PASS: same-day range counts as 1 day");

// 2. A 7-day week (Mon..Sun) is exactly 7, not 6 or 8 — this is the number
// the Week view's frontend range fetch relies on matching MAX_RANGE_DAYS.
assert.strictEqual(countInclusiveDays(new Date("2026-08-24T00:00:00Z"), new Date("2026-08-30T00:00:00Z")), 7);
console.log("PASS: 7-day range counts correctly");

// 3. A full 31-day month is exactly at the bound, not over it — a doctor
// must be able to view a 31-day month (e.g. March, May, July...) without the
// range endpoint rejecting it.
assert.strictEqual(countInclusiveDays(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-31T00:00:00Z")), 31);
assert.strictEqual(MAX_RANGE_DAYS, 31, "the Month view depends on the bound being at least 31 (longest calendar month)");
console.log("PASS: 31-day month range sits exactly at MAX_RANGE_DAYS, not rejected");

// 4. One day past the bound must be rejected by the controller (asserted
// here at the arithmetic level the controller's `dayCount > MAX_RANGE_DAYS`
// check depends on).
const oversized = countInclusiveDays(new Date("2026-07-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"));
assert.ok(oversized > MAX_RANGE_DAYS, "32-day range must exceed the bound so the controller throws 400");
console.log("PASS: 32-day range correctly exceeds MAX_RANGE_DAYS");

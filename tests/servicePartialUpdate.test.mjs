// Regression test for a real bug found while auditing the Services admin
// page for Phase UI-1: the previous single servicePayload() builder ran
// EVERY field through its coercion regardless of what the caller actually
// sent, so a partial update body like `{ isActive: false }` — the shape a
// real quick activate/deactivate action sends — produced `price: NaN`
// (from `Number(undefined)`). validateService's partial-mode guard checks
// `payload.price !== undefined`, and `NaN !== undefined` is true, so the
// request was rejected with "Price must be a non-negative number" even
// though price was never in the request body. Any quick status-toggle
// action that doesn't re-send the full form would have hit this on every
// call, silently making the "real status flow" requirement impossible.
//
// buildUpdatePayload() only includes keys actually present on `body`, so
// validateService sees a genuine `undefined` for anything not sent.
//
// Dependency-free — no live MongoDB, no HTTP server, same style as
// automationConditionEvaluator.test.mjs / monitoringAggregates.test.mjs.

import assert from "node:assert/strict";
import { buildUpdatePayload, validateService } from "../controllers/admin/serviceAdminController.js";

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("buildUpdatePayload: isActive-only body omits every other field", () => {
  const payload = buildUpdatePayload({ isActive: false });
  assert.deepEqual(payload, { isActive: false });
  assert.equal(payload.price, undefined);
});

test("validateService: partial isActive-only payload is valid (the bug this guards against)", () => {
  const payload = buildUpdatePayload({ isActive: false });
  const result = validateService(payload, true);
  assert.equal(result.isValid, true, `expected valid, got errors: ${JSON.stringify(result.errors)}`);
  assert.deepEqual(result.errors, {});
});

test("validateService: partial payload still rejects a genuinely invalid provided price", () => {
  const payload = buildUpdatePayload({ price: -5 });
  const result = validateService(payload, true);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.price);
});

test("buildUpdatePayload: full edit-form body still includes every field (existing edit flow unaffected)", () => {
  const payload = buildUpdatePayload({
    title: "MRI Scan",
    description: "Full body MRI",
    price: "4500",
    category: "Imaging",
    icon: "",
    image: "",
    isActive: true,
  });
  assert.deepEqual(payload, {
    title: "MRI Scan",
    description: "Full body MRI",
    price: 4500,
    category: "Imaging",
    icon: "",
    image: "",
    isActive: true,
  });
  const result = validateService(payload, true);
  assert.equal(result.isValid, true);
});

test("validateService: non-partial (create) mode still requires title/description/price/category", () => {
  const result = validateService({ price: NaN }, false);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.title);
  assert.ok(result.errors.description);
  assert.ok(result.errors.category);
  assert.ok(result.errors.price);
});

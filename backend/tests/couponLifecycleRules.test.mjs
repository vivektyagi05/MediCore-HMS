// Phase 03: coupon rule validation, usage summary, server-side discount maths.
// Atomic reserve/redeem/release semantics need real Mongo ($elemMatch/$pull) -> tests/mongo (BLOCKED_EXTERNAL here).
import assert from "assert";
import { validateCouponRules, summarizeCouponUsage, computeCouponDiscount } from "../payments/couponRules.js";

const NOW = new Date("2026-10-16T00:00:00Z");
const ok = { code: "SAVE10", type: "percentage", value: 10, expiresAt: "2026-12-01", usageLimit: 5 };
assert.deepStrictEqual(validateCouponRules(ok, { isCreate: true, now: NOW }), []);
const bad = (patch, opts = {}) => validateCouponRules({ ...ok, ...patch }, { isCreate: true, now: NOW, ...opts }).map((e) => e.field);
assert.ok(bad({ value: 150 }).includes("value"), "percentage > 100 rejected");
assert.ok(bad({ value: 0 }).includes("value"));
assert.ok(bad({ expiresAt: "2026-10-01" }).includes("expiresAt"), "past expiry rejected on create");
assert.ok(bad({ expiresAt: "nope" }).includes("expiresAt"));
assert.ok(bad({ usageLimit: 0 }).includes("usageLimit"));
assert.ok(bad({ usageLimit: 1.5 }).includes("usageLimit"));
assert.ok(bad({ code: "a b" }).includes("code"));
assert.ok(bad({ type: "bogus" }).includes("type"));
assert.ok(bad({ type: "fixed", value: 50, maxDiscount: 20 }).includes("maxDiscount"));
console.log("PASS: coupon create validation");

const existing = { ...ok, usedCount: 4 };
assert.ok(validateCouponRules({ usageLimit: 3 }, { existing }).some((e) => e.field === "usageLimit"), "limit cannot go below current usage");
assert.deepStrictEqual(validateCouponRules({ usageLimit: 4 }, { existing }), []);
assert.deepStrictEqual(validateCouponRules({ isActive: false }, { existing }), []);
console.log("PASS: coupon update cross-field rules");

const s = summarizeCouponUsage({ usageLimit: 5, usedCount: 3, releasedCount: 2, usedBy: [{ state: "reserved" }, { state: "redeemed" }, {}] });
assert.deepStrictEqual([s.reserved, s.redeemed, s.legacyUnclassified, s.remaining, s.released, s.consistent], [1, 1, 1, 2, 2, true]);
assert.strictEqual(summarizeCouponUsage({ usageLimit: 5, usedCount: 2, usedBy: [{ state: "reserved" }] }).consistent, false, "counter/entry mismatch is surfaced");
console.log("PASS: usage summary keeps legacy entries unclassified");

assert.strictEqual(computeCouponDiscount({ coupon: { type: "percentage", value: 10 }, amount: 999.99 }), 100);
assert.strictEqual(computeCouponDiscount({ coupon: { type: "percentage", value: 50, maxDiscount: 120 }, amount: 1000 }), 120);
assert.strictEqual(computeCouponDiscount({ coupon: { type: "fixed", value: 500 }, amount: 300 }), 300, "never exceeds the amount");
console.log("PASS: discount calculation");
process.exit(0);

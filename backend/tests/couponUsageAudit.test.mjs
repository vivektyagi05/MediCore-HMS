import assert from "node:assert/strict";
import { inventoryCoupon as inv } from "../scripts/audit-coupon-usage.mjs";
const now = new Date("2026-10-17T10:00:00Z"); const old = new Date(now - 3600e3);
assert.deepEqual(inv({ usedCount: 0, usedBy: [] }, { now }).issues, []);
const mixed = inv({ usedCount: 3, redeemedCount: 1, usedBy: [{ paymentId: "a", state: "redeemed" }, { paymentId: "b", state: "reserved", usedAt: old }, { paymentId: "c" }] }, { now });
assert.deepEqual([mixed.reserved, mixed.redeemed, mixed.legacyUnclassified, mixed.staleReserved, mixed.issues.length], [1, 1, 1, 1, 0], "legacy stays unclassified and is not an issue by itself");
assert.ok(inv({ usedCount: 2, usedBy: [{ paymentId: "a", state: "reserved" }] }, { now }).issues[0].includes("usedCount 2"));
assert.ok(inv({ usedCount: 2, usedBy: [{ paymentId: "a", state: "reserved" }, { paymentId: "a", state: "reserved" }] }, { now }).issues.some((i) => /duplicate/.test(i)));
console.log("couponUsageAudit: 4 checks passed");

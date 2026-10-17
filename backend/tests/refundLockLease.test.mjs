// Phase 03: the refund lock is a fenced LEASE. Pure tests of the exact filter
// the controller sends to Mongo, evaluated by a tiny matcher (no live DB).
// Real conditional-update semantics are covered by the mongo suite (BLOCKED_EXTERNAL here).
import assert from "assert";
import { buildRefundLockFilter, isRefundLockStale, REFUND_LOCK_LEASE_MS } from "../payments/refundLock.js";

const NOW = new Date("2026-10-16T10:00:00Z");
const matches = (doc, filter) => {
  const clause = (c) => Object.entries(c).every(([k, v]) => {
    const val = doc[k];
    if (v && typeof v === "object" && "$exists" in v) return v.$exists ? val !== undefined : val === undefined;
    if (v && typeof v === "object" && "$lt" in v) return val instanceof Date && val < v.$lt;
    return val === v;
  });
  return filter.$or.some(clause);
};
const f = buildRefundLockFilter({ paymentId: "P1", now: NOW });

assert.ok(matches({}, f), "an unlocked payment can be locked");
assert.ok(matches({ refundLockedAt: null }, f), "a null lock can be locked");
assert.ok(!matches({ refundLockedAt: new Date(NOW.getTime() - 1000) }, f), "a live lease blocks a second caller");
assert.ok(!matches({ refundLockedAt: new Date(NOW.getTime() - REFUND_LOCK_LEASE_MS + 1) }, f), "a lease just inside its window still blocks");
assert.ok(matches({ refundLockedAt: new Date(NOW.getTime() - REFUND_LOCK_LEASE_MS - 1) }, f), "a crashed holder's expired lease can be taken over");
console.log("PASS: refund lock lease grants only unlocked or expired locks");

assert.strictEqual(isRefundLockStale(undefined, { now: NOW }), false);
assert.strictEqual(isRefundLockStale(new Date(NOW.getTime() - 1000), { now: NOW }), false);
assert.strictEqual(isRefundLockStale(new Date(NOW.getTime() - REFUND_LOCK_LEASE_MS - 1), { now: NOW }), true);
console.log("PASS: stale-lease detection");

// Token fencing on release is a conditional updateOne ({_id, refundLockToken}); it needs real
// Mongo semantics to test honestly, so it is covered in tests/mongo (BLOCKED_EXTERNAL here).
process.exit(0);

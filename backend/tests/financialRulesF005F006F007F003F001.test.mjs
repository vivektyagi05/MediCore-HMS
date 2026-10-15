// Pure-rule tests for the financial hardening slice. These prove decision logic
// only; the DB-level guarantees are exercised by tests/mongo/ (needs MONGODB_TEST_URI).
import assert from "assert";
import { classifyClaimFailure, buildClaimFilter } from "../payments/couponService.js";
import { buildRetryClaimFilter, MAX_RETRIES, RETRY_LEASE_MS } from "../payments/paymentRetryService.js";
import { buildCursorFilter } from "../payments/reconciliationService.js";
import { planOutOfBandRefund } from "../payments/outOfBandRefund.js";
import { computeNextPeriod, hasPaidAccess, ACTIVATABLE_STATES, PAID_ACCESS_STATES } from "../payments/subscriptionLifecycle.js";

const ok = (name) => console.log(`PASS: ${name}`);

// ---- F-005 coupon
const now = new Date("2026-10-09T00:00:00Z");
const future = new Date("2027-01-01T00:00:00Z");
const base = { isActive: true, expiresAt: future, usageLimit: 1, usedCount: 0, usedBy: [] };
assert.strictEqual(classifyClaimFailure({ ...base, usedCount: 1 }, { userId: "u1", paymentId: "p1", now }).code, "COUPON_LIMIT_REACHED");
assert.strictEqual(classifyClaimFailure({ ...base, expiresAt: new Date("2026-01-01") }, { userId: "u1", paymentId: "p1", now }).code, "COUPON_EXPIRED");
assert.strictEqual(classifyClaimFailure({ ...base, userId: "other" }, { userId: "u1", paymentId: "p1", now }).status, 403);
assert.strictEqual(classifyClaimFailure({ ...base, usedBy: [{ userId: "u1", paymentId: "p0" }] }, { userId: "u1", paymentId: "p1", now }).code, "COUPON_ALREADY_USED_BY_USER");
assert.strictEqual(classifyClaimFailure({ ...base, usedCount: 1, usedBy: [{ userId: "u1", paymentId: "p1" }] }, { userId: "u1", paymentId: "p1", now }).alreadyClaimed, true);
assert.strictEqual(classifyClaimFailure(null, { userId: "u1", paymentId: "p1", now }).code, "COUPON_INVALID");
const claimFilter = buildClaimFilter({ couponId: "c1", userId: "u1", paymentId: "p1", now });
assert.deepStrictEqual(claimFilter.$expr, { $lt: ["$usedCount", "$usageLimit"] }, "limit check must live inside the atomic filter");
assert.deepStrictEqual(claimFilter["usedBy.paymentId"], { $ne: "p1" });
ok("coupon claim: limit/expiry/user/payment rules live in one atomic predicate");

// ---- F-006 retry claim
const rf = buildRetryClaimFilter({ paymentId: "p1", now });
assert.strictEqual(rf.status, "failed");
assert.deepStrictEqual(rf.retryCount, { $lt: MAX_RETRIES });
assert.deepStrictEqual(rf.paymentState, { $ne: "pending" });
assert.ok(rf.$or.some((c) => c.retryClaimedAt?.$lt?.getTime() === now.getTime() - RETRY_LEASE_MS), "expired lease must be reclaimable");
ok("retry claim predicate: single conditional claim with expiring lease");

// ---- F-007 cursor
assert.deepStrictEqual(buildCursorFilter(null, { status: "captured" }), { status: "captured" });
assert.deepStrictEqual(buildCursorFilter("abc", { status: "captured" }), { status: "captured", _id: { $gt: "abc" } });
ok("reconciliation cursor filter is _id-ordered and resumable");

// ---- F-003 out-of-band refund planning (integer paise)
const pay = { status: "captured", totalAmount: 500, refundedAmount: 0, processedGatewayRefundIds: [] };
assert.deepStrictEqual(planOutOfBandRefund({ payment: pay, gatewayRefundId: "r1", providerAmountPaise: 12345 }), { action: "finalize", amount: 123.45, paise: 12345 });
assert.strictEqual(planOutOfBandRefund({ payment: { ...pay, processedGatewayRefundIds: ["r1"] }, gatewayRefundId: "r1", providerAmountPaise: 100 }).action, "skip_duplicate");
assert.strictEqual(planOutOfBandRefund({ payment: { ...pay, refundedAmount: 450 }, gatewayRefundId: "r2", providerAmountPaise: 10000 }).reason, "exceeds_refundable_amount");
assert.strictEqual(planOutOfBandRefund({ payment: { ...pay, status: "failed" }, gatewayRefundId: "r3", providerAmountPaise: 100 }).action, "reconciliation_required");
assert.strictEqual(planOutOfBandRefund({ payment: pay, gatewayRefundId: "r4", providerAmountPaise: 10.5 }).reason, "invalid_provider_amount");
assert.strictEqual(planOutOfBandRefund({ payment: null, gatewayRefundId: "r5", providerAmountPaise: 100 }).action, "unknown_payment");
ok("out-of-band refund: finalize only when safe, never overshoot, dedupe by provider id");

// ---- F-001 / F-023 subscription lifecycle
const end = new Date("2026-11-01T00:00:00Z");
const initial = computeNextPeriod({ interval: "monthly", now, isRenewal: false });
assert.strictEqual(initial.periodStart.getTime(), now.getTime());
const renewal = computeNextPeriod({ interval: "monthly", currentPeriodEnd: end, now, isRenewal: true });
assert.strictEqual(renewal.periodStart.getTime(), end.getTime(), "renewal extends from end of paid period");
const lapsed = computeNextPeriod({ interval: "yearly", currentPeriodEnd: new Date("2026-01-01"), now, isRenewal: true });
assert.strictEqual(lapsed.periodStart.getTime(), now.getTime(), "lapsed renewal starts now, no back-dating");
assert.strictEqual(hasPaidAccess({ status: "pending_payment" }, now), false);
assert.strictEqual(hasPaidAccess({ status: "payment_failed" }, now), false);
assert.strictEqual(hasPaidAccess({ status: "renewal_pending", currentPeriodEnd: end }, now), true);
assert.strictEqual(hasPaidAccess({ status: "renewal_pending", currentPeriodEnd: new Date("2026-10-01") }, now), false);
assert.strictEqual(hasPaidAccess({ status: "active", currentPeriodEnd: end }, now), true);
assert.ok(!ACTIVATABLE_STATES.includes("active") && !ACTIVATABLE_STATES.includes("cancelled") && !ACTIVATABLE_STATES.includes("expired"), "capture cannot re-activate active/cancelled/expired");
assert.ok(!PAID_ACCESS_STATES.includes("pending_payment"));
ok("subscription: unpaid states never carry access; renewal extends only the paid period");

console.log("financialRulesF005F006F007F003F001: all assertions passed");

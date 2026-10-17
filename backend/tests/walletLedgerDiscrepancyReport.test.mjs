// Phase 03: pure classification + deterministic ids of the read-only discrepancy report.
// Aggregation pipelines need real Mongo (tests/mongo, BLOCKED_EXTERNAL here).
import assert from "assert";
import { buildDiscrepancyId, classifyBalanceDrift, classifyReservation, classifyRefundTotals, clampPage, DISCREPANCY_CATEGORIES as C, RESERVATION_STALE_MS } from "../services/finance/walletReconciliationService.js";

assert.strictEqual(buildDiscrepancyId({ category: C.WALLET_BALANCE_DRIFT, subjectId: "u1" }), buildDiscrepancyId({ category: C.WALLET_BALANCE_DRIFT, subjectId: "u1" }));
assert.notStrictEqual(buildDiscrepancyId({ category: C.WALLET_BALANCE_DRIFT, subjectId: "u1" }), buildDiscrepancyId({ category: C.WALLET_BALANCE_DRIFT, subjectId: "u2" }));
console.log("PASS: discrepancy ids are deterministic and subject-specific");

assert.strictEqual(classifyBalanceDrift({ userId: "u", expectedPaise: 5000, actualPaise: 5000 }), null);
const d = classifyBalanceDrift({ userId: "u", expectedPaise: 5000, actualPaise: 7000 });
assert.strictEqual(d.driftPaise, 2000); assert.strictEqual(d.certainty, "confirmed");
assert.ok(/legacy/.test(classifyBalanceDrift({ userId: "u", expectedPaise: 0, actualPaise: 100 }).note));
console.log("PASS: balance drift classification");

const now = new Date("2026-10-16T10:00:00Z");
const res = (status, ageMs, extra = {}) => ({ _id: "r1", paymentId: "p1", userId: "u1", status, updatedAt: new Date(now - ageMs), ...extra });
assert.strictEqual(classifyReservation({ reservation: res("reserved", 1000), walletHoldPaymentIds: ["p1"], now }).length, 0, "healthy fresh reservation");
assert.strictEqual(classifyReservation({ reservation: res("recovery_required", 1000, { lastError: "x" }), walletHoldPaymentIds: ["p1"], now })[0].category, C.RESERVATION_STALE);
const stale = classifyReservation({ reservation: res("reserved", RESERVATION_STALE_MS + 1), walletHoldPaymentIds: ["p1"], now });
assert.strictEqual(stale[0].certainty, "missing_evidence", "age alone is missing evidence, not a confirmed discrepancy");
assert.strictEqual(classifyReservation({ reservation: res("reserved", 1000), walletHoldPaymentIds: [], now })[0].category, C.RESERVATION_CONTRADICTION);
assert.strictEqual(classifyReservation({ reservation: res("committed", 1000), walletHoldPaymentIds: ["p1"], now })[0].category, C.RESERVATION_CONTRADICTION);
assert.strictEqual(classifyReservation({ reservation: res("released", 1000), walletHoldPaymentIds: [], now }).length, 0);
console.log("PASS: reservation staleness/contradiction classification");

assert.strictEqual(classifyRefundTotals({ paymentId: "p", confirmedRequestsPaise: 1000, paymentRefundedPaise: 1000, paymentTotalPaise: 5000 }).length, 0);
assert.strictEqual(classifyRefundTotals({ paymentId: "p", confirmedRequestsPaise: 3000, paymentRefundedPaise: 1000, paymentTotalPaise: 5000 }).length, 1);
assert.strictEqual(classifyRefundTotals({ paymentId: "p", confirmedRequestsPaise: 0, paymentRefundedPaise: 6000, paymentTotalPaise: 5000 }).length, 1);
console.log("PASS: refund total contradictions");

assert.deepStrictEqual(clampPage({ page: -3, limit: 9999 }), { page: 1, limit: 100, skip: 0 });
assert.deepStrictEqual(clampPage({ page: 3, limit: 10 }), { page: 3, limit: 10, skip: 20 });
console.log("PASS: pagination is bounded");
process.exit(0);

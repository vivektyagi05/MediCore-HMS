import assert from "node:assert/strict";
import fs from "node:fs";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/x";
process.env.JWT_SECRET ||= "testsecret-testsecret-testsecret-123";
process.env.PAYMENT_GATEWAY_MODE = "test";
process.env.NODE_ENV = "development";
const { classifyGatewayRefund, isDefinitiveGatewayRejection, GATEWAY_REFUND_OUTCOME: O } = await import("../payments/refundGatewayOutcome.js");
const { paymentGateway } = await import("../payments/paymentGateway.js");
const { REFUND_STATES, assertRefundTransition } = await import("../payments/refundStateMachine.js");

// Provider status is interpreted, never assumed.
assert.equal(classifyGatewayRefund({ id: "r", status: "processed" }), O.PROCESSED);
assert.equal(classifyGatewayRefund({ id: "r", status: "pending" }), O.PENDING);
assert.equal(classifyGatewayRefund({ id: "r", status: "failed" }), O.FAILED);
assert.equal(classifyGatewayRefund({ id: "r" }), O.UNKNOWN);
assert.equal(classifyGatewayRefund({ id: "r", status: "weird" }), O.UNKNOWN);
assert.equal(classifyGatewayRefund(null), O.UNKNOWN);
assert.equal(classifyGatewayRefund({ status: "processed" }), O.UNKNOWN, "no refund id => cannot be trusted as processed");

// 4xx = definitive rejection; timeouts/5xx/unknown = ambiguous (never blind-retry).
assert.equal(isDefinitiveGatewayRejection({ statusCode: 400 }), true);
assert.equal(isDefinitiveGatewayRejection({ response: { status: 422 } }), true);
assert.equal(isDefinitiveGatewayRejection({ statusCode: 502 }), false);
assert.equal(isDefinitiveGatewayRejection({ code: "ETIMEDOUT" }), false);
assert.equal(isDefinitiveGatewayRejection(new Error("boom")), false);

// Test gateway scenarios drive every outcome through the same classification.
const run = async (scenario) => { process.env.TEST_PAYMENT_SCENARIO = scenario; return paymentGateway.refundPayment({ paymentId: "p1", amount: 100, notes: { refundRequestId: "rr1" } }); };
assert.equal(classifyGatewayRefund(await run("success")), O.PROCESSED);
const pending = await run("refund_pending");
assert.equal(classifyGatewayRefund(pending), O.PENDING);
assert.equal(classifyGatewayRefund(await run("refund_unknown")), O.UNKNOWN);
await assert.rejects(run("refund_failure"), (e) => isDefinitiveGatewayRejection(e));
await assert.rejects(run("refund_timeout"), (e) => !isDefinitiveGatewayRejection(e));
// A pending refund settles when the provider is asked again; listing finds it by our note.
process.env.TEST_PAYMENT_SCENARIO = "success";
assert.equal(classifyGatewayRefund(await paymentGateway.fetchRefund({ refundId: pending.id })), O.PROCESSED);
const listed = await paymentGateway.listPaymentRefunds({ paymentId: "p1" });
assert.ok(listed.some((r) => r.notes?.refundRequestId === "rr1"));

// Every transition the new refund paths take is legal in the state machine.
const path = (...states) => states.reduce((from, to) => { assertRefundTransition(from, to); return to; });
path(REFUND_STATES.APPROVED, REFUND_STATES.GATEWAY_PROCESSING, REFUND_STATES.FAILED, REFUND_STATES.RETRY_REQUIRED, REFUND_STATES.APPROVED);
path(REFUND_STATES.GATEWAY_PROCESSING, REFUND_STATES.RECONCILIATION_REQUIRED, REFUND_STATES.PROCESSED);
path(REFUND_STATES.RECONCILIATION_REQUIRED, REFUND_STATES.FAILED, REFUND_STATES.RETRY_REQUIRED);
assert.throws(() => assertRefundTransition(REFUND_STATES.GATEWAY_PROCESSING, REFUND_STATES.RETRY_REQUIRED), "the old direct hop was illegal and masked every gateway failure");

// Structural contracts (NOT REAL-MONGO VERIFIED).
const ctl = fs.readFileSync(new URL("../controllers/refundController.js", import.meta.url), "utf8");
assert.doesNotMatch(ctl, /adjustDoctorPayoutForRefund/, "old non-idempotent payout adjustment removed");
assert.match(ctl, /classifyGatewayRefund\(refund\)/, "gateway result must be classified");
assert.match(ctl, /applyRefundToDoctorEarning\(/, "finalize must reverse the doctor earning");
assert.match(ctl, /if \(isFullRefund\) \{\s*await Appointment\.findByIdAndUpdate/, "partial refund must not mark the appointment refunded");
assert.doesNotMatch(ctl, /refundRequest\.status = "failed";\s*appendRefundTransition\(refundRequest, REFUND_STATES\.RETRY_REQUIRED/, "illegal gateway_processing -> retry_required hop gone");
const hook = fs.readFileSync(new URL("../payments/webhookHandler.js", import.meta.url), "utf8");
assert.match(hook, /settlePendingGatewayRefund/, "refund webhook must converge on the shared finalize step");
console.log("refundGatewayOutcome: all assertions passed");

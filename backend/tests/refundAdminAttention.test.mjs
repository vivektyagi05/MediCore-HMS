// Dependency-free re-check of refundAdminController.js's real, documented
// "needs attention" rule (no live DB needed — computeRefundAttention is a
// pure function). Locks in: (1) a genuinely failed refund is always
// flagged, with its real failure reason surfaced, never a fabricated one;
// (2) a refund pending approval past the 2h threshold is flagged, not
// before; (3) repeated failed attempts (>1 "failed" timeline entry) are
// flagged as such; (4) a healthy refund is never flagged.
import assert from "assert";
import { computeRefundAttention } from "../controllers/admin/refundAdminController.js";

// 1. Genuinely failed refund — real failure reason surfaced verbatim, not
// paraphrased or replaced with a generic message.
const failedRefund = {
  status: "failed",
  failureReason: "Gateway timeout after 30s",
  createdAt: new Date(),
  timeline: [
    { status: "pending" },
    { status: "approved" },
    { status: "failed" },
  ],
};
const failedResult = computeRefundAttention(failedRefund);
assert.strictEqual(failedResult.needsAttention, true);
assert.ok(failedResult.attentionReasons.some((r) => r.includes("Gateway timeout after 30s")));
console.log("PASS: a failed refund is flagged with its real gateway failure reason");

// 2. Failed refund with no failureReason recorded (defensive case) still
// flags, but with an honest generic message rather than fabricating a
// specific reason that was never actually captured.
const failedNoReason = { status: "failed", failureReason: null, createdAt: new Date(), timeline: [] };
const failedNoReasonResult = computeRefundAttention(failedNoReason);
assert.strictEqual(failedNoReasonResult.needsAttention, true);
assert.ok(failedNoReasonResult.attentionReasons.some((r) => r === "Refund failed at the gateway"));
console.log("PASS: a failed refund with no stored reason gets an honest generic flag, not a fabricated one");

// 3. Pending approval, stuck past the 2h threshold.
const stuckPending = {
  status: "pending",
  failureReason: null,
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  timeline: [],
};
assert.strictEqual(computeRefundAttention(stuckPending).needsAttention, true);
console.log("PASS: a refund pending approval for >2h is flagged");

// 4. Pending approval, still within the grace window — not flagged.
const freshPending = {
  status: "pending",
  failureReason: null,
  createdAt: new Date(Date.now() - 5 * 60 * 1000),
  timeline: [],
};
assert.strictEqual(computeRefundAttention(freshPending).needsAttention, false);
console.log("PASS: a freshly submitted pending refund within the grace window is not flagged");

// 5. Repeated failure — more than one "failed" timeline entry (a retry
// that failed again).
const repeatedFailure = {
  status: "failed",
  failureReason: "Gateway rejected again",
  createdAt: new Date(),
  timeline: [
    { status: "failed" },
    { status: "approved" },
    { status: "failed" },
  ],
};
const repeatedResult = computeRefundAttention(repeatedFailure);
assert.strictEqual(repeatedResult.needsAttention, true);
assert.ok(repeatedResult.attentionReasons.some((r) => r.includes("failed 2 times")));
console.log("PASS: a refund that has failed more than once surfaces a repeated-failure reason");

// 6. A processed (successful) refund is never flagged.
const processed = { status: "processed", failureReason: null, createdAt: new Date(), timeline: [{ status: "processed" }] };
const processedResult = computeRefundAttention(processed);
assert.strictEqual(processedResult.needsAttention, false);
assert.deepStrictEqual(processedResult.attentionReasons, []);
console.log("PASS: a successfully processed refund is never flagged");

// 7. An approved refund awaiting gateway processing is not itself flagged
// by age (only "pending" ages out — "approved" transitions synchronously
// to processed/failed within the same request in this architecture, so an
// approved record persisting means processing is genuinely still running,
// not "stuck").
const approved = { status: "approved", failureReason: null, createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), timeline: [] };
assert.strictEqual(computeRefundAttention(approved).needsAttention, false);
console.log("PASS: an approved refund is not flagged by age alone");

console.log("ALL REFUND ADMIN ATTENTION TESTS PASSED");

import assert from "assert";
import { computeReviewAttentionItems, buildReviewSummary } from "../services/reviewAdminAggregates.js";

const negativeUnreplied = { _id: "r1", rating: 1, doctorReply: null, isPinned: false };
const negativeReplied = { _id: "r2", rating: 2, doctorReply: { message: "Sorry to hear that" }, isPinned: false };
const positiveUnreplied = { _id: "r3", rating: 4, doctorReply: null, isPinned: false };
const positivePinned = { _id: "r4", rating: 5, doctorReply: { message: "Thank you!" }, isPinned: true };
const positiveReplied = { _id: "r5", rating: 5, doctorReply: { message: "Glad to help" }, isPinned: false };

// ── computeReviewAttentionItems ────────────────────────────────────────
const attention = computeReviewAttentionItems([
  negativeUnreplied,
  negativeReplied,
  positiveUnreplied,
  positivePinned,
  positiveReplied,
]);

assert.strictEqual(attention.length, 4, "positiveReplied (clean review) should not appear in the queue");
console.log("PASS: clean review produces no attention item");

assert.strictEqual(attention[0].reviewId, "r1");
assert.strictEqual(attention[0].severity, "critical");
console.log("PASS: negative + unreplied is classified critical and ranked first");

const negativeOnly = attention.find((i) => i.reviewId === "r2");
assert.strictEqual(negativeOnly.severity, "warning");
console.log("PASS: negative-but-replied is classified warning, not critical");

const unrepliedOnly = attention.find((i) => i.reviewId === "r3");
assert.strictEqual(unrepliedOnly.severity, "warning");
console.log("PASS: positive-but-unreplied is classified warning");

const pinnedOnly = attention.find((i) => i.reviewId === "r4");
assert.strictEqual(pinnedOnly.severity, "info");
console.log("PASS: pinned-and-otherwise-clean review is informational only");

const severities = attention.map((i) => i.severity);
const rank = { critical: 0, warning: 1, info: 2 };
for (let i = 1; i < severities.length; i += 1) {
  assert.ok(rank[severities[i]] >= rank[severities[i - 1]], "queue must be sorted by severity");
}
console.log("PASS: attention queue is sorted critical -> warning -> info");

assert.deepStrictEqual(computeReviewAttentionItems([]), []);
console.log("PASS: empty review set produces an empty queue");

// ── buildReviewSummary ─────────────────────────────────────────────────
const emptySummary = buildReviewSummary([]);
assert.strictEqual(emptySummary.totalReviews, 0);
assert.strictEqual(emptySummary.averageRating, null);
assert.strictEqual(emptySummary.responseRate, null, "responseRate must be null (N/A), never a fabricated 0%");
console.log("PASS: empty review set yields null averageRating/responseRate, not fabricated zeros");

const summary = buildReviewSummary([negativeUnreplied, negativeReplied, positiveUnreplied, positivePinned, positiveReplied]);
assert.strictEqual(summary.totalReviews, 5);
assert.strictEqual(summary.negativeCount, 2);
assert.strictEqual(summary.unrepliedCount, 2);
assert.strictEqual(summary.pinnedCount, 1);
assert.strictEqual(summary.responseRate, 60, "3 of 5 replied -> 60%");
assert.strictEqual(summary.averageRating, Number(((1 + 2 + 4 + 5 + 5) / 5).toFixed(1)));
console.log("PASS: summary KPIs computed correctly from a mixed review set");

console.log("ALL REVIEW ADMIN ATTENTION TESTS PASSED");

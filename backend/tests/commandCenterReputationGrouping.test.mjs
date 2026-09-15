import assert from "assert";
import { computeReviewAttentionItems } from "../services/reviewAdminAggregates.js";
import { groupReviewAttentionByDoctor } from "../services/commandCenter/commandCenterHelpers.js";

// Two reviews for doctor A (one critical, one warning), one clean review
// for doctor B (should not appear at all), one pinned-only review for
// doctor C (informational — should not count toward attention either).
const doctorA = { _id: "docA", userId: { name: "Dr. A" } };
const doctorB = { _id: "docB", userId: { name: "Dr. B" } };
const doctorC = { _id: "docC", userId: { name: "Dr. C" } };

const reviews = [
  { _id: "r1", rating: 1, doctorReply: null, isPinned: false, doctorId: doctorA },
  { _id: "r2", rating: 3, doctorReply: null, isPinned: false, doctorId: doctorA },
  { _id: "r3", rating: 5, doctorReply: { message: "Thanks!" }, isPinned: false, doctorId: doctorB },
  { _id: "r4", rating: 5, doctorReply: { message: "Thanks!" }, isPinned: true, doctorId: doctorC },
];

const attentionItems = computeReviewAttentionItems(reviews);
const reviewsById = new Map(reviews.map((r) => [String(r._id), r]));

const grouped = groupReviewAttentionByDoctor(attentionItems, reviewsById);

assert.strictEqual(grouped.length, 1, "only doctor A should appear — doctor B is clean, doctor C is pinned-only (info)");
console.log("PASS: clean and pinned-only doctors do not appear in the reputation-attention grouping");

assert.strictEqual(grouped[0].doctorId, "docA");
assert.strictEqual(grouped[0].doctorName, "Dr. A");
assert.strictEqual(grouped[0].criticalCount, 1);
assert.strictEqual(grouped[0].warningCount, 1);
console.log("PASS: doctor A's critical (negative+unreplied) and warning (unreplied) counts are correctly tallied");

// Sort order: higher criticalCount first.
const doctorD = { _id: "docD", userId: { name: "Dr. D" } };
const reviews2 = [
  { _id: "r5", rating: 1, doctorReply: null, isPinned: false, doctorId: doctorA }, // doctor A now has 2 critical
  ...reviews,
  { _id: "r6", rating: 2, doctorReply: null, isPinned: false, doctorId: doctorD }, // doctor D has 1 critical
];
const attentionItems2 = computeReviewAttentionItems(reviews2);
const reviewsById2 = new Map(reviews2.map((r) => [String(r._id), r]));
const grouped2 = groupReviewAttentionByDoctor(attentionItems2, reviewsById2);

assert.strictEqual(grouped2[0].doctorId, "docA", "doctor with more critical items should be ranked first");
console.log("PASS: doctors are ranked by criticalCount descending");

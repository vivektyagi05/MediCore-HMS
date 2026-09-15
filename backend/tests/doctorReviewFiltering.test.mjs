import assert from "assert";
import { filterReviews, resolveFocusPage } from "../services/doctorReviewFiltering.js";

const r1 = { _id: "r1", rating: 5, comment: "Great bedside manner", userId: { name: "Asha Patel" }, doctorReply: { message: "Thanks!" }, isPinned: false };
const r2 = { _id: "r2", rating: 1, comment: "Long wait times", userId: { name: "Ben Carter" }, doctorReply: null, isPinned: false };
const r3 = { _id: "r3", rating: 3, comment: "Average visit", userId: { name: "Chen Wu" }, doctorReply: null, isPinned: true };
const r4 = { _id: "r4", rating: 4, comment: "Would recommend", userId: { name: "Dev Singh" }, doctorReply: { message: "Glad to help" }, isPinned: false };
const reviews = [r1, r2, r3, r4];

// ── filterReviews ──────────────────────────────────────────────────────
assert.deepStrictEqual(filterReviews(reviews, {}), reviews, "no filters returns the full list unchanged");
console.log("PASS: no filters returns the full list");

const byRating = filterReviews(reviews, { rating: "1" });
assert.strictEqual(byRating.length, 1);
assert.strictEqual(byRating[0]._id, "r2");
console.log("PASS: rating filter matches exact star value only");

const unreplied = filterReviews(reviews, { attention: "unreplied" });
assert.deepStrictEqual(unreplied.map((r) => r._id), ["r2", "r3"]);
console.log("PASS: unreplied attention filter matches reviews with no doctorReply.message");

const pinned = filterReviews(reviews, { attention: "pinned" });
assert.deepStrictEqual(pinned.map((r) => r._id), ["r3"]);
console.log("PASS: pinned attention filter matches isPinned reviews only");

const negative = filterReviews(reviews, { attention: "negative" });
assert.deepStrictEqual(negative.map((r) => r._id), ["r2"]);
console.log("PASS: negative attention filter matches rating<=2 only");

const bySearchName = filterReviews(reviews, { search: "ben" });
assert.deepStrictEqual(bySearchName.map((r) => r._id), ["r2"]);
console.log("PASS: search matches patient name, case-insensitive");

const bySearchComment = filterReviews(reviews, { search: "recommend" });
assert.deepStrictEqual(bySearchComment.map((r) => r._id), ["r4"]);
console.log("PASS: search matches review comment text");

const combined = filterReviews(reviews, { search: "wait", attention: "negative" });
assert.deepStrictEqual(combined.map((r) => r._id), ["r2"]);
console.log("PASS: multiple filters combine (AND) correctly");

assert.deepStrictEqual(filterReviews([], { rating: "5" }), []);
console.log("PASS: empty review set never throws and returns empty");

// ── resolveFocusPage ────────────────────────────────────────────────────
assert.strictEqual(resolveFocusPage(reviews, "", 1, 2), null, "no focusReviewId returns null");
assert.strictEqual(resolveFocusPage(reviews, "missing-id", 1, 2), null, "unknown review id returns null");
console.log("PASS: resolveFocusPage returns null when there is nothing to focus on");

// pageSize 2: r1,r2 -> page 1; r3,r4 -> page 2
assert.strictEqual(resolveFocusPage(reviews, "r1", 5, 2), 1);
assert.strictEqual(resolveFocusPage(reviews, "r4", 5, 2), 2);
console.log("PASS: resolveFocusPage derives the real page a review lives on, ignoring the requested page");

console.log("ALL DOCTOR REVIEW FILTERING TESTS PASSED");

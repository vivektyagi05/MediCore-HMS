// S3 regression (A-03a, A-03d, A-15, A-16): admin review summary/attention queue computed in the database, rating +
// sentiment filter intersection, atomic delete. Pure/stubbed: the real filter objects the controller builds are run
// against fixtures through tests/helpers/miniMongo.mjs. Real-database behaviour is NOT covered here.
import assert from "assert";
import Review from "../models/Review.js";
import Doctor from "../models/Doctor.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import {
  listReviewsAdmin,
  getReviewSummaryAdmin,
  getReviewAttentionQueueAdmin,
  deleteReview,
} from "../controllers/admin/adminReviewController.js";
import {
  ATTENTION_BUCKET_FILTERS,
  buildReviewSummary,
  buildReviewSummaryFromTotals,
  buildReviewSummaryPipeline,
  combineRatingFilter,
  computeReviewAttentionItems,
} from "../services/reviewAdminAggregates.js";
import { callHandler, fakeQuery, matches } from "./helpers/miniMongo.mjs";

const originals = {
  find: Review.find, aggregate: Review.aggregate, countDocuments: Review.countDocuments,
  findOneAndUpdate: Review.findOneAndUpdate, exists: Review.exists, doctorUpdate: Doctor.findByIdAndUpdate,
  logCreate: AdminActivityLog.create, emit: notificationEmitter.emitToUser,
};
const restore = () => {
  Review.find = originals.find; Review.aggregate = originals.aggregate; Review.countDocuments = originals.countDocuments;
  Review.findOneAndUpdate = originals.findOneAndUpdate; Review.exists = originals.exists;
  Doctor.findByIdAndUpdate = originals.doctorUpdate; AdminActivityLog.create = originals.logCreate;
  notificationEmitter.emitToUser = originals.emit;
};
const OID = (n) => `64b000000000000000000${String(n).padStart(3, "0")}`;

try {
  // ── A-15: rating + sentiment ────────────────────────────────────────────────────────────────────────────────────
  assert.strictEqual(combineRatingFilter({ rating: "5", sentiment: "positive" }), 5);
  assert.deepStrictEqual(combineRatingFilter({ rating: "3", sentiment: "positive" }), { $in: [] }, "contradiction matches nothing");
  assert.strictEqual(combineRatingFilter({ rating: "1", sentiment: "negative" }), 1);
  assert.deepStrictEqual(combineRatingFilter({ rating: "4", sentiment: "negative" }), { $in: [] });
  assert.deepStrictEqual(combineRatingFilter({ sentiment: "positive" }), { $gte: 4 });
  assert.deepStrictEqual(combineRatingFilter({ sentiment: "negative" }), { $lte: 2 });
  assert.strictEqual(combineRatingFilter({ rating: "2" }), 2);
  assert.strictEqual(combineRatingFilter({}), undefined);
  console.log("PASS: combineRatingFilter intersects explicit rating with sentiment bounds");

  const fixture = [1, 2, 3, 4, 4, 5, 5].map((rating, i) => ({ _id: OID(i), rating, createdAt: i, adminDeleted: false }));
  let seen;
  Review.find = (filter) => { seen = filter; return fakeQuery(fixture, filter); };
  Review.countDocuments = async (filter) => fixture.filter((d) => matches(d, filter)).length;
  const list = await callHandler(listReviewsAdmin, { query: { rating: "5", sentiment: "positive" } });
  assert.ifError(list.error);
  assert.deepStrictEqual(list.res.body.data.reviews.map((r) => r.rating), [5, 5], "rating=5&sentiment=positive returns only 5-star rows");
  assert.strictEqual(seen.rating, 5);
  const list2 = await callHandler(listReviewsAdmin, { query: { sentiment: "positive" } });
  assert.deepStrictEqual(list2.res.body.data.reviews.map((r) => r.rating).sort(), [4, 4, 5, 5]);
  const list3 = await callHandler(listReviewsAdmin, { query: { rating: "3", sentiment: "positive" } });
  assert.deepStrictEqual(list3.res.body.data.reviews, []);
  for (const query of [{ search: ["a", "b"] }, { rating: ["1", "2"] }, { sentiment: ["positive", "negative"] }, { doctorId: ["x", "y"] }]) {
    assert.strictEqual((await callHandler(listReviewsAdmin, { query })).error?.statusCode, 400, JSON.stringify(query));
  }
  console.log("PASS: list endpoint honours rating + sentiment together; repeated keys are 400");

  // list sort has a deterministic tiebreaker
  const rec = {};
  Review.find = (filter) => fakeQuery(fixture, filter, rec);
  await callHandler(listReviewsAdmin, { query: {} });
  assert.deepStrictEqual(rec.sort, { createdAt: -1, _id: -1 });
  console.log("PASS: review list sorts by createdAt then _id");

  // ── A-03a: summary through aggregation ───────────────────────────────────────────────────────────────────────────
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const replies = [undefined, null, { message: "" }, { message: "ok" }];
  const many = Array.from({ length: 257 }, (_, i) => ({
    _id: OID(i), rating: 1 + Math.floor(rnd() * 5), doctorReply: replies[Math.floor(rnd() * 4)], isPinned: rnd() < 0.3,
  }));
  // totals computed by plain loops, independently of buildReviewSummary
  let ratingSum = 0, negativeCount = 0, unrepliedCount = 0, pinnedCount = 0;
  for (const r of many) { ratingSum += r.rating; if (r.rating <= 2) negativeCount++; if (!(r.doctorReply && r.doctorReply.message)) unrepliedCount++; if (r.isPinned) pinnedCount++; }
  let pipelineSeen;
  Review.aggregate = async (pipeline) => { pipelineSeen = pipeline; return [{ _id: null, totalReviews: many.length, ratingSum, negativeCount, unrepliedCount, pinnedCount }]; };
  Review.find = () => { throw new Error("getReviewSummaryAdmin must not load documents"); };
  const summaryCall = await callHandler(getReviewSummaryAdmin, {});
  assert.ifError(summaryCall.error);
  assert.deepStrictEqual(summaryCall.res.body.data, buildReviewSummary(many));
  assert.deepStrictEqual(pipelineSeen, buildReviewSummaryPipeline());
  assert.deepStrictEqual(pipelineSeen[0], { $match: { adminDeleted: { $ne: true } } });
  Review.aggregate = async () => [];
  const emptyCall = await callHandler(getReviewSummaryAdmin, {});
  assert.deepStrictEqual(emptyCall.res.body.data, buildReviewSummary([]));
  assert.strictEqual(emptyCall.res.body.data.averageRating, null);
  assert.strictEqual(buildReviewSummaryFromTotals({ totalReviews: 3, ratingSum: 10, unrepliedCount: 1, negativeCount: 0, pinnedCount: 0 }).averageRating, 3.3);
  console.log("PASS: summary via aggregation equals the in-memory summary (incl. empty and rounding)");

  // ── A-03d: attention queue is not limited to the newest 500 ───────────────────────────────────────────────────────
  const person = (id, name) => ({ _id: id, name });
  const docs = [];
  for (let i = 1; i <= 700; i++) {
    docs.push({ _id: OID(i), rating: 5, doctorReply: { message: "thanks" }, isPinned: false, adminDeleted: false, createdAt: 1000 + i, userId: person("p", "Pat"), doctorId: { _id: "d1", userId: person("u", "Dr One") } });
  }
  docs.push({ _id: OID(900), rating: 1, doctorReply: null, isPinned: false, adminDeleted: false, createdAt: 1, userId: person("p", "Old Patient"), doctorId: { _id: "d1", userId: person("u", "Dr One") } }); // oldest, critical
  docs.push({ _id: OID(901), rating: 1, doctorReply: { message: "x" }, isPinned: false, adminDeleted: true, createdAt: 2, userId: person("p", "Gone"), doctorId: { _id: "d1", userId: person("u", "Dr One") } }); // deleted: excluded
  const calls = [];
  Review.find = (filter) => { const record = {}; calls.push(record); return fakeQuery(docs, filter, record); };
  const queue = await callHandler(getReviewAttentionQueueAdmin, {});
  assert.ifError(queue.error);
  assert.strictEqual(queue.res.body.data.items.length, 1, "only the old critical review needs attention");
  assert.strictEqual(queue.res.body.data.items[0].severity, "critical");
  assert.strictEqual(queue.res.body.data.items[0].patientName, "Old Patient");
  assert.strictEqual(queue.res.body.data.items[0].doctorName, "Dr One");
  assert.strictEqual(queue.res.body.data.hasMore, false);
  assert(calls.length === 3 && calls.every((c) => c.limit === 26), "three bounded queries, none unbounded and none capped at 500");
  assert(calls.every((c) => c.sort._id === -1 && c.sort.createdAt === -1), "deterministic newest-first order");
  console.log("PASS: attention queue finds a critical review older than 700 newer reviews, bounded to 26 rows per severity");

  // severity ordering, 25-item page and hasMore
  const mixed = [];
  for (let i = 0; i < 30; i++) mixed.push({ _id: OID(i), rating: 4, doctorReply: null, isPinned: false, adminDeleted: false, createdAt: i });      // warning (unreplied)
  for (let i = 30; i < 33; i++) mixed.push({ _id: OID(i), rating: 2, doctorReply: { message: "" }, isPinned: false, adminDeleted: false, createdAt: i }); // critical
  mixed.push({ _id: OID(40), rating: 5, doctorReply: { message: "t" }, isPinned: true, adminDeleted: false, createdAt: 50 });                        // info
  Review.find = (filter) => fakeQuery(mixed, filter, {});
  const page = await callHandler(getReviewAttentionQueueAdmin, {});
  const items = page.res.body.data.items;
  assert.strictEqual(items.length, 25);
  assert.deepStrictEqual(items.slice(0, 3).map((i) => i.severity), ["critical", "critical", "critical"]);
  assert(items.slice(3).every((i) => i.severity === "warning"));
  assert.strictEqual(page.res.body.data.hasMore, true);
  const warningOrder = items.slice(3).map((i) => String(i.reviewId));
  assert.deepStrictEqual(warningOrder, mixed.filter((r) => r.rating === 4).sort((a, b) => b.createdAt - a.createdAt).slice(0, 22).map((r) => r._id), "warnings are newest-first");
  console.log("PASS: attention page is severity-ordered, newest-first within a severity, capped at 25 with hasMore");

  // bucket filters partition exactly the items computeReviewAttentionItems would emit
  const variety = [];
  for (const rating of [1, 2, 3, 4, 5]) for (const reply of [undefined, null, { message: "" }, { message: "hi" }]) for (const isPinned of [false, true]) {
    variety.push({ _id: `v${rating}${variety.length}`, rating, doctorReply: reply, isPinned, adminDeleted: false });
  }
  const expected = computeReviewAttentionItems(variety);
  for (const sev of ["critical", "warning", "info"]) {
    const got = fakeQuery(variety, ATTENTION_BUCKET_FILTERS[sev]);
    const ids = (await got).map((r) => r._id).sort();
    assert.deepStrictEqual(ids, expected.filter((i) => i.severity === sev).map((i) => i.reviewId).sort(), `${sev} bucket matches computeReviewAttentionItems`);
  }
  console.log("PASS: DB bucket filters equal computeReviewAttentionItems severities on a full rating/reply/pin matrix");

  // ── A-16: atomic delete ─────────────────────────────────────────────────────────────────────────────────────────
  const state = { review: { _id: OID(1), doctorId: OID(7), userId: OID(8), rating: 1, adminDeleted: false } };
  let audits = 0, notifications = 0, recalcs = 0, failRecalc = false;
  Review.findOneAndUpdate = async (filter, update) => {
    await new Promise((r) => setTimeout(r, 1)); // yield so both callers interleave
    if (String(filter._id) !== state.review._id) return null;
    if (filter.adminDeleted?.$ne === true && state.review.adminDeleted === true) return null; // atomic compare-and-set
    Object.assign(state.review, update.$set);
    return { ...state.review };
  };
  Review.exists = async (filter) => (String(filter._id) === state.review._id ? { _id: state.review._id } : null);
  Review.find = () => { recalcs++; if (failRecalc) throw new Error("db down"); return { lean: async () => [{ rating: 5 }] }; };
  Doctor.findByIdAndUpdate = async () => ({});
  AdminActivityLog.create = async () => { audits++; return {}; };
  notificationEmitter.emitToUser = async () => { notifications++; };

  const [first, second] = await Promise.all([
    callHandler(deleteReview, { params: { id: OID(1) } }),
    callHandler(deleteReview, { params: { id: OID(1) } }),
  ]);
  const outcomes = [first, second];
  assert.strictEqual(outcomes.filter((o) => !o.error && o.res.statusCode === 200).length, 1, "exactly one delete succeeds");
  assert.strictEqual(outcomes.filter((o) => o.error?.statusCode === 409).length, 1, "the other gets 409");
  assert.strictEqual(audits, 1, "one audit entry");
  assert.strictEqual(notifications, 1);
  assert.strictEqual(recalcs, 1);
  console.log("PASS: concurrent double delete yields one success, one 409, one audit entry, one recalculation");

  assert.strictEqual((await callHandler(deleteReview, { params: { id: OID(2) } })).error.statusCode, 404);
  assert.strictEqual((await callHandler(deleteReview, { params: { id: "not-an-id" } })).error.statusCode, 400);
  console.log("PASS: unknown review -> 404, malformed id -> 400");

  // recalculation failure after the claim: still audited, still 200 (retry would only 409), flagged in the payload
  state.review = { _id: OID(1), doctorId: OID(7), userId: OID(8), rating: 1, adminDeleted: false };
  audits = 0; failRecalc = true;
  const failed = await callHandler(deleteReview, { params: { id: OID(1) } });
  assert.ifError(failed.error);
  assert.strictEqual(failed.res.statusCode, 200);
  assert.strictEqual(failed.res.body.data.ratingRecalculated, false);
  assert.strictEqual(audits, 1, "audit entry written even though recalculation failed");
  console.log("PASS: recalculation failure after deletion is audited and reported, not a 500");
} finally {
  restore();
}

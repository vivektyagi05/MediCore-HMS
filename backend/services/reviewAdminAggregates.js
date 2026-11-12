// PHASE UI-8 — Reviews Management Workspace (admin side).
//
// Single source of truth for the two pure, DB-independent calculations the
// admin Reviews workspace needs: the deterministic attention engine and the
// KPI summary. Kept dependency-free (plain objects in, plain objects out) so
// they can be regression-tested with plain `assert`, same pattern as
// reviewRatingService.js's computeAverageRating.
//
// Deliberately NOT duplicated here: doctor-level rating math stays on
// reviewRatingService.computeAverageRating (imported below, not reimplemented),
// and full doctor reputation intelligence stays on
// publicController.buildDoctorReputationIntelligence — the Review Workspace's
// Reputation tab calls the existing GET /admin/doctors/:id endpoint for that,
// it is never recalculated here.
import { computeAverageRating } from "./reviewRatingService.js";

// Real, documented, non-fabricated review-level attention rule:
//   NEGATIVE (rating <= 2) + UNREPLIED  -> critical (highest operational priority)
//   NEGATIVE only                       -> warning
//   UNREPLIED only (rating >= 3)        -> warning, lower priority than a
//                                           negative+unreplied review
//   PINNED (and not already flagged)    -> info, informational priority only
// No emotion/abuse/fraud/urgency is inferred — only what the schema itself
// records (rating, doctorReply presence, isPinned).
export function computeReviewAttentionItems(reviews) {
  const items = [];

  for (const review of reviews) {
    const isNegative = review.rating <= 2;
    const isUnreplied = !review.doctorReply?.message;
    const isPinned = Boolean(review.isPinned);

    if (isNegative && isUnreplied) {
      items.push({
        reviewId: review._id,
        title: "Negative review awaiting a reply",
        reason: `Rated ${review.rating}/5 and has had no doctor response.`,
        severity: "critical",
        source: "rating <= 2 AND doctorReply missing",
        recommendedAction: "Prompt the doctor to respond, or review for a possible service issue.",
      });
    } else if (isNegative) {
      items.push({
        reviewId: review._id,
        title: "Negative review",
        reason: `Rated ${review.rating}/5.`,
        severity: "warning",
        source: "rating <= 2",
        recommendedAction: "Monitor for a pattern with this doctor.",
      });
    } else if (isUnreplied) {
      items.push({
        reviewId: review._id,
        title: "Review awaiting a reply",
        reason: `Rated ${review.rating}/5, no doctor response yet.`,
        severity: "warning",
        source: "doctorReply missing",
        recommendedAction: "Encourage the doctor to close the loop with the patient.",
      });
    } else if (isPinned) {
      items.push({
        reviewId: review._id,
        title: "Pinned review",
        reason: "Marked by the doctor as a reference review.",
        severity: "info",
        source: "isPinned",
        recommendedAction: "Informational — no action required.",
      });
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

// Real, non-fabricated platform-wide KPI strip. Returns null for any metric
// that is not meaningfully computable from zero reviews, rather than a
// misleading 0 or 0% — the frontend renders those as "N/A".
export function buildReviewSummary(reviews) {
  const totalReviews = reviews.length;

  if (!totalReviews) {
    return {
      totalReviews: 0,
      averageRating: null,
      negativeCount: 0,
      unrepliedCount: 0,
      pinnedCount: 0,
      responseRate: null,
    };
  }

  const negativeCount = reviews.filter((r) => r.rating <= 2).length;
  const unrepliedReviews = reviews.filter((r) => !r.doctorReply?.message);
  const pinnedCount = reviews.filter((r) => r.isPinned).length;
  const responseRate = Number((((totalReviews - unrepliedReviews.length) / totalReviews) * 100).toFixed(1));

  return {
    totalReviews,
    averageRating: computeAverageRating(reviews),
    negativeCount,
    unrepliedCount: unrepliedReviews.length,
    pinnedCount,
    responseRate,
  };
}

// ── Database-side equivalents (S3: A-03a / A-03d / A-15) ───────────────────────────────────────────────────────────
// The pure functions above stay the reference definition of the rules. The pieces below express the same rules as
// Mongo filters/pipelines so the admin endpoints no longer load every review into memory. Equivalence with the pure
// functions is asserted in tests/reviewAdminDbSide.test.mjs.
//
// "Unreplied" mirrors `!review.doctorReply?.message`: the message is missing, null or an empty string.
export const NOT_DELETED_FILTER = { adminDeleted: { $ne: true } };
export const REPLIED_FILTER = { "doctorReply.message": { $nin: [null, ""] } };
export const UNREPLIED_FILTER = { "doctorReply.message": { $in: [null, ""] } };

const UNREPLIED_EXPR = { $eq: [{ $strLenCP: { $ifNull: ["$doctorReply.message", ""] } }, 0] };
const NEGATIVE_EXPR = { $lte: ["$rating", 2] };

// Attention buckets, one per severity of computeReviewAttentionItems' if/else-if chain (they are mutually exclusive):
//   critical: rating <= 2 AND unreplied
//   warning : (rating <= 2 AND replied) OR (rating > 2 AND unreplied)
//   info    : rating > 2 AND replied AND pinned
export const ATTENTION_BUCKET_FILTERS = {
  critical: { rating: { $lte: 2 }, ...UNREPLIED_FILTER },
  warning: {
    $or: [
      { rating: { $lte: 2 }, ...REPLIED_FILTER },
      { rating: { $gt: 2 }, ...UNREPLIED_FILTER },
    ],
  },
  info: { rating: { $gt: 2 }, ...REPLIED_FILTER, isPinned: true },
};

export const ATTENTION_QUEUE_SIZE = 25;

// Pure: turns per-severity review lists (each fetched newest-first with a limit of size + 1) into the page of items
// plus an honest `hasMore` flag, reusing computeReviewAttentionItems for titles/reasons/severity.
export function buildAttentionQueue({ critical = [], warning = [], info = [] }, size = ATTENTION_QUEUE_SIZE) {
  const reviews = [...critical, ...warning, ...info];
  const items = computeReviewAttentionItems(reviews);
  return { items: items.slice(0, size), hasMore: items.length > size, reviews };
}

// One-row KPI aggregation; fold it with buildReviewSummaryFromTotals().
export function buildReviewSummaryPipeline() {
  return [
    { $match: NOT_DELETED_FILTER },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        ratingSum: { $sum: "$rating" },
        negativeCount: { $sum: { $cond: [NEGATIVE_EXPR, 1, 0] } },
        unrepliedCount: { $sum: { $cond: [UNREPLIED_EXPR, 1, 0] } },
        pinnedCount: { $sum: { $cond: [{ $eq: ["$isPinned", true] }, 1, 0] } },
      },
    },
  ];
}

// Pure: same output as buildReviewSummary(reviews), including the null-for-empty rule and the same rounding.
export function buildReviewSummaryFromTotals(totals) {
  const totalReviews = totals?.totalReviews || 0;
  if (!totalReviews) {
    return { totalReviews: 0, averageRating: null, negativeCount: 0, unrepliedCount: 0, pinnedCount: 0, responseRate: null };
  }
  const unrepliedCount = totals.unrepliedCount || 0;
  return {
    totalReviews,
    averageRating: Number((totals.ratingSum / totalReviews).toFixed(1)),
    negativeCount: totals.negativeCount || 0,
    unrepliedCount,
    pinnedCount: totals.pinnedCount || 0,
    responseRate: Number((((totalReviews - unrepliedCount) / totalReviews) * 100).toFixed(1)),
  };
}

// Per-doctor critical/warning counts for the command-center reputation card, computed in the database. Mirrors
// groupReviewAttentionByDoctor(): info items are ignored, reviews whose doctor no longer exists are dropped, ordering is
// criticalCount desc then warningCount desc (plus doctorId as a deterministic tiebreaker), name falls back to
// "Unknown doctor" in the caller.
export function buildDoctorAttentionPipeline({ limit = 10, doctorCollection, userCollection }) {
  return [
    { $match: { ...NOT_DELETED_FILTER, $or: [{ rating: { $lte: 2 } }, UNREPLIED_FILTER] } },
    {
      $group: {
        _id: "$doctorId",
        flaggedCount: { $sum: 1 },
        criticalCount: { $sum: { $cond: [{ $and: [NEGATIVE_EXPR, UNREPLIED_EXPR] }, 1, 0] } },
      },
    },
    { $project: { criticalCount: 1, warningCount: { $subtract: ["$flaggedCount", "$criticalCount"] } } },
    {
      // let/pipeline form (works on every supported MongoDB version, same style as doctorAdminController).
      $lookup: {
        from: doctorCollection,
        let: { doctorId: "$_id" },
        pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$doctorId"] } } }, { $project: { userId: 1 } }],
        as: "doctor",
      },
    },
    { $unwind: "$doctor" },
    { $sort: { criticalCount: -1, warningCount: -1, _id: 1 } },
    { $limit: limit },
    {
      $lookup: {
        from: userCollection,
        let: { userId: "$doctor.userId" },
        pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$userId"] } } }, { $project: { name: 1 } }],
        as: "doctorUser",
      },
    },
    {
      $project: {
        _id: 0,
        doctorId: "$_id",
        doctorName: { $ifNull: [{ $arrayElemAt: ["$doctorUser.name", 0] }, "Unknown doctor"] },
        criticalCount: 1,
        warningCount: 1,
      },
    },
  ];
}

// Combines the list filters' rating constraints (exact rating and sentiment bounds) into one Mongo condition.
// Returns undefined when neither is set, and an impossible condition when they contradict (rating=3&sentiment=positive).
export function combineRatingFilter({ rating, sentiment }) {
  const exact = rating !== undefined ? Number(rating) : undefined;
  const bounds = sentiment === "positive" ? { $gte: 4 } : sentiment === "negative" ? { $lte: 2 } : null;
  if (exact === undefined) return bounds || undefined;
  if (!bounds) return exact;
  const ok = bounds.$gte !== undefined ? exact >= bounds.$gte : exact <= bounds.$lte;
  return ok ? exact : { $in: [] };
}

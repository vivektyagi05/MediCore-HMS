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

import Doctor from "../../models/Doctor.js";
import Review from "../../models/Review.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { computeAverageRating } from "../../services/reviewRatingService.js";
import { computeReviewAttentionItems } from "../../services/reviewAdminAggregates.js";
import { filterReviews, resolveFocusPage } from "../../services/doctorReviewFiltering.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";
import { logger } from "../../utils/logger.js";
import { notificationEmitter } from "../../realtime/notificationEmitter.js";

// SHARED, single-query review intelligence builder — reused by getDoctorReviews
// (Review Intelligence Center) and the Business Overview aggregate, so
// both surfaces read the exact same real numbers off one Review.find() call
// instead of two independent queries that could drift.
//
// PHASE DOC-05 — this now also produces the Attention Workspace queue and a
// filtered/paginated `reviews` list. Deliberately reuses the admin side's
// computeReviewAttentionItems() (reviewAdminAggregates.js) rather than
// inventing a second attention engine — the same rating<=2/unreplied/pinned
// rule a doctor sees on this page is the identical rule an admin sees on
// theirs. All stats (rating/counts/monthlyTrend) and the attention queue are
// always computed from the FULL doctor-scoped review set, never from the
// current filtered/paginated page — this is what the Doctor Dashboard's
// Attention Center and "Unread Reviews" metric read, so it must never be
// skewed by whatever filter/page the Review Workspace happens to be on.
//
// One doctor's own reviews are a naturally bounded set (unlike the
// platform-wide admin registry, which needs true DB-level pagination), so a
// single find() for the full set is fine here; only the returned `reviews`
// list is sliced to a page.
export async function buildDoctorReviewIntelligence(doctorId, queryOptions = {}) {
  const { page, limit, search, rating, attention, focusReviewId } = queryOptions;

  const reviews = await Review.find({
    doctorId,
    adminDeleted: { $ne: true },
  })
    .populate("userId", "name")
    .populate("appointmentId", "date timeSlot")
    .sort({ createdAt: -1 })
    .lean();

  const averageRating = computeAverageRating(reviews);
  const negativeReviews = reviews.filter((r) => r.rating <= 2);
  const unrepliedReviews = reviews.filter((r) => !r.doctorReply?.message);
  const pinnedReviews = reviews.filter((r) => r.isPinned);
  const responseRate = reviews.length
    ? Number((((reviews.length - unrepliedReviews.length) / reviews.length) * 100).toFixed(1))
    : 0;

  // Monthly review trend (last 6 calendar months) — same month-bucketing
  // shape used elsewhere in the app (see getDoctorReputation), so the
  // Review Intelligence Center's trend chart and the Reputation Center's
  // trend chart can never disagree with each other.
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const monthlyMap = reviews
    .filter((r) => new Date(r.createdAt) >= sixMonthsAgo)
    .reduce((acc, r) => {
      const key = monthKey(new Date(r.createdAt));
      if (!acc[key]) acc[key] = { count: 0, ratingSum: 0 };
      acc[key].count += 1;
      acc[key].ratingSum += r.rating;
      return acc;
    }, {});
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const bucket = monthlyMap[key];
    monthlyTrend.push({
      label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      count: bucket?.count || 0,
      avgRating: bucket ? Number((bucket.ratingSum / bucket.count).toFixed(1)) : 0,
    });
  }

  // Real month-over-month direction — only shown once there are at least two
  // populated months to compare, never fabricated for a brand-new doctor.
  const populatedMonths = monthlyTrend.filter((m) => m.count > 0);
  let ratingTrendDirection = null;
  if (populatedMonths.length >= 2) {
    const [prev, latest] = populatedMonths.slice(-2);
    const delta = Number((latest.avgRating - prev.avgRating).toFixed(1));
    ratingTrendDirection = { delta, from: prev.avgRating, to: latest.avgRating };
  }

  // Attention Workspace queue — top real items only, richest-context first.
  // Same severity rule as the admin side (rating<=2+unreplied > negative >
  // unreplied > pinned), enriched here with the patient name/appointment
  // date this endpoint already has populated.
  const attentionItems = computeReviewAttentionItems(reviews)
    .slice(0, 8)
    .map((item) => {
      const review = reviews.find((r) => String(r._id) === String(item.reviewId));
      return {
        ...item,
        patientName: review?.userId?.name || "A patient",
        appointmentDate: review?.appointmentId?.date || null,
      };
    });

  // Filtered + paginated list for the review registry itself. Pure logic
  // lives in doctorReviewFiltering.js (regression-tested without a DB) —
  // not reimplemented inline here.
  //
  // A deep link (from Smart Inbox / dashboard) must resolve regardless of
  // whatever filter/page the doctor last left the page on — so when a
  // target review is named, filters are ignored and the page is derived
  // from the review's real position in the full sorted set instead.
  const focusPage = resolveFocusPage(reviews, focusReviewId, page, limit);
  const filtered = focusReviewId ? reviews : filterReviews(reviews, { search, rating, attention });
  const effectivePage = focusPage || page;

  const total = filtered.length;
  const { page: safePage, pageSize, skip } = clampPagination(effectivePage, limit, { total });
  const pagedReviews = filtered.slice(skip, skip + pageSize);

  return {
    reviews: pagedReviews,
    pagination: buildPaginationMeta(safePage, pageSize, total),
    attentionItems,
    ratingTrendDirection,
    averageRating: Number(averageRating),
    totalReviews: reviews.length,
    negativeCount: negativeReviews.length,
    unrepliedCount: unrepliedReviews.length,
    pinnedCount: pinnedReviews.length,
    responseRate,
    monthlyTrend,
  };
}

export const getDoctorReviews = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id });

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  const intelligence = await buildDoctorReviewIntelligence(doctor._id, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    rating: req.query.rating,
    attention: req.query.attention,
    focusReviewId: req.query.focusReviewId,
  });

  res.status(200).json({
    success: true,
    data: intelligence,
    message: "Reviews fetched successfully",
  });
});

export const replyToReview = asyncHandler(async (req, res) => {
  if (!req.body.message?.trim()) {
    throw new AppError("Reply message is required", 400);
  }

  const review = await Review.findById(req.params.id);

  if (!review) {
    throw new AppError("Review not found", 404);
  }

  if (review.adminDeleted) {
    throw new AppError("This review has been removed", 404);
  }

  const doctor = await Doctor.findOne({ userId: req.user._id });

  if (!doctor || review.doctorId.toString() !== doctor._id.toString()) {
    throw new AppError(
      "You can only reply to reviews for your own profile",
      403,
    );
  }

  if (review.doctorReply?.message) {
    throw new AppError(
      "You have already replied to this review. Edit is not permitted.",
      409,
    );
  }

  review.doctorReply = {
    message: req.body.message.trim(),
    repliedAt: new Date(),
  };

  await review.save();

  // Notify the patient that the doctor replied.
  // BUGFIX (PHASE DOC-05 audit): this was mis-typed "appointment" even
  // though entityType already correctly said "review" — same category of
  // bug the enum's Phase DOC-02 comment already documents having fixed at
  // two other producers (patientWorkflowController, financeController).
  // This third producer was missed; "review" has been a valid
  // NotificationDelivery type since Phase DOC-02, so this is a pure fix,
  // not a schema change.
  try {
    await notificationEmitter.emitToUser(review.userId, {
      type: "review",
      title: "Doctor replied to your review",
      message: `Dr. replied: "${req.body.message.trim().slice(0, 80)}${req.body.message.length > 80 ? "…" : ""}"`,
      entityType: "review",
      entityId: review._id,
      severity: "info",
      eventKey: `review:${review._id}:reply`,
    });
  } catch (error) {
    logger.warn("Review-reply notification failed", { message: error?.message, reviewId: review._id });
  }

  res.status(200).json({
    success: true,
    data: { review },
    message: "Reply saved successfully",
  });
});

// Review Intelligence Center: pin/unpin a review for quick reference. Doctor
// can only pin reviews on their own profile — same ownership check pattern
// as replyToReview.
export const togglePinReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    throw new AppError("Review not found", 404);
  }

  if (review.adminDeleted) {
    throw new AppError("This review has been removed", 404);
  }

  const doctor = await Doctor.findOne({ userId: req.user._id });

  if (!doctor || review.doctorId.toString() !== doctor._id.toString()) {
    throw new AppError("You can only pin reviews on your own profile", 403);
  }

  review.isPinned = !review.isPinned;
  await review.save();

  res.status(200).json({
    success: true,
    data: { review },
    message: review.isPinned ? "Review pinned" : "Review unpinned",
  });
});

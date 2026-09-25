// PHASE UI-8 — Reviews Management Workspace (admin side).
//
// Additive rewrite of the admin Reviews surface. Deliberately does NOT
// duplicate anything that already exists:
//  - doctor rating math stays on reviewRatingService.js (computeAverageRating /
//    recalculateAndPersistDoctorRating) — reused as-is, not reimplemented.
//  - reply / pin / unpin stay exactly where they already are, on the doctor's
//    own ownership-gated endpoints (doctorReviewController.js) — this admin
//    surface is read + moderate (soft-delete) only, and never fabricates an
//    admin "reply" or "pin" action the backend cannot actually perform.
//  - full doctor reputation intelligence is never recalculated here — the
//    Review Workspace's Reputation tab calls the existing
//    GET /admin/doctors/:id endpoint (doctorAdminController.getDoctorDetailAdmin),
//    which already composes buildDoctorReputationIntelligence().
//  - AI review sentiment stays on the existing GET /api/ai/admin/review-sentiment
//    (generativeAssistant.reviewSentiment), which already accepts an optional
//    doctorId — no second AI pipeline is introduced.
//  - attention-queue and KPI math are pure functions imported from
//    reviewAdminAggregates.js so they can be regression-tested without a DB
//    and can never drift between the summary and attention-queue endpoints.
import { containsRegex } from "../../utils/regexSafe.js";
import mongoose from "mongoose";
import Review from "../../models/Review.js";
import User from "../../models/User.js";
import Doctor from "../../models/Doctor.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { notificationEmitter } from "../../realtime/notificationEmitter.js";
import { logger } from "../../utils/logger.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { recalculateAndPersistDoctorRating } from "../../services/reviewRatingService.js";
import { computeReviewAttentionItems, buildReviewSummary } from "../../services/reviewAdminAggregates.js";

const NOT_DELETED = { adminDeleted: { $ne: true } };

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

// Resolves a free-text search term against real patient/doctor names before
// filtering reviews, so the query stays server-side and index-backed rather
// than downloading the full review collection to filter in memory. Same
// pattern as appointmentAdminController.resolveSearchFilter.
const resolveSearchFilter = async (term) => {
  const regex = containsRegex(term);
  const [matchingPatients, matchingDoctorUsers] = await Promise.all([
    User.find({ role: "patient", $or: [{ name: regex }, { email: regex }] }).select("_id").lean(),
    User.find({ role: "doctor", name: regex }).select("_id").lean(),
  ]);
  const doctorUserIds = matchingDoctorUsers.map((u) => u._id);
  const matchingDoctors = doctorUserIds.length
    ? await Doctor.find({ userId: { $in: doctorUserIds } }).select("_id").lean()
    : [];

  return {
    $or: [
      { userId: { $in: matchingPatients.map((p) => p._id) } },
      { doctorId: { $in: matchingDoctors.map((d) => d._id) } },
    ],
  };
};

// Only filters that can genuinely be backed by real database fields — no
// fabricated "sentiment" or "urgency" filter beyond what the schema stores.
const buildListFilter = async (query) => {
  const filter = { ...NOT_DELETED };

  if (query.doctorId && mongoose.Types.ObjectId.isValid(query.doctorId)) {
    filter.doctorId = query.doctorId;
  }
  if (query.rating && ["1", "2", "3", "4", "5"].includes(String(query.rating))) {
    filter.rating = Number(query.rating);
  }
  if (query.sentiment === "positive") {
    filter.rating = { ...(filter.rating || {}), $gte: 4 };
  } else if (query.sentiment === "negative") {
    filter.rating = { ...(filter.rating || {}), $lte: 2 };
  }
  if (query.replied === "true") {
    filter["doctorReply.message"] = { $exists: true, $ne: "" };
  } else if (query.replied === "false") {
    filter.$or = (filter.$or || []).concat([
      { "doctorReply.message": { $exists: false } },
      { "doctorReply.message": "" },
    ]);
  }
  if (query.pinned === "true") {
    filter.isPinned = true;
  } else if (query.pinned === "false") {
    filter.isPinned = { $ne: true };
  }

  const conditions = [filter];
  if (query.search && query.search.trim()) {
    conditions.push(await resolveSearchFilter(query.search.trim()));
  }

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

export const listReviewsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = await buildListFilter(req.query);

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate("userId", "name email")
      .populate({
        path: "doctorId",
        select: "specialization userId",
        populate: { path: "userId", select: "name" },
      })
      .populate("appointmentId", "date timeSlot")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
    message: "Reviews fetched successfully",
  });
});

// Real, platform-wide KPI strip — traced straight from the same non-deleted
// review set the registry itself reads, through buildReviewSummary() (which
// returns null rather than a fabricated 0%/0 for metrics that aren't
// meaningfully computable with zero reviews).
export const getReviewSummaryAdmin = asyncHandler(async (_req, res) => {
  const reviews = await Review.find(NOT_DELETED).select("rating doctorReply isPinned").lean();
  const summary = buildReviewSummary(reviews);

  res.status(200).json({
    success: true,
    data: summary,
    message: "Review summary fetched successfully",
  });
});

// Deterministic attention queue — same source data as the summary above, run
// through computeReviewAttentionItems(). Capped to a reasonable page size for
// the UI; this is a queue to act on, not a second full registry.
export const getReviewAttentionQueueAdmin = asyncHandler(async (_req, res) => {
  const reviews = await Review.find(NOT_DELETED)
    .select("rating doctorReply isPinned userId doctorId createdAt")
    .populate("userId", "name")
    .populate({ path: "doctorId", select: "userId", populate: { path: "userId", select: "name" } })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const items = computeReviewAttentionItems(reviews)
    .slice(0, 25)
    .map((item) => {
      const review = reviews.find((r) => String(r._id) === String(item.reviewId));
      return {
        ...item,
        patientName: review?.userId?.name || "Unknown patient",
        doctorName: review?.doctorId?.userId?.name || "Unknown doctor",
      };
    });

  res.status(200).json({
    success: true,
    data: { items },
    message: "Review attention queue fetched successfully",
  });
});

// Review Workspace aggregate — the review itself, plus real doctor/patient/
// appointment context and a timeline built ONLY from real stored timestamps
// (createdAt, editHistory[].editedAt, doctorReply.repliedAt, adminDeletedAt).
// isPinned has no stored transition timestamp anywhere in the schema, so the
// timeline shows current pin state as a fact, never a fabricated "pinned at"
// event.
export const getReviewDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid review id", 400);

  const review = await Review.findById(req.params.id)
    .populate("userId", "name email")
    .populate({
      path: "doctorId",
      select: "specialization consultationMode userId",
      populate: { path: "userId", select: "name email" },
    })
    .populate("appointmentId", "date timeSlot consultationMode status")
    .lean();

  if (!review) throw new AppError("Review not found", 404);

  const timeline = [{ key: "created", label: "Review submitted", at: review.createdAt }];
  for (const entry of review.editHistory || []) {
    timeline.push({ key: `edit-${entry._id}`, label: "Review edited by patient", at: entry.editedAt });
  }
  if (review.doctorReply?.message) {
    timeline.push({ key: "reply", label: "Doctor replied", at: review.doctorReply.repliedAt });
  }
  if (review.adminDeleted) {
    timeline.push({ key: "deleted", label: "Removed by admin", at: review.adminDeletedAt });
  }
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  res.status(200).json({
    success: true,
    data: {
      review,
      timeline,
      pinTimestampAvailable: false,
    },
    message: "Review detail fetched successfully",
  });
});

export const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    throw new AppError("Review not found", 404);
  }

  if (review.adminDeleted) {
    throw new AppError("Review has already been deleted", 409);
  }

  // Soft delete — preserve audit trail
  review.adminDeleted = true;
  review.adminDeletedAt = new Date();
  review.adminDeletedBy = req.user._id;
  await review.save();

  // Recalculate doctor rating after deletion
  await recalculateAndPersistDoctorRating(review.doctorId);

  // BUGFIX (PHASE UI-8 audit): this state-changing admin action previously
  // wrote no AdminActivityLog entry at all, unlike every other admin
  // mutation in the app (approve/cancel appointment, refund actions,
  // service/CMS/settings changes, etc). Added additively — no new log
  // system, same writeAdminLog() every other controller already uses.
  try {
    await writeAdminLog({
      req,
      action: "review.admin_deleted",
      resourceType: "Review",
      resourceId: review._id,
      severity: "warning",
      metadata: { doctorId: review.doctorId, userId: review.userId, rating: review.rating },
    });
  } catch (error) {
    logger.warn("Review-deleted audit log failed", { message: error?.message, reviewId: review._id });
  }

  // Notify the patient whose review was removed.
  // BUGFIX (PHASE DOC-05 audit): same mis-typed-notification category
  // already fixed at other producers per the NotificationDelivery enum's
  // Phase DOC-02 comment — this one was missed. "review" is an existing
  // valid type; this is a pure fix, not a schema change.
  try {
    await notificationEmitter.emitToUser(review.userId, {
      type: "review",
      title: "Review removed",
      message: "Your review has been removed by an administrator.",
      entityType: "review",
      entityId: review._id,
      severity: "warning",
      eventKey: `review:${review._id}:admin-deleted`,
    });
  } catch (error) {
    logger.warn("Review-deleted notification failed", { message: error?.message, reviewId: review._id });
  }

  res.status(200).json({
    success: true,
    data: { reviewId: review._id },
    message: "Review deleted successfully",
  });
});

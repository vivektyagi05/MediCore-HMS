import Doctor from "../models/Doctor.js";
import Review from "../models/Review.js";

// SINGLE SOURCE OF TRUTH for doctor rating math. Previously this average was
// calculated independently in three places (patient review submission, admin
// review deletion, doctor review listing) — all three now call this instead,
// so a future change (e.g. a minimum-review-count threshold, or weighting
// recent reviews more) only has to happen once and can never drift between
// what a doctor sees, what a patient sees, and what the public profile shows.

export const computeAverageRating = (reviews) => {
  if (!reviews.length) return 0;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return Number((total / reviews.length).toFixed(1));
};

// Recomputes and persists Doctor.rating from all non-deleted reviews for that
// doctor. Call this after any create/update/delete that changes a review.
export const recalculateAndPersistDoctorRating = async (doctorId) => {
  const reviews = await Review.find({ doctorId, adminDeleted: { $ne: true } }).lean();
  const averageRating = computeAverageRating(reviews);
  await Doctor.findByIdAndUpdate(doctorId, { rating: averageRating });
  return { averageRating, totalReviews: reviews.length };
};

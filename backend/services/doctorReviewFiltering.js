// PHASE DOC-05 — Reviews & Reputation Workspace (doctor side).
//
// Pure, dependency-free logic for the review registry's search/rating/
// attention filter and its interaction with a deep-linked target review.
// Extracted out of doctorReviewController.js so it can be regression-tested
// with plain assert (no Mongo/DB needed) — same pattern as
// reviewAdminAggregates.js and operationsQueuePagination.js.
//
// Only filters that can genuinely be backed by real schema fields are
// supported here — no fabricated "sentiment"/"urgency" filter.
import { clampPagination } from "../utils/paginationValidation.js";

/** Apply search/rating/attention filters to an already-fetched review list. */
export function filterReviews(reviews, { search, rating, attention } = {}) {
  let filtered = reviews;

  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        (r.userId?.name || "").toLowerCase().includes(term) ||
        (r.comment || "").toLowerCase().includes(term),
    );
  }

  if (rating && ["1", "2", "3", "4", "5"].includes(String(rating))) {
    filtered = filtered.filter((r) => r.rating === Number(rating));
  }

  if (attention === "unreplied") {
    filtered = filtered.filter((r) => !r.doctorReply?.message);
  } else if (attention === "pinned") {
    filtered = filtered.filter((r) => r.isPinned);
  } else if (attention === "negative") {
    filtered = filtered.filter((r) => r.rating <= 2);
  }

  return filtered;
}

/**
 * Given the FULL, already-sorted (newest-first) review list and a target
 * review id, return the real page that review lives on — so a deep link
 * (Smart Inbox, dashboard attention item, this page's own Attention
 * Workspace) resolves to the correct page regardless of the requested
 * page/limit or whatever filter was previously active. Returns null if the
 * review isn't found (e.g. it belongs to another doctor, or was removed) —
 * callers should fall back to the requested page unchanged in that case.
 */
export function resolveFocusPage(reviews, focusReviewId, rawPage, rawLimit) {
  if (!focusReviewId) return null;
  const idx = reviews.findIndex((r) => String(r._id) === String(focusReviewId));
  if (idx < 0) return null;
  const { pageSize } = clampPagination(rawPage, rawLimit);
  return Math.floor(idx / pageSize) + 1;
}

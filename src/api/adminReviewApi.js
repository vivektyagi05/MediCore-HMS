import apiClient from "./axios";

// Reviews Management Workspace (Phase UI-8). Reply/pin/unpin intentionally
// stay off this surface — those remain doctor-only, ownership-gated actions
// on the existing doctor review endpoints (doctorApi.replyReview /
// doctorApi.pinReview). This is the admin-only read surface (registry,
// summary, attention queue, workspace detail) plus the one real admin
// action, soft-delete/moderation.
export const adminReviewApi = {
  getReviews(params = {}) {
    return apiClient.get("/admin/reviews", { params }).then((res) => res.data);
  },
  getReviewSummary() {
    return apiClient.get("/admin/reviews/summary").then((res) => res.data);
  },
  getReviewAttentionQueue() {
    return apiClient.get("/admin/reviews/attention-queue").then((res) => res.data);
  },
  getReviewDetail(id) {
    return apiClient.get(`/admin/reviews/${id}`).then((res) => res.data);
  },
  deleteReview(id) {
    return apiClient.delete(`/admin/reviews/${id}`).then((res) => res.data);
  },
};

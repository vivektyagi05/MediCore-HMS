import apiClient from "./axios";

export const refundApi = {
  initiateRefund(paymentId, payload) {
    return apiClient.post(`/refunds/${paymentId}`, payload).then((res) => res.data);
  },
  createRequest(paymentId, payload) {
    return apiClient.post(`/refunds/requests/${paymentId}`, payload).then((res) => res.data);
  },
  getRequests(params = {}) {
    return apiClient.get("/refunds", { params }).then((res) => res.data);
  },
  approveRequest(id, payload = {}) {
    return apiClient.patch(`/refunds/requests/${id}/approve`, payload).then((res) => res.data);
  },
  rejectRequest(id, payload = {}) {
    return apiClient.patch(`/refunds/requests/${id}/reject`, payload).then((res) => res.data);
  },
  retryRequest(id) {
    return apiClient.patch(`/refunds/requests/${id}/retry`, {}).then((res) => res.data);
  },
  // P23 Section 10/12 — the authoritative eligibility read that drives
  // Case A/B/C/D branching. Frontend never re-derives this itself.
  getEligibility(paymentId) {
    return apiClient.get(`/refunds/eligibility/${paymentId}`).then((res) => res.data);
  },
  // P23 Section 14/16 — refund tracker detail (funding split + safe-labeled timeline).
  getDetail(id) {
    return apiClient.get(`/refunds/requests/${id}/detail`).then((res) => res.data);
  },
  // P23 Section 11 — Case B / D entry point, separate from createRequest.
  reportProblem(paymentId, payload) {
    return apiClient.post(`/refunds/report-problem/${paymentId}`, payload).then((res) => res.data);
  },
};

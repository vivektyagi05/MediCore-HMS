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
};

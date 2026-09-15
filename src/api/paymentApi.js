import apiClient from "./axios";

export const paymentApi = {
  createOrder(payload) {
    return apiClient.post("/payments/orders", payload).then((res) => res.data);
  },
  verifyPayment(payload) {
    return apiClient.post("/payments/verify", payload).then((res) => res.data);
  },
  completeTestPayment(razorpayOrderId) {
    return apiClient.post("/payments/test/complete", { razorpayOrderId }).then((res) => res.data);
  },
  getPayments(params = {}) {
    return apiClient.get("/payments", { params }).then((res) => res.data);
  },
  getSummary() {
    return apiClient.get("/payments/summary").then((res) => res.data);
  },
  getAnalytics() {
    return apiClient.get("/payments/analytics").then((res) => res.data);
  },
  getRefundRequests(params = {}) {
    return apiClient
      .get("/refunds", { params })
      .then((res) => res.data);
  },

  approveRefund(id, payload = {}) {
    return apiClient
      .patch(
        `/refunds/requests/${id}/approve`,
        payload
      )
      .then((res) => res.data);
  },

  rejectRefund(id, payload = {}) {
    return apiClient
      .patch(
        `/refunds/requests/${id}/reject`,
        payload
      )
      .then((res) => res.data);
  },

  // P23 Section 5/6 — recovery + retry, both scoped to the caller's own
  // payment/appointment by the backend.
  getStatus(appointmentId) {
    return apiClient.get(`/payments/status/${appointmentId}`).then((res) => res.data);
  },
  retry(paymentId) {
    return apiClient.post(`/payments/${paymentId}/retry`).then((res) => res.data);
  },
};

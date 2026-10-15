import apiClient from "./axios";

export const paymentApi = {
  createOrder(payload) {
    return apiClient.post("/payments/orders", payload).then((res) => res.data);
  },
  verifyPayment(payload) {
    // Gateways hand back snake_case (razorpay_*); the verify contract is
    // camelCase. Map explicitly so no gateway object is forwarded raw and
    // client-supplied amount/currency never travel to the server.
    const body = {
      razorpayOrderId: payload.razorpayOrderId ?? payload.razorpay_order_id,
      paymentId: payload.paymentId ?? payload.razorpay_payment_id,
      signature: payload.signature ?? payload.razorpay_signature,
    };
    return apiClient.post("/payments/verify", body).then((res) => res.data);
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

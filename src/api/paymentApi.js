import apiClient from "./axios";

export const paymentApi = {
  createOrder(payload) {
    return apiClient.post("/payments/orders", payload).then((res) => res.data);
  },
  verifyPayment(payload) {
    return apiClient.post("/payments/verify", payload).then((res) => res.data);
  },
  getPayments(params = {}) {
    return apiClient.get("/payments", { params }).then((res) => res.data);
  },
  getSummary() {
    return apiClient.get("/payments/summary").then((res) => res.data);
  },
};

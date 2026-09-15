import apiClient from "./axios";

export const withdrawalApi = {
  getBalance() {
    return apiClient.get("/doctor/withdrawals/balance").then((res) => res.data);
  },
  request(payload) {
    return apiClient.post("/doctor/withdrawals", payload).then((res) => res.data);
  },
  getMine(params = {}) {
    return apiClient.get("/doctor/withdrawals", { params }).then((res) => res.data);
  },
  getDetail(id) {
    return apiClient.get(`/doctor/withdrawals/${id}`).then((res) => res.data);
  },
};

export const withdrawalAdminApi = {
  list(params = {}) {
    return apiClient.get("/admin/withdrawals", { params }).then((res) => res.data);
  },
  getDetail(id) {
    return apiClient.get(`/admin/withdrawals/${id}`).then((res) => res.data);
  },
  markProcessing(id, payload = {}) {
    return apiClient.patch(`/admin/withdrawals/${id}/processing`, payload).then((res) => res.data);
  },
  complete(id, payload = {}) {
    return apiClient.patch(`/admin/withdrawals/${id}/complete`, payload).then((res) => res.data);
  },
  fail(id, payload = {}) {
    return apiClient.patch(`/admin/withdrawals/${id}/fail`, payload).then((res) => res.data);
  },
  retry(id, payload = {}) {
    return apiClient.patch(`/admin/withdrawals/${id}/retry`, payload).then((res) => res.data);
  },
  cancel(id, payload = {}) {
    return apiClient.patch(`/admin/withdrawals/${id}/cancel`, payload).then((res) => res.data);
  },
};

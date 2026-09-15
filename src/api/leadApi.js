import apiClient from "./axios";

export const leadApi = {
  create(payload) { return apiClient.post("/leads", payload).then((r) => r.data); },
  list(params = {}) { return apiClient.get("/leads", { params }).then((r) => r.data); },
  get(id) { return apiClient.get(`/leads/${id}`).then((r) => r.data); },
  assign(id, assignedTo) { return apiClient.post(`/leads/${id}/assign`, { assignedTo }).then((r) => r.data); },
  priority(id, priority) { return apiClient.post(`/leads/${id}/priority`, { priority }).then((r) => r.data); },
  status(id, status) { return apiClient.post(`/leads/${id}/status`, { status }).then((r) => r.data); },
  note(id, body) { return apiClient.post(`/leads/${id}/notes`, { body }).then((r) => r.data); },
};

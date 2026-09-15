import apiClient from "./axios";

const BASE = "/admin/automation-studio";

export const automationStudioApi = {
  getHome() {
    return apiClient.get(`${BASE}/home`).then((res) => res.data);
  },
  getTriggers() {
    return apiClient.get(`${BASE}/triggers`).then((res) => res.data);
  },
  getActions() {
    return apiClient.get(`${BASE}/actions`).then((res) => res.data);
  },
  getTemplates() {
    return apiClient.get(`${BASE}/templates`).then((res) => res.data);
  },
  useTemplate(templateKey, payload = {}) {
    return apiClient.post(`${BASE}/templates/${templateKey}/use`, payload).then((res) => res.data);
  },

  listFlows(params = {}) {
    return apiClient.get(`${BASE}/flows`, { params }).then((res) => res.data);
  },
  getFlow(id) {
    return apiClient.get(`${BASE}/flows/${id}`).then((res) => res.data);
  },
  createFlow(payload) {
    return apiClient.post(`${BASE}/flows`, payload).then((res) => res.data);
  },
  updateFlow(id, payload) {
    return apiClient.put(`${BASE}/flows/${id}`, payload).then((res) => res.data);
  },
  deleteFlow(id) {
    return apiClient.delete(`${BASE}/flows/${id}`).then((res) => res.data);
  },
  publishFlow(id, changeNote) {
    return apiClient.post(`${BASE}/flows/${id}/publish`, { changeNote }).then((res) => res.data);
  },
  archiveFlow(id) {
    return apiClient.post(`${BASE}/flows/${id}/archive`).then((res) => res.data);
  },
  restoreFlow(id) {
    return apiClient.post(`${BASE}/flows/${id}/restore`).then((res) => res.data);
  },
  cloneFlow(id) {
    return apiClient.post(`${BASE}/flows/${id}/clone`).then((res) => res.data);
  },
  rollbackFlow(id, version) {
    return apiClient.post(`${BASE}/flows/${id}/rollback`, { version }).then((res) => res.data);
  },
  compareVersions(id, a, b) {
    return apiClient.get(`${BASE}/flows/${id}/compare-versions`, { params: { a, b } }).then((res) => res.data);
  },
  pinFlow(id, pinned) {
    return apiClient.post(`${BASE}/flows/${id}/pin`, { pinned }).then((res) => res.data);
  },
  favoriteFlow(id, favorite) {
    return apiClient.post(`${BASE}/flows/${id}/favorite`, { favorite }).then((res) => res.data);
  },

  simulateFlow(id, samplePayload) {
    return apiClient.post(`${BASE}/flows/${id}/simulate`, { samplePayload }).then((res) => res.data);
  },
  getRunHistory(id) {
    return apiClient.get(`${BASE}/flows/${id}/runs`).then((res) => res.data);
  },
  getInspector(id) {
    return apiClient.get(`${BASE}/flows/${id}/inspector`).then((res) => res.data);
  },
  explainFlow(id) {
    return apiClient.get(`${BASE}/flows/${id}/ai-explain`).then((res) => res.data);
  },
  advisorFlow(id) {
    return apiClient.get(`${BASE}/flows/${id}/ai-advisor`).then((res) => res.data);
  },
};

import apiClient from "./axios";

const BASE = "/admin/process-designer";

export const processDesignerApi = {
  getNodeRegistry() {
    return apiClient.get(`${BASE}/node-registry`).then((res) => res.data);
  },

  listProcesses(params = {}) {
    return apiClient.get(`${BASE}/processes`, { params }).then((res) => res.data);
  },
  getProcess(id) {
    return apiClient.get(`${BASE}/processes/${id}`).then((res) => res.data);
  },
  createProcess(payload) {
    return apiClient.post(`${BASE}/processes`, payload).then((res) => res.data);
  },
  updateProcess(id, payload) {
    return apiClient.put(`${BASE}/processes/${id}`, payload).then((res) => res.data);
  },
  deleteProcess(id) {
    return apiClient.delete(`${BASE}/processes/${id}`).then((res) => res.data);
  },
  cloneProcess(id) {
    return apiClient.post(`${BASE}/processes/${id}/clone`).then((res) => res.data);
  },

  getVersions(id) {
    return apiClient.get(`${BASE}/processes/${id}/versions`).then((res) => res.data);
  },
  compareVersions(id, withVersion) {
    return apiClient.get(`${BASE}/processes/${id}/compare-versions`, { params: { withVersion } }).then((res) => res.data);
  },

  validate(id) {
    return apiClient.post(`${BASE}/processes/${id}/validate`).then((res) => res.data);
  },
  simulate(id, payload) {
    return apiClient.post(`${BASE}/processes/${id}/simulate`, payload).then((res) => res.data);
  },
  getRunHistory(id) {
    return apiClient.get(`${BASE}/processes/${id}/runs`).then((res) => res.data);
  },
  getImpact(id) {
    return apiClient.get(`${BASE}/processes/${id}/impact`).then((res) => res.data);
  },

  publish(id, changeNote) {
    return apiClient.post(`${BASE}/processes/${id}/publish`, { changeNote }).then((res) => res.data);
  },
  activate(id) {
    return apiClient.post(`${BASE}/processes/${id}/activate`).then((res) => res.data);
  },
  pause(id) {
    return apiClient.post(`${BASE}/processes/${id}/pause`).then((res) => res.data);
  },
  archive(id) {
    return apiClient.post(`${BASE}/processes/${id}/archive`).then((res) => res.data);
  },

  explain(id) {
    return apiClient.get(`${BASE}/processes/${id}/ai-explain`).then((res) => res.data);
  },
  explainSimulation(id) {
    return apiClient.get(`${BASE}/processes/${id}/ai-simulation-explain`).then((res) => res.data);
  },
};

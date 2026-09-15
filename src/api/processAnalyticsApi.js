import apiClient from "./axios";

const BASE = "/admin/process-analytics";

export const processAnalyticsApi = {
  getOverview(params = {}) {
    return apiClient.get(`${BASE}/overview`, { params }).then((res) => res.data);
  },
  getCrossProcess(params = {}) {
    return apiClient.get(`${BASE}/cross-process`, { params }).then((res) => res.data);
  },
  listProcesses() {
    return apiClient.get(`${BASE}/processes`).then((res) => res.data);
  },

  getPerformance(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/performance`, { params }).then((res) => res.data);
  },
  getHealth(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/health`, { params }).then((res) => res.data);
  },
  getTrend(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/trend`, { params }).then((res) => res.data);
  },
  getBottlenecks(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/bottlenecks`, { params }).then((res) => res.data);
  },
  getFailures(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/failures`, { params }).then((res) => res.data);
  },
  getSla(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/sla`, { params }).then((res) => res.data);
  },
  setSlaTarget(key, payload) {
    return apiClient.put(`${BASE}/processes/${key}/sla-target`, payload).then((res) => res.data);
  },
  getVersions(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/versions`, { params }).then((res) => res.data);
  },
  compareVersions(key, versionA, versionB) {
    return apiClient.get(`${BASE}/processes/${key}/version-comparison`, { params: { versionA, versionB } }).then((res) => res.data);
  },

  listRecommendations(params = {}) {
    return apiClient.get(`${BASE}/recommendations`, { params }).then((res) => res.data);
  },
  runDetection(payload = {}) {
    return apiClient.post(`${BASE}/recommendations/detect`, payload).then((res) => res.data);
  },
  reviewRecommendation(id) {
    return apiClient.post(`${BASE}/recommendations/${id}/review`).then((res) => res.data);
  },
  proposeVersion(id, payload = {}) {
    return apiClient.post(`${BASE}/recommendations/${id}/propose-version`, payload).then((res) => res.data);
  },
  simulateProposal(id) {
    return apiClient.post(`${BASE}/recommendations/${id}/simulate`).then((res) => res.data);
  },
  decideRecommendation(id, decision, note) {
    return apiClient.post(`${BASE}/recommendations/${id}/decide`, { decision, note }).then((res) => res.data);
  },
  markImplemented(id) {
    return apiClient.post(`${BASE}/recommendations/${id}/mark-implemented`).then((res) => res.data);
  },

  explainAnalytics(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/ai-explain`, { params }).then((res) => res.data);
  },
  explainBottlenecks(key, params = {}) {
    return apiClient.get(`${BASE}/processes/${key}/ai-bottleneck-explain`, { params }).then((res) => res.data);
  },
  explainOptimization(key) {
    return apiClient.get(`${BASE}/processes/${key}/ai-optimization-advisor`).then((res) => res.data);
  },
  explainVersionComparison(key, versionA, versionB) {
    return apiClient.get(`${BASE}/processes/${key}/ai-version-comparison-explain`, { params: { versionA, versionB } }).then((res) => res.data);
  },
};

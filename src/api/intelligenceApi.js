import apiClient from "./axios";

const BASE = "/admin/intelligence";

export const intelligenceApi = {
  getOverview() {
    return apiClient.get(`${BASE}/overview`).then((res) => res.data);
  },
  getOverviewAiSummary() {
    return apiClient.get(`${BASE}/overview/ai-summary`).then((res) => res.data);
  },
  getRegistry() {
    return apiClient.get(`${BASE}/registry`).then((res) => res.data);
  },

  getPredictions() {
    return apiClient.get(`${BASE}/predictions`).then((res) => res.data);
  },
  explainPrediction(predictionId) {
    return apiClient.get(`${BASE}/predictions/${predictionId}/ai-explain`).then((res) => res.data);
  },

  getAnomalies() {
    return apiClient.get(`${BASE}/anomalies`).then((res) => res.data);
  },
  explainAnomaly(anomalyId) {
    return apiClient.get(`${BASE}/anomalies/${anomalyId}/ai-explain`).then((res) => res.data);
  },

  getCapacityForecast() {
    return apiClient.get(`${BASE}/capacity-forecast`).then((res) => res.data);
  },
  getCapacityAiAdvisor() {
    return apiClient.get(`${BASE}/capacity-forecast/ai-advisor`).then((res) => res.data);
  },

  getOptimization() {
    return apiClient.get(`${BASE}/optimization`).then((res) => res.data);
  },
  getOptimizationAiAdvisor() {
    return apiClient.get(`${BASE}/optimization/ai-advisor`).then((res) => res.data);
  },

  getAllowedHealingActions() {
    return apiClient.get(`${BASE}/healing-actions/allowed`).then((res) => res.data);
  },
  getHealingQueue(status) {
    return apiClient.get(`${BASE}/healing-actions/queue`, { params: status ? { status } : {} }).then((res) => res.data);
  },
  getHealingAiAdvisor() {
    return apiClient.get(`${BASE}/healing-actions/ai-advisor`).then((res) => res.data);
  },
  queueHealingAction(payload) {
    return apiClient.post(`${BASE}/healing-actions/queue`, payload).then((res) => res.data);
  },
  approveHealingAction(actionLogId) {
    return apiClient.post(`${BASE}/healing-actions/${actionLogId}/approve`).then((res) => res.data);
  },
  rejectHealingAction(actionLogId, reason) {
    return apiClient.post(`${BASE}/healing-actions/${actionLogId}/reject`, { reason }).then((res) => res.data);
  },
};

import apiClient from "./axios";

const BASE = "/admin/monitoring";

export const monitoringApi = {
  getOverview(params = {}) {
    return apiClient.get(`${BASE}/overview`, { params }).then((res) => res.data);
  },
  getOverviewAiSummary() {
    return apiClient.get(`${BASE}/overview/ai-summary`).then((res) => res.data);
  },

  listExecutions(params = {}) {
    return apiClient.get(`${BASE}/executions`, { params }).then((res) => res.data);
  },
  getExecutionDetail(id, source = "flow") {
    return apiClient.get(`${BASE}/executions/${id}`, { params: { source } }).then((res) => res.data);
  },
  explainExecution(id, source = "flow") {
    return apiClient.get(`${BASE}/executions/${id}/ai-explain`, { params: { source } }).then((res) => res.data);
  },

  getFlowHealth() {
    return apiClient.get(`${BASE}/flow-health`).then((res) => res.data);
  },
  getCronHealth() {
    return apiClient.get(`${BASE}/cron-health`).then((res) => res.data);
  },

  getPerformance(params = {}) {
    return apiClient.get(`${BASE}/performance`, { params }).then((res) => res.data);
  },
  getPerformanceAiAdvisor(params = {}) {
    return apiClient.get(`${BASE}/performance/ai-advisor`, { params }).then((res) => res.data);
  },

  getFailures(params = {}) {
    return apiClient.get(`${BASE}/failures`, { params }).then((res) => res.data);
  },
  getFailuresAiExplain(params = {}) {
    return apiClient.get(`${BASE}/failures/ai-explain`, { params }).then((res) => res.data);
  },

  getDependencyFanout() {
    return apiClient.get(`${BASE}/dependency-fanout`).then((res) => res.data);
  },

  getRetryQueue() {
    return apiClient.get(`${BASE}/retry-queue`).then((res) => res.data);
  },
  getRetryQueueAiAdvisor() {
    return apiClient.get(`${BASE}/retry-queue/ai-advisor`).then((res) => res.data);
  },
  resolveDeadLetterPayment(paymentId) {
    return apiClient.post(`${BASE}/retry-queue/${paymentId}/resolve`).then((res) => res.data);
  },
};

import apiClient from "./axios";

const BASE = "/admin/process";

export const processApi = {
  // PHASE UI-13 — composed Process/Automation/Governance Command Center.
  getCommandCenter() {
    return apiClient.get(`${BASE}/command-center`).then((res) => res.data);
  },
  getRegistry() {
    return apiClient.get(`${BASE}/registry`).then((res) => res.data);
  },
  getProcess(processId) {
    return apiClient.get(`${BASE}/registry/${processId}`).then((res) => res.data);
  },
  explainProcess(processId) {
    return apiClient.get(`${BASE}/registry/${processId}/ai-explain`).then((res) => res.data);
  },

  getOrchestrationRules() {
    return apiClient.get(`${BASE}/orchestration/rules`).then((res) => res.data);
  },
  getOrchestrationAiAdvisor(processId) {
    return apiClient.get(`${BASE}/orchestration/ai-advisor`, { params: { processId } }).then((res) => res.data);
  },
  getOrchestrationPlan(processId) {
    return apiClient.get(`${BASE}/orchestration/${processId}/plan`).then((res) => res.data);
  },

  getDependencyGraph() {
    return apiClient.get(`${BASE}/graphs/dependency`).then((res) => res.data);
  },
  getApprovalGraph() {
    return apiClient.get(`${BASE}/graphs/approval`).then((res) => res.data);
  },
  getAutomationGraph() {
    return apiClient.get(`${BASE}/graphs/automation`).then((res) => res.data);
  },
  getFailureGraph() {
    return apiClient.get(`${BASE}/graphs/failure`).then((res) => res.data);
  },
  getExecutionGraph(processId) {
    return apiClient.get(`${BASE}/graphs/execution/${processId}`).then((res) => res.data);
  },

  getImpact(processId) {
    return apiClient.get(`${BASE}/impact/${processId}`).then((res) => res.data);
  },
  explainImpact(processId, sourceId) {
    return apiClient.get(`${BASE}/impact/${processId}/ai-explain`, { params: sourceId ? { sourceId } : {} }).then((res) => res.data);
  },

  getEventRegistry() {
    return apiClient.get(`${BASE}/events/registry`).then((res) => res.data);
  },
  getFailedEvents(lookbackDays) {
    return apiClient.get(`${BASE}/events/failed`, { params: lookbackDays ? { lookbackDays } : {} }).then((res) => res.data);
  },
  getTrace(sourceId) {
    return apiClient.get(`${BASE}/events/trace/${sourceId}`).then((res) => res.data);
  },
};

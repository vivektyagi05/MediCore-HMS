import apiClient from "./axios";

const BASE = "/admin/integrations";

export const integrationHubApi = {
  getEdges() {
    return apiClient.get(`${BASE}/edges`).then((res) => res.data);
  },
  getHealth() {
    return apiClient.get(`${BASE}/health`).then((res) => res.data);
  },
  getConnectedDisconnected() {
    return apiClient.get(`${BASE}/connected-disconnected`).then((res) => res.data);
  },
  getLiveTraffic() {
    return apiClient.get(`${BASE}/live-traffic`).then((res) => res.data);
  },
  getDeadEvents(lookbackDays) {
    return apiClient.get(`${BASE}/dead-events`, { params: lookbackDays ? { lookbackDays } : {} }).then((res) => res.data);
  },
  explainEdge(edgeId) {
    return apiClient.get(`${BASE}/edges/${encodeURIComponent(edgeId)}/ai-explain`).then((res) => res.data);
  },
};

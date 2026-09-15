import apiClient from "./axios";

export const privacyApi = {
  getPublicConfig() {
    return apiClient.get("/privacy/public-config", { cacheTtlMs: 30_000 }).then((res) => res.data);
  },
  getPreferences() {
    return apiClient.get("/privacy/preferences", { dedupe: false }).then((res) => res.data);
  },
  updatePreferences(payload) {
    return apiClient.put("/privacy/preferences", payload).then((res) => res.data);
  },
  createRequest(payload) {
    return apiClient.post("/privacy/requests", payload).then((res) => res.data);
  },
  getRequests() {
    return apiClient.get("/privacy/requests", { dedupe: false }).then((res) => res.data);
  },
  exportData() {
    return apiClient.get("/privacy/export", { responseType: "blob", dedupe: false }).then((res) => res);
  },
  submitGrievance(payload) {
    return apiClient.post("/privacy/grievance", payload).then((res) => res.data);
  },
};

import apiClient from "./axios";

export const aiApi = {
  analyzeSymptoms(payload) {
    return apiClient.post("/ai/symptoms/analyze", payload).then((res) => res.data);
  },
  recommendDoctors(params = {}) {
    return apiClient.get("/ai/doctors/recommend", { params }).then((res) => res.data);
  },
  suggestSlots(payload) {
    return apiClient.post("/ai/appointments/suggest-slots", payload).then((res) => res.data);
  },
  smartSearch(params = {}) {
    return apiClient.get("/ai/search", { params }).then((res) => res.data);
  },
  chatbot(payload) {
    return apiClient.post("/ai/chatbot", payload).then((res) => res.data);
  },
  getInsights(params = {}) {
    return apiClient.get("/ai/insights", { params }).then((res) => res.data);
  },
  generateInsights() {
    return apiClient.post("/ai/insights/generate").then((res) => res.data);
  },
  getPredictions() {
    return apiClient.get("/ai/predictions").then((res) => res.data);
  },
  getScheduleOptimization() {
    return apiClient.get("/ai/schedule/optimization").then((res) => res.data);
  },
  runAutomation() {
    return apiClient.post("/ai/automation/run").then((res) => res.data);
  },
  getReminders(params = {}) {
    return apiClient.get("/ai/automation/reminders", { params }).then((res) => res.data);
  },
  getReviews() {
  return apiClient
    .get("/doctors/reviews")
    .then(
      (res) => res.data
    );
},
};

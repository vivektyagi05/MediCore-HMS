import apiClient from "./axios";

export const practiceApi = {
  getOverview() {
    return apiClient.get("/doctor/practice/overview").then((res) => res.data);
  },
  getProfileIntelligence() {
    return apiClient.get("/doctor/practice/profile-intelligence").then((res) => res.data);
  },
  getProfessionalProfile() {
    return apiClient.get("/doctor/practice/professional-profile").then((res) => res.data);
  },
  updateProfessionalProfile(payload) {
    return apiClient.patch("/doctor/practice/professional-profile", payload).then((res) => res.data);
  },
  uploadProfilePhoto(file) {
    const formData = new FormData();
    formData.append("photo", file);
    return apiClient.post("/doctor/practice/profile-photo", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      dedupe: false,
    }).then((res) => res.data);
  },
  deleteProfilePhoto() {
    return apiClient.delete("/doctor/practice/profile-photo").then((res) => res.data);
  },
  getVerificationCenter() {
    return apiClient.get("/doctor/practice/verification").then((res) => res.data);
  },
  getSubscriptionIntelligence() {
    return apiClient.get("/doctor/practice/subscription").then((res) => res.data);
  },
  changePlan(subscriptionId, planCode) {
    return apiClient.patch(`/doctor/practice/subscription/${subscriptionId}/change-plan`, { planCode }).then((res) => res.data);
  },
  updatePracticeSettings(payload) {
    return apiClient.patch("/doctor/practice/settings", payload).then((res) => res.data);
  },
  getPracticeAnalytics() {
    return apiClient.get("/doctor/practice/analytics").then((res) => res.data);
  },
};

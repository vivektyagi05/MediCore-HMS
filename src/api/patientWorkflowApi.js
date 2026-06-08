import apiClient from "./axios";

export const patientWorkflowApi = {
  getReports(params = {}) {
    return apiClient.get("/patient/reports", { params }).then((res) => res.data);
  },
  uploadReport(formData) {
    return apiClient.post("/patient/reports", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  downloadReport(id) {
    return apiClient.get(`/patient/reports/${id}/download`, { responseType: "blob" }).then((res) => res.data);
  },
  getPrescriptions(params = {}) {
    return apiClient.get("/patient/prescriptions", { params }).then((res) => res.data);
  },
  downloadPrescription(id) {
    return apiClient.get(`/patient/prescriptions/${id}/download`, { responseType: "blob" }).then((res) => res.data);
  },
  getFamily() {
    return apiClient.get("/patient/family").then((res) => res.data);
  },
  createFamily(payload) {
    return apiClient.post("/patient/family", payload).then((res) => res.data);
  },
  getInsurance() {
    return apiClient.get("/patient/insurance").then((res) => res.data);
  },
  createInsurance(formData) {
    return apiClient.post("/patient/insurance", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  getReviews() {
    return apiClient.get("/patient/reviews").then((res) => res.data);
  },
  saveReview(payload) {
    return apiClient.post("/patient/reviews", payload).then((res) => res.data);
  },
  getSavedDoctors() {
    return apiClient.get("/patient/saved-doctors").then((res) => res.data);
  },
  saveDoctor(payload) {
    return apiClient.post("/patient/saved-doctors", payload).then((res) => res.data);
  },
  removeSavedDoctor(doctorId) {
    return apiClient.delete(`/patient/saved-doctors/${doctorId}`).then((res) => res.data);
  },
  getProfileCompletion() {
    return apiClient.get("/patient/profile-completion").then((res) => res.data);
  },
  updateProfile(payload) {
    return apiClient.put("/patient/profile", payload).then((res) => res.data);
  },
  getTimeline(params = {}) {
    return apiClient.get("/patient/timeline", { params }).then((res) => res.data);
  },
  getNotifications() {
    return apiClient.get("/patient/notifications").then((res) => res.data);
  },
  exportData(params = {}) {
    return apiClient.get("/patient/exports", { params, responseType: "blob" }).then((res) => res.data);
  },
};

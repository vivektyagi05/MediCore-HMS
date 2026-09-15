import apiClient from "./axios";

export const patientWorkflowApi = {
  getEcosystemOverview() {
    return apiClient.get("/patient/health-ecosystem/overview").then((res) => res.data);
  },
  getReports(params = {}) {
    return apiClient.get("/patient/reports", { params }).then((res) => res.data);
  },
  getReportCategories() {
    return apiClient.get("/patient/reports/categories").then((res) => res.data);
  },
  uploadReport(formData) {
    return apiClient.post("/patient/reports", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  updateReport(id, payload) {
    return apiClient.patch(`/patient/reports/${id}`, payload).then((res) => res.data);
  },
  deleteReport(id) {
    return apiClient.delete(`/patient/reports/${id}`).then((res) => res.data);
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
  getCertificates(params = {}) {
    return apiClient.get("/patient/certificates", { params }).then((res) => res.data);
  },
  downloadCertificate(id) {
    return apiClient.get(`/patient/certificates/${id}/download`, { responseType: "blob" }).then((res) => res.data);
  },
  getFamily() {
    return apiClient.get("/patient/family").then((res) => res.data);
  },
  createFamily(payload) {
    return apiClient.post("/patient/family", payload).then((res) => res.data);
  },
  updateFamily(id, payload) {
    return apiClient.put(`/patient/family/${id}`, payload).then((res) => res.data);
  },
  removeFamily(id) {
    return apiClient.delete(`/patient/family/${id}`).then((res) => res.data);
  },
  getFamilyWorkspace(id) {
    return apiClient.get(`/patient/family/${id}/workspace`).then((res) => res.data);
  },
  getInsurance(params = {}) {
    return apiClient.get("/patient/insurance", { params }).then((res) => res.data);
  },
  createInsurance(formData) {
    return apiClient.post("/patient/insurance", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  updateInsurance(id, formData) {
    return apiClient.patch(`/patient/insurance/${id}`, formData, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  deleteInsurance(id) {
    return apiClient.delete(`/patient/insurance/${id}`).then((res) => res.data);
  },
  submitInsuranceClaim(id, payload) {
    return apiClient.post(`/patient/insurance/${id}/claim`, payload).then((res) => res.data);
  },
  getInsuranceUtilization(id) {
    return apiClient.get(`/patient/insurance/${id}/utilization`).then((res) => res.data);
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
  updateSavedDoctor(doctorId, payload) {
    return apiClient.patch(`/patient/saved-doctors/${doctorId}`, payload).then((res) => res.data);
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
  getHealthProfile() {
    return apiClient.get("/patient/health-profile").then((res) => res.data);
  },
  getHealthJourney(params = {}) {
    return apiClient.get("/patient/health-journey", { params }).then((res) => res.data);
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

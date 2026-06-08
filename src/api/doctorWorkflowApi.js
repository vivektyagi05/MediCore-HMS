import apiClient from "./axios";

export const doctorWorkflowApi = {
  getPrescriptions(params = {}) {
    return apiClient.get("/doctor/prescriptions", { params }).then((res) => res.data);
  },
  createPrescription(payload) {
    return apiClient.post("/doctor/prescriptions", payload).then((res) => res.data);
  },
  downloadPrescription(id) {
    return apiClient.get(`/doctor/prescriptions/${id}/download`, { responseType: "blob" }).then((res) => res.data);
  },
  getNotes(params = {}) {
    return apiClient.get("/doctor/notes", { params }).then((res) => res.data);
  },
  createNote(payload) {
    return apiClient.post("/doctor/notes", payload).then((res) => res.data);
  },
  getHistory(params = {}) {
    return apiClient.get("/doctor/history", { params }).then((res) => res.data);
  },
  getSchedule() {
    return apiClient.get("/doctor/schedule").then((res) => res.data);
  },
  updateSchedule(payload) {
    return apiClient.put("/doctor/schedule", payload).then((res) => res.data);
  },
  getLeaves(params = {}) {
    return apiClient.get("/doctor/leaves", { params }).then((res) => res.data);
  },
  requestLeave(payload) {
    return apiClient.post("/doctor/leaves", payload).then((res) => res.data);
  },
  getDocuments() {
    return apiClient.get("/doctor/documents").then((res) => res.data);
  },
  uploadDocument(formData) {
    return apiClient.post("/doctor/documents", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  getAnalytics() {
    return apiClient.get("/doctor/analytics").then((res) => res.data);
  },
  exportData(params = {}) {
    return apiClient.get("/doctor/exports", { params, responseType: "blob" }).then((res) => res.data);
  },
};

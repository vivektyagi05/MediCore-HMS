import apiClient from "./axios";

export const doctorWorkflowApi = {
  getPrescriptions(params = {}) {
    return apiClient.get("/doctor/prescriptions", { params }).then((res) => res.data);
  },
  createPrescription(payload) {
    return apiClient.post("/doctor/prescriptions", payload).then((res) => res.data);
  },
  checkPrescriptionSafety(payload) {
    return apiClient.post("/doctor/prescriptions/check", payload).then((res) => res.data);
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
  getScheduleDay(date) {
    return apiClient.get("/doctor/schedule/day", { params: { date } }).then((res) => res.data);
  },
  // Phase DOC-07 final pass — Week/Month view intelligence.
  getScheduleRange(startDate, endDate) {
    return apiClient.get("/doctor/schedule/range", { params: { startDate, endDate } }).then((res) => res.data);
  },
  // Phase DOC-07 final pass — Follow-up → Real Scheduling.
  scheduleFollowUp(patientId, payload) {
    return apiClient.post(`/doctor/patients/${patientId}/schedule-follow-up`, payload).then((res) => res.data);
  },
  updateSchedule(payload) {
    return apiClient.put("/doctor/schedule", payload).then((res) => res.data);
  },
  getScheduleTemplates() {
    return apiClient.get("/doctor/schedule/templates").then((res) => res.data);
  },
  saveScheduleTemplate(payload) {
    return apiClient.post("/doctor/schedule/templates", payload).then((res) => res.data);
  },
  deleteScheduleTemplate(id) {
    return apiClient.delete(`/doctor/schedule/templates/${id}`).then((res) => res.data);
  },
  applyScheduleTemplate(id) {
    return apiClient.post(`/doctor/schedule/templates/${id}/apply`).then((res) => res.data);
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
  deleteDocument(id) {
    return apiClient.delete(`/doctor/documents/${id}`).then((res) => res.data);
  },
  // Authenticated-blob pattern (same as downloadCertificate/downloadPrescription
  // below). Previously there was no way at all for a doctor to view a document
  // they had uploaded -- the backend never served it and returned only a raw
  // server filesystem path in the JSON list, which the UI never used for
  // anything.
  downloadDocument(id) {
    return apiClient.get(`/doctor/documents/${id}/download`, { responseType: "blob" }).then((res) => res.data);
  },
  getDocumentCenterOverview() {
    return apiClient.get("/doctor/documents/overview").then((res) => res.data);
  },
  getAnalytics() {
    return apiClient.get("/doctor/analytics").then((res) => res.data);
  },
  exportData(params = {}) {
    return apiClient.get("/doctor/exports", { params, responseType: "blob" }).then((res) => res.data);
  },
  // ── Medicine Templates & Favourites ──
  getMedicineTemplates() {
    return apiClient.get("/doctor/medicine-templates").then((res) => res.data);
  },
  createMedicineTemplate(payload) {
    return apiClient.post("/doctor/medicine-templates", payload).then((res) => res.data);
  },
  deleteMedicineTemplate(id) {
    return apiClient.delete(`/doctor/medicine-templates/${id}`).then((res) => res.data);
  },
  getFavouriteMedicines() {
    return apiClient.get("/doctor/favourite-medicines").then((res) => res.data);
  },
  addFavouriteMedicine(payload) {
    return apiClient.post("/doctor/favourite-medicines", payload).then((res) => res.data);
  },
  removeFavouriteMedicine(id) {
    return apiClient.delete(`/doctor/favourite-medicines/${id}`).then((res) => res.data);
  },
  // ── Certificates ──
  getCertificates(params = {}) {
    return apiClient.get("/doctor/certificates", { params }).then((res) => res.data);
  },
  createCertificate(payload) {
    return apiClient.post("/doctor/certificates", payload).then((res) => res.data);
  },
  downloadCertificate(id) {
    return apiClient.get(`/doctor/certificates/${id}/download`, { responseType: "blob" }).then((res) => res.data);
  },
  revokeCertificate(id, payload) {
    return apiClient.put(`/doctor/certificates/${id}/revoke`, payload).then((res) => res.data);
  },
  // ── Patient Clinical Snapshot / Reports ──
  getPatientClinicalProfile(patientId) {
    return apiClient.get(`/doctor/patients/${patientId}/clinical-profile`).then((res) => res.data);
  },
  getPatientReports(patientId) {
    return apiClient.get(`/doctor/patients/${patientId}/reports`).then((res) => res.data);
  },
  downloadPatientReport(patientId, reportId) {
    return apiClient
      .get(`/doctor/patients/${patientId}/reports/${reportId}/download`, { responseType: "blob" })
      .then((res) => res.data);
  },
  // Phase P6 — Report Review
  reviewPatientReport(patientId, reportId) {
    return apiClient.patch(`/doctor/patients/${patientId}/reports/${reportId}/review`).then((res) => res.data);
  },
};


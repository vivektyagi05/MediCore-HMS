import apiClient from "./axios";

export const aiAssistApi = {
  // Doctor
  draftConsultationSummary(payload) {
    return apiClient.post("/ai/assist/consultation-summary", payload).then((res) => res.data);
  },
  draftClinicalNote(payload) {
    return apiClient.post("/ai/assist/clinical-note", payload).then((res) => res.data);
  },
  getPatientClinicalBrief(patientId) {
    return apiClient.get(`/ai/assist/patients/${patientId}/brief`).then((res) => res.data);
  },
  getClinicalCopilotAnswer(patientId, question) {
    return apiClient.post(`/ai/assist/patients/${patientId}/copilot`, { question }).then((res) => res.data);
  },
  getPrescriptionFollowUpSuggestion(prescriptionId) {
    return apiClient.get(`/ai/assist/prescriptions/${prescriptionId}/follow-up-suggestion`).then((res) => res.data);
  },
  // Phase D5: AI Consultation Assistant
  getConsultationAssistant(appointmentId) {
    return apiClient.get(`/ai/assist/appointments/${appointmentId}/consultation-assistant`).then((res) => res.data);
  },
  getPatientEducationSummary(prescriptionId) {
    return apiClient.get(`/ai/assist/prescriptions/${prescriptionId}/patient-education`).then((res) => res.data);
  },
  getScheduleOptimization() {
    return apiClient.get("/ai/assist/schedule/optimization").then((res) => res.data);
  },
  getDocumentCenterSuggestions() {
    return apiClient.get("/ai/assist/documents/suggestions").then((res) => res.data);
  },
  // Doctor Business Intelligence Platform (Phase D3)
  getDoctorReviewSummary() {
    return apiClient.get("/ai/assist/doctor/reviews/summary").then((res) => res.data);
  },
  getRevenueInsights() {
    return apiClient.get("/ai/assist/doctor/revenue/insights").then((res) => res.data);
  },
  getReputationAdvisor() {
    return apiClient.get("/ai/assist/doctor/reputation/advisor").then((res) => res.data);
  },
  getBusinessAdvisor() {
    return apiClient.get("/ai/assist/doctor/business/advisor").then((res) => res.data);
  },
  // Practice Management Platform (Phase D4)
  getProfileReview() {
    return apiClient.get("/ai/assist/doctor/practice/profile-review").then((res) => res.data);
  },
  getVerificationAdvisor() {
    return apiClient.get("/ai/assist/doctor/practice/verification-advisor").then((res) => res.data);
  },
  getSubscriptionAdvisor() {
    return apiClient.get("/ai/assist/doctor/practice/subscription-advisor").then((res) => res.data);
  },
  getGrowthAdvisor() {
    return apiClient.get("/ai/assist/doctor/practice/growth-advisor").then((res) => res.data);
  },
  getMissingFieldsAdvisor() {
    return apiClient.get("/ai/assist/doctor/practice/missing-fields-advisor").then((res) => res.data);
  },
  // Patient
  explainPrescription(prescriptionId) {
    return apiClient.post(`/ai/assist/prescriptions/${prescriptionId}/explain`).then((res) => res.data);
  },
  summarizeDocument(reportId) {
    return apiClient.post(`/ai/assist/documents/${reportId}/summarize`).then((res) => res.data);
  },
  appointmentPrep(appointmentId) {
    return apiClient.post(`/ai/assist/appointments/${appointmentId}/prep`).then((res) => res.data);
  },
  // Patient Financial Ecosystem
  explainPayment(paymentId) {
    return apiClient.post(`/ai/assist/payments/${paymentId}/explain`).then((res) => res.data);
  },
  explainInvoice(invoiceId) {
    return apiClient.post(`/ai/assist/invoices/${invoiceId}/explain`).then((res) => res.data);
  },
  explainRefund(refundRequestId) {
    return apiClient.post(`/ai/assist/refunds/${refundRequestId}/explain`).then((res) => res.data);
  },
  getExpenseSummary() {
    return apiClient.get("/ai/assist/expense-summary").then((res) => res.data);
  },
  // Patient Health Ecosystem (Records / Family / Insurance)
  getFamilyInsights() {
    return apiClient.get("/ai/assist/family/insights").then((res) => res.data);
  },
  explainInsurance(insuranceId) {
    return apiClient.post(`/ai/assist/insurance/${insuranceId}/explain`).then((res) => res.data);
  },
  getInsuranceEligibility(insuranceId) {
    return apiClient.get(`/ai/assist/insurance/${insuranceId}/eligibility`).then((res) => res.data);
  },
  // Personal Health Intelligence Platform
  getHealthProfileReview() {
    return apiClient.get("/ai/assist/health-profile/review").then((res) => res.data);
  },
  getHealthJourneySummary(params = {}) {
    return apiClient.get("/ai/assist/health-journey/summary", { params }).then((res) => res.data);
  },
  // Shared
  draftCommunication(payload) {
    return apiClient.post("/ai/assist/communications/draft", payload).then((res) => res.data);
  },
  approveDraft(draftId, payload = {}) {
    return apiClient.post(`/ai/assist/drafts/${draftId}/approve`, payload).then((res) => res.data);
  },
  listDrafts(params = {}) {
    return apiClient.get("/ai/assist/drafts", { params }).then((res) => res.data);
  },
  // Admin
  getExecutiveBrief() {
    return apiClient.get("/ai/assist/admin/brief").then((res) => res.data);
  },
  getReviewSentiment(params = {}) {
    return apiClient.get("/ai/assist/admin/review-sentiment", { params }).then((res) => res.data);
  },
  // PHASE UI-4 — Patients Management Workspace
  getPatientOperationalSummaryAdmin(patientId) {
    return apiClient.get(`/ai/assist/admin/patients/${patientId}/operational-summary`).then((res) => res.data);
  },
  // Workflow intelligence (role-aware)
  getWorkflowSuggestions() {
    return apiClient.get("/ai/assist/workflow/suggestions").then((res) => res.data);
  },
  // Smart search (natural language)
  naturalLanguageSearch(q) {
    return apiClient.get("/ai/assist/search", { params: { q } }).then((res) => res.data);
  },
};

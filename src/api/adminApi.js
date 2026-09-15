import apiClient from "./axios";

export const adminApi = {
  getServices(params = {}) {
    return apiClient.get("/admin/services", { params }).then((res) => res.data);
  },
  getService(id) { return apiClient.get(`/admin/services/${id}`).then((res) => res.data); },
  getServiceCategories() {
    return apiClient.get("/admin/services/categories").then((res) => res.data);
  },
  getServiceStats() {
    return apiClient.get("/admin/services/stats").then((res) => res.data);
  },
  createService(payload) {
    return apiClient.post("/admin/services", payload).then((res) => res.data);
  },
  updateService(id, payload) {
    return apiClient.put(`/admin/services/${id}`, payload).then((res) => res.data);
  },
  // Thin, explicit wrapper over the same PUT endpoint — a partial body
  // containing only isActive. Kept as its own method so call sites read as
  // "change status" rather than a generic update, without duplicating any
  // backend route.
  setServiceStatus(id, isActive) {
    return apiClient.put(`/admin/services/${id}`, { isActive }).then((res) => res.data);
  },
  deleteService(id) {
    return apiClient.delete(`/admin/services/${id}`).then((res) => res.data);
  },
  publishService(id) { return apiClient.post(`/admin/services/${id}/publish`).then((res) => res.data); },
  archiveService(id) { return apiClient.post(`/admin/services/${id}/archive`).then((res) => res.data); },
  // Doctor Management Workspace (Phase UI-2). Read/earnings/download only --
  // create/update/delete/approve/reject/verify-document intentionally stay
  // on doctorApi (the existing /doctors routes); this is not a duplicate
  // API surface, just the admin-only reads those routes don't cover.
  getDoctorsAdmin(params = {}) {
    return apiClient.get("/admin/doctors", { params }).then((res) => res.data);
  },
  getEligibleDoctorUsers() {
    return apiClient.get("/admin/doctors/eligible-users").then((res) => res.data);
  },
  getDoctorStatsAdmin() {
    return apiClient.get("/admin/doctors/stats").then((res) => res.data);
  },
  getDoctorDetailAdmin(id) {
    return apiClient.get(`/admin/doctors/${id}`).then((res) => res.data);
  },
  getDoctorEarningsAdmin(id) {
    return apiClient.get(`/admin/doctors/${id}/earnings`).then((res) => res.data);
  },
  // Blob download (same authenticated-blob pattern as every other real
  // download in the app — doctorWorkflowApi.downloadCertificate,
  // patientWorkflowApi.downloadReport, invoiceApi.downloadInvoice, etc).
  // Replaces the old hardcoded `http://localhost:5000/${filePath}` anchor
  // tag, which pointed at a path this server has never statically served
  // and carried no auth token.
  downloadDoctorDocument(doctorId, documentId) {
    return apiClient
      .get(`/admin/doctors/${doctorId}/documents/${documentId}/download`, { responseType: "blob" })
      .then((res) => res.data);
  },
  // Appointment Operations Workspace (Phase UI-3). Lifecycle transitions
  // (approve/reject/etc) intentionally stay on appointmentApi's
  // updateAppointmentStatus (the existing PUT /appointments/:id/status,
  // already admin-authorized) — this is only the admin-only read surface
  // plus the one genuinely-missing action (admin cancel).
  getAppointmentsAdmin(params = {}) {
    return apiClient.get("/admin/appointments", { params }).then((res) => res.data);
  },
  getAppointmentSummaryAdmin() {
    return apiClient.get("/admin/appointments/summary").then((res) => res.data);
  },
  getAppointmentDetailAdmin(id) {
    return apiClient.get(`/admin/appointments/${id}`).then((res) => res.data);
  },
  cancelAppointmentAdmin(id, reason) {
    return apiClient.patch(`/admin/appointments/${id}/cancel`, { reason }).then((res) => res.data);
  },
  // Patients Management Workspace (Phase UI-4). Edit/delete/activate stay
  // on the existing /admin/users/:id endpoints above (updateUser/
  // deleteUser/toggleUserStatus) — this is only the admin-only read
  // surface (registry, stats, workspace) plus the two genuinely-missing
  // download actions.
  getPatientsAdmin(params = {}) {
    return apiClient.get("/admin/patients", { params }).then((res) => res.data);
  },
  getPatientStatsAdmin() {
    return apiClient.get("/admin/patients/stats").then((res) => res.data);
  },
  getPatientWorkspaceAdmin(id) {
    return apiClient.get(`/admin/patients/${id}`).then((res) => res.data);
  },
  downloadPatientReportAdmin(reportId) {
    return apiClient
      .get(`/admin/patients/reports/${reportId}/download`, { responseType: "blob" })
      .then((res) => res.data);
  },
  downloadPatientPrescriptionAdmin(prescriptionId) {
    return apiClient
      .get(`/admin/patients/prescriptions/${prescriptionId}/download`, { responseType: "blob" })
      .then((res) => res.data);
  },
  // Payments Management Workspace (Phase UI-5). Order creation/verification
  // stays on paymentApi (existing /payments/orders, /payments/verify);
  // refund actions stay on refundApi (existing /refunds routes); invoice
  // download stays on invoiceApi (existing /invoices/:id/download) — this
  // is only the admin-only read surface (registry, summary, detail
  // workspace) for the connected Payments workspace.
  getPaymentsAdmin(params = {}) {
    return apiClient.get("/admin/payments", { params }).then((res) => res.data);
  },
  getPaymentSummaryAdmin() {
    return apiClient.get("/admin/payments/summary").then((res) => res.data);
  },
  getPaymentDetailAdmin(id) {
    return apiClient.get(`/admin/payments/${id}`).then((res) => res.data);
  },
  // Refunds Management Workspace (Phase UI-6). Approve/reject/retry/
  // initiate all stay on refundApi (existing /refunds routes) — this is
  // only the admin-only read surface (registry, summary, detail
  // workspace), mirroring the Payments workspace's pattern exactly.
  getRefundsAdmin(params = {}) {
    return apiClient.get("/admin/refunds", { params }).then((res) => res.data);
  },
  getRefundSummaryAdmin() {
    return apiClient.get("/admin/refunds/summary").then((res) => res.data);
  },
  getRefundDetailAdmin(id) {
    return apiClient.get(`/admin/refunds/${id}`).then((res) => res.data);
  },
  // Finance Executive Command Center (Phase UI-7). Read-only aggregate
  // surface over the existing Payment/RefundRequest/Invoice domain — no
  // payment/refund mutation lives here (that stays on paymentApi/
  // refundApi), and invoice list/download stay on invoiceApi. This is
  // only the finance-wide KPI/health/trend/breakdown/collections/
  // reconciliation/attention/timeline/AI-summary layer.
  getFinanceOverview() {
    return apiClient.get("/admin/finance/overview").then((res) => res.data);
  },
  getFinanceHealth() {
    return apiClient.get("/admin/finance/health").then((res) => res.data);
  },
  getRevenueTrend(params = {}) {
    return apiClient.get("/admin/finance/revenue-trend", { params }).then((res) => res.data);
  },
  getRevenueBreakdown() {
    return apiClient.get("/admin/finance/revenue-breakdown").then((res) => res.data);
  },
  getFinanceCollections() {
    return apiClient.get("/admin/finance/collections").then((res) => res.data);
  },
  getFinanceReconciliation() {
    return apiClient.get("/admin/finance/reconciliation").then((res) => res.data);
  },
  getFinanceAttentionQueue() {
    return apiClient.get("/admin/finance/attention-queue").then((res) => res.data);
  },
  getFinanceActivityTimeline(params = {}) {
    return apiClient.get("/admin/finance/activity-timeline", { params }).then((res) => res.data);
  },
  getFinanceExecutiveSummary() {
    return apiClient.get("/admin/finance/ai/executive-summary").then((res) => res.data);
  },
  getSettings() {
    return apiClient.get("/admin/settings").then((res) => res.data);
  },
  updateSettings(payload) {
    return apiClient.put("/admin/settings", payload).then((res) => res.data);
  },
  getPermissions() {
    return apiClient.get("/admin/permissions").then((res) => res.data);
  },
  updatePermissions(role, permissions) {
    return apiClient.put(`/admin/permissions/${role}`, { permissions }).then((res) => res.data);
  },
  getAdmins() {
    return apiClient.get("/admin/permissions/hierarchy/admins").then((res) => res.data);
  },
  updateAdminRole(id, role) {
    return apiClient.put(`/admin/permissions/hierarchy/admins/${id}`, { role }).then((res) => res.data);
  },
  getCMSPages(params = {}) {
    return apiClient.get("/admin/cms", { params }).then((res) => res.data);
  },
  getCMSPage(id) { return apiClient.get(`/admin/cms/${id}`).then((res) => res.data); },
  previewCMSPage(id, locale) { return apiClient.get(`/admin/cms/${id}/preview`, { params: { locale } }).then((res) => res.data); },
  publishCMSPage(id) { return apiClient.post(`/admin/cms/${id}/publish`).then((res) => res.data); },
  archiveCMSPage(id) { return apiClient.post(`/admin/cms/${id}/archive`).then((res) => res.data); },
  saveCMSPage(payload) {
    return apiClient.post("/admin/cms", payload).then((res) => res.data);
  },
  updateCMSPage(id, payload) {
    return apiClient.put(`/admin/cms/${id}`, payload).then((res) => res.data);
  },
  deleteCMSPage(id) {
    return apiClient.delete(`/admin/cms/${id}`).then((res) => res.data);
  },
  uploadCMSBanner(file) {
    const body = new FormData();
    body.append("image", file);
    return apiClient.post("/admin/cms/banner", body, { headers: { "Content-Type": "multipart/form-data" } }).then((res) => res.data);
  },
  getFeatures() {
    return apiClient.get("/admin/features").then((res) => res.data);
  },
  updateFeature(key, payload) {
    return apiClient.put(`/admin/features/${key}`, payload).then((res) => res.data);
  },
  getActivity(params = {}) {
    return apiClient.get("/admin/activity", { params }).then((res) => res.data);
  },
  exportData(params = {}) {
    return apiClient
      .get("/admin/exports", { params, responseType: "blob" })
      .then((res) => res.data);
  },
  getUsers(params = {}) {
    return apiClient
      .get("/admin/users", { params })
      .then((res) => res.data);
  },
  getUser(id) {
    return apiClient
    .get(`/admin/users/${id}`)
    .then((res) => res.data);
    },

    updateUser(id, payload) {
    return apiClient
    .put(
    `/admin/users/${id}`,
    payload
    )
    .then((res) => res.data);
    },

    deleteUser(id) {
    return apiClient
    .delete(
    `/admin/users/${id}`
    )
    .then((res) => res.data);
    },

    toggleUserStatus(id) {
    return apiClient
    .patch(
    `/admin/users/${id}/status`
    )
    .then((res) => res.data);
    },

  getOverview() {
    return apiClient.get("/admin/overview").then((res) => res.data);
  },
  getAnalytics(params = {}) {
    return apiClient.get("/admin/overview/analytics", { params }).then((res) => res.data);
  },

  // Phase A5.1 — Executive Dashboard + Live Platform (Mission Control)
  getExecutiveDashboard() {
    return apiClient.get("/admin/mission-control/dashboard").then((res) => res.data);
  },
  getMissionControl() {
    return apiClient.get("/admin/mission-control/live").then((res) => res.data);
  },
  getSmartAlerts() {
    return apiClient.get("/admin/mission-control/alerts").then((res) => res.data);
  },

  // PHASE UI-9 — Executive Admin Command Center
  getCommandCenter() {
    return apiClient.get("/admin/command-center").then((res) => res.data);
  },
  getCommandCenterExecutiveSummary() {
    return apiClient.get("/admin/command-center/executive-summary").then((res) => res.data);
  },

  // Phase A5.2 — Platform Health Center
  getPlatformHealth() {
    return apiClient.get("/admin/platform-health").then((res) => res.data);
  },
  getInfrastructureStatus() {
    return apiClient.get("/admin/platform-health/infrastructure").then((res) => res.data);
  },
  getOperationalHealth() {
    return apiClient.get("/admin/platform-health/operational").then((res) => res.data);
  },
  getOperationsQueue() {
    return apiClient.get("/admin/platform-health/operations-queue").then((res) => res.data);
  },

  // Phase A5.2 — Smart Widgets Platform
  getWidgetRegistry() {
    return apiClient.get("/admin/widgets/registry").then((res) => res.data);
  },
  getWidgetData(key, params = {}) {
    return apiClient.get(`/admin/widgets/${key}`, { params }).then((res) => res.data);
  },

  // Phase A5.3 — Executive Action Center
  getActionCenter() {
    return apiClient.get("/admin/executive-actions/action-center").then((res) => res.data);
  },
  getExecutiveRecommendations() {
    return apiClient.get("/admin/executive-actions/recommendations").then((res) => res.data);
  },
  getDecisionCards() {
    return apiClient.get("/admin/executive-actions/decisions").then((res) => res.data);
  },
  getExecutiveTimeline(params = {}) {
    return apiClient.get("/admin/executive-actions/timeline", { params }).then((res) => res.data);
  },
  getBusinessRules() {
    return apiClient.get("/admin/executive-actions/business-rules").then((res) => res.data);
  },
  explainMetric(metricKey) {
    return apiClient.get(`/admin/executive-actions/explain/${metricKey}`).then((res) => res.data);
  },
  broadcastAnnouncement(payload) {
    return apiClient.post("/admin/executive-actions/broadcast", payload).then((res) => res.data);
  },
  setRegistrationsPaused(paused) {
    return apiClient.post("/admin/executive-actions/registrations/pause", { paused }).then((res) => res.data);
  },

  // Phase A6.1 — Unified Operations Queue
  getUnifiedOperationsQueue(params = {}) {
    return apiClient.get("/admin/operations/queue", { params }).then((res) => res.data);
  },
  getOperationsBusinessRules() {
    return apiClient.get("/admin/operations/business-rules").then((res) => res.data);
  },
  // Phase UI-11, Part K — SLA Command Center
  getSlaOverview() {
    return apiClient.get("/admin/operations/sla-overview").then((res) => res.data);
  },
  getOperationDetail(operationKey) {
    return apiClient.get(`/admin/operations/${operationKey}`).then((res) => res.data);
  },
  getOperationAiSummary(operationKey) {
    return apiClient.get(`/admin/operations/${operationKey}/ai-summary`).then((res) => res.data);
  },
  claimOperation(operationKey) {
    return apiClient.post(`/admin/operations/${operationKey}/claim`).then((res) => res.data);
  },
  releaseOperation(operationKey) {
    return apiClient.post(`/admin/operations/${operationKey}/release`).then((res) => res.data);
  },
  assignOperation(operationKey, userId, note) {
    return apiClient.post(`/admin/operations/${operationKey}/assign`, { userId, note }).then((res) => res.data);
  },
  escalateOperation(operationKey, userId, note) {
    return apiClient.post(`/admin/operations/${operationKey}/escalate`, { userId, note }).then((res) => res.data);
  },
  resolveOperation(operationKey, note) {
    return apiClient.post(`/admin/operations/${operationKey}/resolve`, { note }).then((res) => res.data);
  },
  cancelOperation(operationKey, note) {
    return apiClient.post(`/admin/operations/${operationKey}/cancel`, { note }).then((res) => res.data);
  },
  pinOperation(operationKey, pinned) {
    return apiClient.post(`/admin/operations/${operationKey}/pin`, { pinned }).then((res) => res.data);
  },

  // Phase A6.2.1 — Enterprise Workflow Automation Core (Workflow Engine Inspector)
  getWorkflowRegistry() {
    return apiClient.get("/admin/operations/workflow-registry").then((res) => res.data);
  },
  getWorkflowLifecycle() {
    return apiClient.get("/admin/operations/workflow-lifecycle").then((res) => res.data);
  },
  getWorkflowExplain(operationKey) {
    return apiClient.get(`/admin/operations/${operationKey}/workflow-explain`).then((res) => res.data);
  },

  // Phase A6.2.2 — Smart Assignment Engine
  getWorkloadIntelligence() {
    return apiClient.get("/admin/assignment/workload").then((res) => res.data);
  },
  getAssignmentRecommendations(operationKey) {
    return apiClient.get(`/admin/assignment/${operationKey}/recommendations`).then((res) => res.data);
  },
  getReassignmentRecommendation(operationKey) {
    return apiClient.get(`/admin/assignment/${operationKey}/reassignment`).then((res) => res.data);
  },
  getAssignmentConflicts() {
    return apiClient.get("/admin/assignment/conflicts").then((res) => res.data);
  },
  getAssignmentAnalytics() {
    return apiClient.get("/admin/assignment/analytics").then((res) => res.data);
  },
  getAssignmentBusinessRules() {
    return apiClient.get("/admin/assignment/business-rules").then((res) => res.data);
  },
  runAssignmentSweep() {
    return apiClient.post("/admin/assignment/sweep").then((res) => res.data);
  },
  getAssignmentRecommendationExplain(operationKey) {
    return apiClient.get(`/admin/assignment/${operationKey}/ai-recommendation`).then((res) => res.data);
  },
  getReassignmentAdvisor(operationKey) {
    return apiClient.get(`/admin/assignment/${operationKey}/ai-reassignment`).then((res) => res.data);
  },
  getWorkloadAdvisor() {
    return apiClient.get("/admin/assignment/ai/workload-advisor").then((res) => res.data);
  },
  getSlaAdvisor() {
    return apiClient.get("/admin/assignment/ai/sla-advisor").then((res) => res.data);
  },
  getAssignmentEngineExplain() {
    return apiClient.get("/admin/assignment/ai/explain").then((res) => res.data);
  },
};

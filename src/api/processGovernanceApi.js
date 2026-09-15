import apiClient from "./axios";

const BASE = "/admin/process-governance";

export const processGovernanceApi = {
  getOverview() {
    return apiClient.get(`${BASE}/overview`).then((res) => res.data);
  },
  getApprovalQueue(params = {}) {
    return apiClient.get(`${BASE}/approval-queue`, { params }).then((res) => res.data);
  },
  getComplianceMatrix(filter, params = {}) {
    return apiClient.get(`${BASE}/compliance-matrix`, { params: { filter, ...params } }).then((res) => res.data);
  },
  getExceptions() {
    return apiClient.get(`${BASE}/exceptions`).then((res) => res.data);
  },

  getProcessGovernance(id) {
    return apiClient.get(`${BASE}/processes/${id}`).then((res) => res.data);
  },
  getAuditTimeline(id) {
    return apiClient.get(`${BASE}/processes/${id}/audit-timeline`).then((res) => res.data);
  },
  updateClassification(id, payload) {
    return apiClient.put(`${BASE}/processes/${id}/classification`, payload).then((res) => res.data);
  },

  submitForReview(id, reason) {
    return apiClient.post(`${BASE}/processes/${id}/submit-review`, { reason }).then((res) => res.data);
  },
  approve(id, payload) {
    return apiClient.post(`${BASE}/processes/${id}/approve`, payload).then((res) => res.data);
  },
  reject(id, decisionNote) {
    return apiClient.post(`${BASE}/processes/${id}/reject`, { decisionNote }).then((res) => res.data);
  },
  requestChanges(id, decisionNote) {
    return apiClient.post(`${BASE}/processes/${id}/request-changes`, { decisionNote }).then((res) => res.data);
  },
  emergencyPublish(id, reason) {
    return apiClient.post(`${BASE}/processes/${id}/emergency-publish`, { reason }).then((res) => res.data);
  },
  resolveException(id, exceptionId) {
    return apiClient.post(`${BASE}/processes/${id}/exceptions/${exceptionId}/resolve`).then((res) => res.data);
  },

  explainGovernance(id) {
    return apiClient.get(`${BASE}/processes/${id}/ai-explain`).then((res) => res.data);
  },
  explainApprovalRisk(id) {
    return apiClient.get(`${BASE}/processes/${id}/ai-approval-risk`).then((res) => res.data);
  },
  explainCompliance(id) {
    return apiClient.get(`${BASE}/processes/${id}/ai-compliance-summary`).then((res) => res.data);
  },
  explainChangeImpact(id, withVersion) {
    return apiClient.get(`${BASE}/processes/${id}/ai-change-impact`, { params: { withVersion } }).then((res) => res.data);
  },
};

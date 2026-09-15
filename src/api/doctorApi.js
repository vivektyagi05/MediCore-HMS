import apiClient from "./axios";

export const doctorApi = {
  /*
  |--------------------------------------------------------------------------
  | Doctors
  |--------------------------------------------------------------------------
  */

  getReviews(params = {}) {
    return apiClient
      .get("/doctors/reviews", { params })
      .then(
        (res) => res.data
      );
  },

  getDoctors(params = {}) {
    return apiClient
      .get("/doctors", { params })
      .then((res) => res.data);
  },

  createDoctor(payload) {
    return apiClient
      .post("/doctors", payload)
      .then((res) => res.data);
  },

  updateDoctor(id, payload) {
    return apiClient
      .put(`/doctors/${id}`, payload)
      .then((res) => res.data);
  },

  deleteDoctor(id) {
    return apiClient
      .delete(`/doctors/${id}`)
      .then((res) => res.data);
  },

  getOnboarding() {
  return apiClient
    .get("/doctor/onboarding")
    .then((res) => res.data);
},

submitOnboarding(payload) {
  return apiClient
    .post("/doctor/onboarding", payload)
    .then((res) => res.data);
},

updateOnboarding(payload) {
  return apiClient
    .put("/doctor/onboarding", payload)
    .then((res) => res.data);
},

  /*
  |--------------------------------------------------------------------------
  | Doctor Patients
  |--------------------------------------------------------------------------
  */

  getPatients(params = {}) {
    return apiClient
      .get("/doctors/patients", { params })
      .then((res) => res.data);
  },

  uploadDocument(formData) {
      return apiClient.post(
        "/doctor/documents",
        formData,
        {
          headers: {
            "Content-Type":
              "multipart/form-data",
          },
        }
      ).then((res) => res.data);
    },

    getDocuments() {
      return apiClient
        .get("/doctor/documents")
        .then((res) => res.data);
    },
    getPendingDoctors() {
      return apiClient
        .get("/doctors/pending")
        .then((res) => res.data);
    },

    approveDoctor(id) {
      return apiClient
        .put(`/doctors/${id}/approve`)
        .then((res) => res.data);
    },

    rejectDoctor(id, reason) {
      return apiClient
        .put(`/doctors/${id}/reject`, {
          reason,
        })
        .then((res) => res.data);
    },

    replyReview(
      reviewId,
      payload
    ) {
      return apiClient
        .patch(
          `/doctors/reviews/${reviewId}/reply`,
          payload
        )
        .then(
          (res) => res.data
        );
    },

    getEarnings() {
    return apiClient
      .get(
      "/doctors/earnings"
      )
      .then(
      (res)=>res.data
      );
    },

    // PHASE DOC-09 — Financial Control Center additions.
    getPayouts(params = {}) {
      return apiClient.get("/doctors/payouts", { params }).then((res) => res.data);
    },

    getFinancialAttention() {
      return apiClient.get("/doctors/earnings/attention").then((res) => res.data);
    },

    getReconciliation() {
      return apiClient.get("/doctors/earnings/reconciliation").then((res) => res.data);
    },

    getFinancialPosition(params = {}) {
      return apiClient.get("/doctors/earnings/position", { params }).then((res) => res.data);
    },

    pinReview(reviewId) {
      return apiClient
        .patch(`/doctors/reviews/${reviewId}/pin`)
        .then((res) => res.data);
    },

    getBusinessOverview() {
      return apiClient
        .get("/doctors/business/overview")
        .then((res) => res.data);
    },

    // Admin: verify or reject one document in a doctor's Document Center.
    // Existing backend route (doctorRoutes.js) had no client wrapper yet --
    // the Doctor Management Workspace is the first UI to actually surface
    // this action, so every uploaded document was previously stuck at
    // "pending" forever with no way to change it from the UI.
    verifyDocument(doctorId, documentId, payload) {
      return apiClient
        .put(`/doctors/${doctorId}/documents/${documentId}/verify`, payload)
        .then((res) => res.data);
    },

};


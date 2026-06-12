import apiClient from "./axios";

export const doctorApi = {
  /*
  |--------------------------------------------------------------------------
  | Doctors
  |--------------------------------------------------------------------------
  */

  getReviews() {
    return apiClient
      .get("/doctors/reviews")
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

  getPatients() {
    return apiClient
      .get("/doctors/patients")
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

    

};


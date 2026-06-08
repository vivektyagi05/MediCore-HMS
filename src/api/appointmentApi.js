import apiClient from "./axios";

export const appointmentApi = {
  getAppointments(params = {}) {
    return apiClient.get("/appointments", { params }).then((res) => res.data);
  },
  createAppointment(payload) {
    return apiClient.post("/appointments", payload).then((res) => res.data);
  },
  updateAppointmentStatus(id, payload) {
    return apiClient
      .put(`/appointments/${id}/status`, payload)
      .then((res) => res.data);
  },
  getAppointment(id) {
    return apiClient
      .get(`/appointments/${id}`)
      .then((res) => res.data);
  },

  approveAppointment(id) {
    return apiClient
      .put(
        `/appointments/${id}/status`,
        {
          status: "approved",
        }
      )
      .then((res) => res.data);
  },

  completeAppointment(id) {
    return apiClient
      .put(
        `/appointments/${id}/status`,
        {
          status: "completed",
        }
      )
      .then((res) => res.data);
  },

  
  cancelAppointment(id) {
    return apiClient.patch(
      `/appointments/${id}/cancel`
    ).then(
      (res) => res.data
    );
  }
  
};

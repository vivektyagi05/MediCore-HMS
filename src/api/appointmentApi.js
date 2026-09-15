import apiClient from "./axios";

export const appointmentApi = {
  getAppointments(params = {}) {
    return apiClient.get("/appointments", { params }).then((res) => res.data);
  },
  getAppointment(id) {
    return apiClient.get(`/appointments/${id}`).then((res) => res.data);
  },
  getAppointmentSummary() {
    return apiClient.get("/appointments/summary").then((res) => res.data);
  },
  getAvailableSlots(doctorId, date) {
    return apiClient
      .get("/appointments/available-slots", { params: { doctorId, date } })
      .then((res) => res.data);
  },
  getNextAvailableSlot(doctorId, fromDate) {
    return apiClient
      .get("/appointments/next-available", { params: { doctorId, fromDate } })
      .then((res) => res.data);
  },
  createAppointment(payload) {
    return apiClient.post("/appointments", payload).then((res) => res.data);
  },
  updateAppointmentStatus(id, payload) {
    return apiClient
      .put(`/appointments/${id}/status`, payload)
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

  cancelAppointment(id, reason) {
    return apiClient.patch(
      `/appointments/${id}/cancel`,
      { reason }
    ).then(
      (res) => res.data
    );
  },

  rescheduleAppointment(id, { date, timeSlot, reason }) {
    return apiClient
      .patch(`/appointments/${id}/reschedule`, { date, timeSlot, reason })
      .then((res) => res.data);
  }

};

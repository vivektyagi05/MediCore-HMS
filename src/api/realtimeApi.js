import apiClient from "./axios";

export const realtimeApi = {
  getNotifications(params = {}) {
    return apiClient.get("/realtime/notifications", { params }).then((res) => res.data);
  },
  markNotificationRead(id) {
    return apiClient.patch(`/realtime/notifications/${id}/read`).then((res) => res.data);
  },
  getPresence() {
    return apiClient.get("/realtime/presence").then((res) => res.data);
  },
  getConversation(userId, params = {}) {
    return apiClient.get(`/realtime/chat/${userId}`, { params }).then((res) => res.data);
  },
};

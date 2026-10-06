import apiClient from "./axios";

export const realtimeApi = {
  getNotifications(params = {}) {
    return apiClient.get("/realtime/notifications", { params }).then((res) => res.data);
  },
  // Phase D5: Smart Inbox
  getSmartInbox(params = {}) {
    return apiClient.get("/realtime/inbox", { params }).then((res) => res.data);
  },
  markNotificationRead(id) {
    return apiClient.patch(`/realtime/notifications/${id}/read`).then((res) => res.data);
  },
  getPresence() {
    return apiClient.get("/realtime/presence").then((res) => res.data);
  },

  // ── Communication (one engine; REST is the durable + fallback path) ──
  // Chat reads opt out of the 2s GET cache (dedupe:false): a cached sync/history
  // response would hide a message that just arrived.
  getConversations(params = {}) {
    return apiClient.get("/realtime/chat/conversations", { params, dedupe: false }).then((res) => res.data);
  },
  getContacts(params = {}) {
    return apiClient.get("/realtime/chat/contacts", { params, dedupe: false }).then((res) => res.data);
  },
  getChatUnreadCount() {
    return apiClient.get("/realtime/chat/unread-count", { dedupe: false }).then((res) => res.data);
  },
  getConversation(userId, params = {}) {
    return apiClient.get(`/realtime/chat/${userId}`, { params, dedupe: false }).then((res) => res.data);
  },
  syncConversation(userId, { afterMessageId, knownOutgoingIds = [] } = {}) {
    const params = {};
    if (afterMessageId) params.afterMessageId = afterMessageId;
    if (knownOutgoingIds.length) params.knownOutgoingIds = knownOutgoingIds.join(",");
    return apiClient.get(`/realtime/chat/${userId}/sync`, { params, dedupe: false }).then((res) => res.data);
  },
  sendMessage(userId, { body, clientMessageId }) {
    return apiClient.post(`/realtime/chat/${userId}/messages`, { body, clientMessageId }).then((res) => res.data);
  },
  sendAttachment(userId, { file, clientMessageId, caption }) {
    const form = new FormData();
    form.append("clientMessageId", clientMessageId);
    if (caption) form.append("caption", caption);
    form.append("file", file); // file last so text fields are parsed first
    return apiClient.post(`/realtime/chat/${userId}/attachments`, form, { timeout: 60000 }).then((res) => res.data);
  },
  markConversationRead(userId, upToMessageId) {
    return apiClient.post(`/realtime/chat/${userId}/read`, { upToMessageId }).then((res) => res.data);
  },
  acknowledgeDelivered(userId, messageIds) {
    return apiClient.post(`/realtime/chat/${userId}/delivered`, { messageIds }).then((res) => res.data);
  },
  /** Authenticated download -> Blob (attachments are never reachable by a plain URL). */
  downloadAttachment(messageId) {
    return apiClient.get(`/realtime/chat/messages/${messageId}/attachment`, { responseType: "blob" }).then((res) => res.data);
  },
};

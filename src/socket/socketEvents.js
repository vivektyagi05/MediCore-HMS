export const SOCKET_EVENTS = Object.freeze({
  READY: "socket:ready",
  ERROR: "realtime:error",
  NOTIFICATION_NEW: "notification:new",
  DASHBOARD_SYNC: "dashboard:sync",
  APPOINTMENT_CREATED: "appointment:created",
  APPOINTMENT_UPDATED: "appointment:updated",
  PAYMENT_CAPTURED: "payment:captured",
  PAYMENT_REFUND: "payment:refund",
  PRESENCE_UPDATE: "presence:update",
  CHAT_MESSAGE: "chat:message",
  TYPING_START: "chat:typing:start",
  TYPING_STOP: "chat:typing:stop",
});

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
  AUTH_INVALIDATED: "auth:invalidated",
  // Chat — names MUST match backend/services/chat/chatConstants.js (CHAT_EVENTS);
  // backend/tests/chatContracts.test.mjs fails the build if they ever drift.
  CHAT_SEND: "chat:send",
  CHAT_MESSAGE: "chat:message",
  CHAT_DELIVERED: "chat:message:delivered",
  CHAT_READ: "chat:message:read",
  CHAT_SYNC: "chat:sync",
  CHAT_ERROR: "chat:error",
  TYPING_START: "chat:typing:start",
  TYPING_STOP: "chat:typing:stop",
});

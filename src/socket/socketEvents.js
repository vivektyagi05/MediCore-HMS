export const SOCKET_EVENTS = Object.freeze({
  READY: "socket:ready",
  ERROR: "realtime:error",
  NOTIFICATION_NEW: "notification:new",
  DASHBOARD_SYNC: "dashboard:sync",
  APPOINTMENT_CREATED: "appointment:created",
  APPOINTMENT_UPDATED: "appointment:updated",
  // Operational lifecycle events. Transport only: each one is a HINT to refetch
  // authoritative REST state, never the source of truth.
  APPOINTMENT_RESCHEDULED: "appointment:rescheduled",
  APPOINTMENT_CHECKED_IN: "appointment:checked_in",
  APPOINTMENT_CALLED: "appointment:called",
  APPOINTMENT_DELAY: "appointment:delay",
  APPOINTMENT_MISSED: "appointment:missed",
  APPOINTMENT_EXPIRED: "appointment:expired",
  APPOINTMENT_RESOLUTION_REQUIRED: "appointment:resolution_required",
  APPOINTMENT_QUEUE_UPDATED: "appointment:queue_updated",
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

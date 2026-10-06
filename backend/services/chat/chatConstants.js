// Shared chat constants + the single structured error type for the chat
// subsystem. REST and Socket.IO both surface ChatError; REST through the
// existing errorMiddleware ({ success:false, message, details:{ code } }),
// sockets through an ack of { success:false, message, error:{ code, message } }.
import { AppError } from "../../middleware/errorMiddleware.js";
import { env } from "../../config/env.js";

export const CHAT_EVENTS = Object.freeze({
  SEND: "chat:send", //                client -> server (ack = chat:message:ack)
  MESSAGE: "chat:message", //          server -> client (new / reconciled message)
  DELIVERED: "chat:message:delivered", // client -> server (recipient device ack); server -> sender
  READ: "chat:message:read", //        client -> server (recipient opened); server -> both participants
  TYPING_START: "chat:typing:start",
  TYPING_STOP: "chat:typing:stop",
  SYNC: "chat:sync", //                client -> server (ack carries missed messages + state updates)
  ERROR: "chat:error", //              server -> client (asynchronous failures)
});

export const CHAT_ERROR = Object.freeze({
  VALIDATION: "CHAT_VALIDATION",
  FORBIDDEN: "CHAT_FORBIDDEN",
  READ_ONLY: "CHAT_READ_ONLY",
  NOT_FOUND: "CHAT_NOT_FOUND",
  CONFLICT: "CHAT_CONFLICT",
  RATE_LIMITED: "CHAT_RATE_LIMITED",
  FEATURE_DISABLED: "CHAT_FEATURE_DISABLED",
  ATTACHMENT_INVALID: "CHAT_ATTACHMENT_INVALID",
  ATTACHMENT_TOO_LARGE: "CHAT_ATTACHMENT_TOO_LARGE",
  STORAGE_UNAVAILABLE: "CHAT_STORAGE_UNAVAILABLE",
  SESSION_INVALID: "CHAT_SESSION_INVALID",
});

const STATUS_BY_CODE = {
  [CHAT_ERROR.VALIDATION]: 422,
  [CHAT_ERROR.FORBIDDEN]: 403,
  [CHAT_ERROR.READ_ONLY]: 403,
  [CHAT_ERROR.NOT_FOUND]: 404,
  [CHAT_ERROR.CONFLICT]: 409,
  [CHAT_ERROR.RATE_LIMITED]: 429,
  [CHAT_ERROR.FEATURE_DISABLED]: 403,
  [CHAT_ERROR.ATTACHMENT_INVALID]: 415,
  [CHAT_ERROR.ATTACHMENT_TOO_LARGE]: 413,
  [CHAT_ERROR.STORAGE_UNAVAILABLE]: 503,
  [CHAT_ERROR.SESSION_INVALID]: 401,
};

export class ChatError extends AppError {
  constructor(code, message, extraDetails = {}) {
    super(message, STATUS_BY_CODE[code] || 400, { code, ...extraDetails });
    this.name = "ChatError";
    this.code = code;
  }
}

export const CHAT_LIMITS = Object.freeze({
  BODY_MAX: 4000,
  HISTORY_PAGE_DEFAULT: 30,
  HISTORY_PAGE_MAX: 100,
  SYNC_PAGE_MAX: 200,
  SYNC_KNOWN_IDS_MAX: 100,
  RECEIPT_IDS_MAX: 200,
  CONVERSATION_PAGE_DEFAULT: 20,
  CONVERSATION_PAGE_MAX: 50,
  CLIENT_MESSAGE_ID: /^[A-Za-z0-9_-]{8,64}$/,
  ATTACHMENT_MAX_BYTES: env.chat?.attachmentMaxBytes || 5 * 1024 * 1024,
});

export const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectIdString = (value) => typeof value === "string" && OBJECT_ID.test(value);

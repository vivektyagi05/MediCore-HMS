// ─────────────────────────────────────────────────────────────────────────
// Pure client-side message-state helpers (no React, no I/O) so the rules are
// unit-testable (backend/tests/chatMessageState.test.mjs).
//
// Principles:
//  • SERVER STATE WINS. A pending/optimistic message is reconciled with the
//    server copy by clientMessageId (or _id); statuses only move forward
//    (sending < sent < delivered < read), so a late/duplicate event can never
//    regress what the server already told us.
//  • No fake states: "sending" and "failed" are local; "sent", "delivered"
//    and "read" are only ever set from server data.
// ─────────────────────────────────────────────────────────────────────────

export const STATUS_RANK = Object.freeze({ failed: 0, sending: 1, sent: 2, delivered: 3, read: 4 });

export const newClientMessageId = () => {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `c-${raw}`.slice(0, 64);
};

const rank = (status) => STATUS_RANK[status] ?? 0;
const sameMessage = (a, b) => (a._id && b._id && a._id === b._id) || (a.clientMessageId && b.clientMessageId && a.clientMessageId === b.clientMessageId);

const compareForDisplay = (a, b) => {
  if (a._id && b._id) return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
  if (a._id && !b._id) return -1; // server-confirmed before still-pending local ones
  if (!a._id && b._id) return 1;
  return new Date(a.createdAt) - new Date(b.createdAt);
};

/** Merge server messages into the list (dedupe by _id / clientMessageId, server copy wins, status never regresses). */
export function mergeServerMessages(list, serverMessages) {
  const result = [...list];
  for (const incoming of serverMessages) {
    const index = result.findIndex((existing) => sameMessage(existing, incoming));
    if (index === -1) {
      result.push({ ...incoming, error: undefined });
    } else {
      const existing = result[index];
      const status = rank(existing.status) > rank(incoming.status) && existing._id ? existing.status : incoming.status;
      result[index] = {
        ...existing, ...incoming, status,
        deliveredAt: incoming.deliveredAt || existing.deliveredAt || null,
        readAt: incoming.readAt || existing.readAt || null,
        error: undefined, attempts: undefined,
      };
    }
  }
  return result.sort(compareForDisplay);
}

export function addPending(list, pending) {
  if (list.some((m) => m.clientMessageId === pending.clientMessageId)) return list;
  return [...list, pending].sort(compareForDisplay);
}

export const markFailed = (list, clientMessageId, error) =>
  list.map((m) => (m.clientMessageId === clientMessageId && !m._id ? { ...m, status: "failed", error } : m));

export const markSending = (list, clientMessageId) =>
  list.map((m) => (m.clientMessageId === clientMessageId && !m._id ? { ...m, status: "sending", error: undefined } : m));

const advance = (message, status, patch) => (rank(status) > rank(message.status) ? { ...message, ...patch, status } : { ...message, ...patch });

export function applyDelivered(list, messageIds, deliveredAt) {
  const ids = new Set(messageIds.map(String));
  return list.map((m) => (m._id && ids.has(String(m._id)) ? advance(m, "delivered", { deliveredAt: m.deliveredAt || deliveredAt }) : m));
}

export function applyRead(list, messageIds, readAt) {
  const ids = new Set(messageIds.map(String));
  return list.map((m) => (m._id && ids.has(String(m._id)) ? advance(m, "read", { readAt: m.readAt || readAt, deliveredAt: m.deliveredAt || readAt }) : m));
}

/** Apply `chat:sync` state updates ({ _id, deliveredAt, readAt, status }) for messages we already hold. */
export function applyStates(list, updates) {
  const byId = new Map(updates.map((u) => [String(u._id), u]));
  return list.map((m) => {
    const u = m._id && byId.get(String(m._id));
    return u ? advance(m, u.status, { deliveredAt: u.deliveredAt || m.deliveredAt || null, readAt: u.readAt || m.readAt || null }) : m;
  });
}

export const lastServerMessageId = (list) => {
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]._id) return list[i]._id;
  return null;
};

/** My outgoing messages whose delivery/read state may have changed while I was away (bounded). */
export const knownOutgoingIds = (list, myId, max = 100) =>
  list.filter((m) => m._id && String(m.senderId) === String(myId) && m.status !== "read").slice(-max).map((m) => m._id);

export const incomingUnreadIds = (list, myId) =>
  list.filter((m) => m._id && String(m.recipientId) === String(myId) && !m.readAt).map((m) => m._id);

export const incomingUndeliveredIds = (list, myId) =>
  list.filter((m) => m._id && String(m.recipientId) === String(myId) && !m.deliveredAt).map((m) => m._id);

// ── error normalisation (REST axios errors AND socket ack errors) ──────────
const NON_RETRYABLE = new Set(["CHAT_FORBIDDEN", "CHAT_READ_ONLY", "CHAT_VALIDATION", "CHAT_CONFLICT", "CHAT_FEATURE_DISABLED", "CHAT_ATTACHMENT_INVALID", "CHAT_ATTACHMENT_TOO_LARGE", "CHAT_SESSION_INVALID", "CHAT_NOT_FOUND"]);

const FRIENDLY = {
  401: "Your session has expired. Please sign in again.",
  403: "You are not allowed to message this person.",
  404: "That conversation or file could not be found.",
  409: "That message conflicts with one already sent. Please refresh.",
  413: "That file is too large.",
  415: "That file type is not allowed. Send a PNG, JPEG or PDF.",
  422: "That message is not valid.",
  429: "You are sending too quickly. Please wait a moment.",
  503: "The service is temporarily unavailable. Please try again.",
};

/** @returns {{ code: string|null, message: string, retryable: boolean, readOnlyReason: string|null }} */
export function chatErrorInfo(error) {
  const ackError = error?.error && typeof error.error === "object" ? error.error : null; // socket ack
  const data = error?.response?.data;
  const code = ackError?.code || data?.details?.code || null;
  const status = error?.response?.status;
  const serverMessage = ackError?.message || data?.message;
  const readOnlyReason = ackError?.readOnlyReason || data?.details?.readOnlyReason || null;
  if (!error?.response && !ackError) {
    const timedOut = error?.code === "ECONNABORTED" || error?.message === "operation has timed out";
    return { code: timedOut ? "TIMEOUT" : "NETWORK", message: timedOut ? "The server took too long to respond." : "You appear to be offline. Check your connection.", retryable: true, readOnlyReason: null };
  }
  const retryable = code ? !NON_RETRYABLE.has(code) && status !== 429 : (status ? status >= 500 || status === 429 : true);
  const message = serverMessage && (code || status !== 500) ? serverMessage : (FRIENDLY[status] || "Something went wrong. Please try again.");
  return { code, message, retryable, readOnlyReason };
}

export const RETRY_DELAYS_MS = Object.freeze([1000, 3000, 7000]); // bounded: no infinite retry loop

export const statusLabel = (status) => ({ sending: "Sending…", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" }[status] || "");

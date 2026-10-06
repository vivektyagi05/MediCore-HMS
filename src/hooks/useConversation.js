import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { realtimeApi } from "../api/realtimeApi";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { SOCKET_EVENTS } from "../socket/socketEvents";
import { CHAT_UNREAD_EVENT } from "../utils/chatEvents";
import {
  RETRY_DELAYS_MS, addPending, applyDelivered, applyRead, applyStates, chatErrorInfo, incomingUndeliveredIds,
  incomingUnreadIds, knownOutgoingIds, lastServerMessageId, markFailed, markSending, mergeServerMessages, newClientMessageId,
} from "../utils/chatMessageState";

// ─────────────────────────────────────────────────────────────────────────
// The ONE client-side conversation controller used by both Communication
// Hubs (and the embedded patient-profile panel). MongoDB is the source of
// truth; the socket is a transport. This hook therefore:
//   • loads history over REST (cursor pagination) — never trusts a socket
//     event alone as "saved"; a message is only "sent" once the server acked
//   • sends with a clientMessageId; failures/timeouts retry (bounded) with
//     the SAME id, over the socket first and REST as the durable fallback
//   • on every reconnect / tab-visible / browser-online runs an application
//     level resync (missed messages + delivery/read state), not just
//     Socket.IO's transport reconnect
//   • reports "delivered" only when THIS device received the message and
//     "read" only when the thread is actually visible
// ─────────────────────────────────────────────────────────────────────────
const ACK_TIMEOUT_MS = 8000;
const TYPING_REFRESH_MS = 3000;
const TYPING_IDLE_MS = 2000;
const TYPING_REMOTE_TTL_MS = 6000;
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "application/pdf"];
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export { CHAT_UNREAD_EVENT };

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const announceUnreadChanged = () => window.dispatchEvent(new Event(CHAT_UNREAD_EVENT));

export function useConversation(userId) {
  const { user } = useAuth();
  const { socket, connectionStatus } = useRealtime();
  const myId = user?._id ? String(user._id) : null;
  const conversationKey = useMemo(() => (myId && userId ? [myId, String(userId)].sort().join(":") : null), [myId, userId]);

  const [messages, setMessagesState] = useState([]);
  const [participant, setParticipant] = useState(null);
  const [access, setAccess] = useState(null);
  const [paging, setPaging] = useState({ hasMore: false, nextBefore: null });
  const [status, setStatus] = useState({ loading: true, loadingOlder: false, error: null });
  const [peerTyping, setPeerTyping] = useState(false);

  const messagesRef = useRef([]);
  const aliveRef = useRef(true);
  const loadedRef = useRef(false);
  const inFlight = useRef(new Set());
  const pendingFiles = useRef(new Map());
  const readInFlight = useRef(false);
  const resyncing = useRef(false);
  const typingState = useRef({ lastStart: 0, idleTimer: null, remoteTimer: null });
  const socketRef = useRef(socket);

  useEffect(() => { socketRef.current = socket; }, [socket]);

  const setMessages = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(messagesRef.current) : updater;
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  // ── transport helpers ──────────────────────────────────────────────────
  const socketEmit = useCallback((event, payload) => new Promise((resolve, reject) => {
    const active = socketRef.current;
    if (!active?.connected) { reject(new Error("socket not connected")); return; }
    active.timeout(ACK_TIMEOUT_MS).emit(event, payload, (timeoutError, ack) => {
      if (timeoutError) reject(timeoutError);
      else if (!ack?.success) reject(ack || new Error("rejected"));
      else resolve(ack);
    });
  }), []);

  /** Socket first (fast path); REST as the durable fallback. Both are idempotent on clientMessageId. */
  const transmitText = useCallback(async (entry) => {
    try {
      const ack = await socketEmit(SOCKET_EVENTS.CHAT_SEND, { recipientId: userId, body: entry.body, clientMessageId: entry.clientMessageId });
      return ack.message;
    } catch (socketError) {
      if (socketError?.error) throw socketError; // the server answered with a real refusal — do not mask it with a REST retry
      const response = await realtimeApi.sendMessage(userId, { body: entry.body, clientMessageId: entry.clientMessageId });
      return response.data.message;
    }
  }, [socketEmit, userId]);

  const transmitAttachment = useCallback(async (entry) => {
    const stored = pendingFiles.current.get(entry.clientMessageId);
    if (!stored) throw new Error("The selected file is no longer available. Please attach it again.");
    const response = await realtimeApi.sendAttachment(userId, { file: stored.file, clientMessageId: entry.clientMessageId, caption: stored.caption });
    return response.data.message;
  }, [userId]);

  const runSend = useCallback(async (entry) => {
    if (inFlight.current.has(entry.clientMessageId)) return;
    inFlight.current.add(entry.clientMessageId);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const message = entry.messageType === "attachment" ? await transmitAttachment(entry) : await transmitText(entry);
          pendingFiles.current.delete(entry.clientMessageId);
          if (aliveRef.current) setMessages((list) => mergeServerMessages(list, [message]));
          return;
        } catch (error) {
          const info = chatErrorInfo(error);
          if (!aliveRef.current) return;
          if (!info.retryable || attempt >= RETRY_DELAYS_MS.length) {
            setMessages((list) => markFailed(list, entry.clientMessageId, info));
            if (info.readOnlyReason) setAccess((current) => ({ ...(current || {}), canSend: false, status: "read_only", readOnlyReason: info.readOnlyReason }));
            return;
          }
          await sleep(RETRY_DELAYS_MS[attempt]);
          if (!aliveRef.current) return;
        }
      }
    } finally {
      inFlight.current.delete(entry.clientMessageId);
    }
  }, [setMessages, transmitAttachment, transmitText]);

  // ── receipts ───────────────────────────────────────────────────────────
  const acknowledgeAndRead = useCallback(async () => {
    if (!myId || !userId || readInFlight.current) return;
    readInFlight.current = true;
    try {
      const undelivered = incomingUndeliveredIds(messagesRef.current, myId);
      if (undelivered.length) {
        try {
          await socketEmit(SOCKET_EVENTS.CHAT_DELIVERED, { userId, messageIds: undelivered.slice(0, 200) });
        } catch {
          await realtimeApi.acknowledgeDelivered(userId, undelivered.slice(0, 200)); // REST fallback
        }
      }
      const visible = document.visibilityState === "visible";
      const unread = incomingUnreadIds(messagesRef.current, myId);
      if (visible && unread.length) {
        const upTo = unread[unread.length - 1];
        let result;
        try {
          result = await socketEmit(SOCKET_EVENTS.CHAT_READ, { userId, upToMessageId: upTo });
        } catch {
          result = (await realtimeApi.markConversationRead(userId, upTo)).data;
        }
        if (aliveRef.current && result.messageIds?.length) setMessages((list) => applyRead(list, result.messageIds, result.readAt));
        announceUnreadChanged();
      }
    } catch (error) {
      if (import.meta.env.DEV) console.warn("chat receipt sync failed:", chatErrorInfo(error).message);
    } finally {
      readInFlight.current = false;
    }
  }, [myId, setMessages, socketEmit, userId]);

  // ── history ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setStatus({ loading: true, loadingOlder: false, error: null });
    try {
      const { data } = await realtimeApi.getConversation(userId, { limit: 30 });
      if (!aliveRef.current) return;
      setMessages(mergeServerMessages([], data.messages));
      setParticipant(data.participant);
      setAccess(data.access);
      setPaging({ hasMore: data.hasMore, nextBefore: data.nextBefore });
      setStatus({ loading: false, loadingOlder: false, error: null });
      loadedRef.current = true;
      acknowledgeAndRead();
    } catch (error) {
      if (aliveRef.current) setStatus({ loading: false, loadingOlder: false, error: chatErrorInfo(error) });
    }
  }, [acknowledgeAndRead, setMessages, userId]);

  const loadOlder = useCallback(async () => {
    if (!paging.hasMore || status.loadingOlder) return;
    setStatus((s) => ({ ...s, loadingOlder: true }));
    try {
      const { data } = await realtimeApi.getConversation(userId, { limit: 30, before: paging.nextBefore });
      if (!aliveRef.current) return;
      setMessages((list) => mergeServerMessages(list, data.messages));
      setPaging({ hasMore: data.hasMore, nextBefore: data.nextBefore });
      setStatus((s) => ({ ...s, loadingOlder: false }));
    } catch (error) {
      if (aliveRef.current) setStatus((s) => ({ ...s, loadingOlder: false, error: chatErrorInfo(error) }));
    }
  }, [paging, setMessages, status.loadingOlder, userId]);

  // ── application-level resync (reconnect / visible / online) ─────────────
  const resync = useCallback(async () => {
    if (!loadedRef.current || resyncing.current) return;
    resyncing.current = true;
    try {
      const params = { afterMessageId: lastServerMessageId(messagesRef.current), knownOutgoingIds: knownOutgoingIds(messagesRef.current, myId) };
      let data;
      try {
        data = await socketEmit(SOCKET_EVENTS.CHAT_SYNC, { userId, ...params });
      } catch {
        data = (await realtimeApi.syncConversation(userId, params)).data;
      }
      if (!aliveRef.current) return;
      setMessages((list) => applyStates(mergeServerMessages(list, data.messages), data.updates || []));
      if (data.access) setAccess(data.access);
      // anything still "sending" (e.g. the socket dropped before the ack) is retried with the SAME id
      messagesRef.current.filter((m) => m.status === "sending" && !m._id).forEach((m) => runSend(m));
      announceUnreadChanged();
      acknowledgeAndRead();
    } catch (error) {
      if (import.meta.env.DEV) console.warn("chat resync failed:", chatErrorInfo(error).message);
    } finally {
      resyncing.current = false;
    }
  }, [acknowledgeAndRead, myId, runSend, setMessages, socketEmit, userId]);

  // ── lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    aliveRef.current = true;
    loadedRef.current = false;
    const typing = typingState.current;
    const stillInFlight = inFlight.current;
    setMessages([]);
    setPeerTyping(false);
    if (userId && myId) load();
    return () => {
      aliveRef.current = false;
      clearTimeout(typing.idleTimer);
      clearTimeout(typing.remoteTimer);
      stillInFlight.clear();
    };
  }, [load, myId, setMessages, userId]);

  // reconnect => resync (the first "online" is covered by load())
  const wasOnline = useRef(false);
  useEffect(() => {
    if (connectionStatus === "online") {
      if (wasOnline.current) resync();
      wasOnline.current = true;
    }
  }, [connectionStatus, resync]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") { resync(); acknowledgeAndRead(); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", resync);
    };
  }, [acknowledgeAndRead, resync]);

  // realtime events
  useEffect(() => {
    if (!socket || !conversationKey) return undefined;
    const mine = (payload) => payload?.conversationKey === conversationKey;

    const onMessage = (message) => {
      if (!mine(message)) return;
      setMessages((list) => mergeServerMessages(list, [message]));
      if (String(message.recipientId) === myId) acknowledgeAndRead();
      announceUnreadChanged();
    };
    const onDelivered = (payload) => { if (mine(payload)) setMessages((list) => applyDelivered(list, payload.messageIds || [], payload.deliveredAt)); };
    const onRead = (payload) => {
      if (!mine(payload)) return;
      setMessages((list) => applyRead(list, payload.messageIds || [], payload.readAt)); // other participant read mine / my other tab read theirs
      announceUnreadChanged();
    };
    const onTypingStart = (payload) => {
      if (!mine(payload) || String(payload.senderId) !== String(userId)) return;
      setPeerTyping(true);
      clearTimeout(typingState.current.remoteTimer);
      typingState.current.remoteTimer = setTimeout(() => setPeerTyping(false), TYPING_REMOTE_TTL_MS);
    };
    const onTypingStop = (payload) => { if (mine(payload) && String(payload.senderId) === String(userId)) setPeerTyping(false); };

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
    socket.on(SOCKET_EVENTS.CHAT_DELIVERED, onDelivered);
    socket.on(SOCKET_EVENTS.CHAT_READ, onRead);
    socket.on(SOCKET_EVENTS.TYPING_START, onTypingStart);
    socket.on(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
    return () => {
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
      socket.off(SOCKET_EVENTS.CHAT_DELIVERED, onDelivered);
      socket.off(SOCKET_EVENTS.CHAT_READ, onRead);
      socket.off(SOCKET_EVENTS.TYPING_START, onTypingStart);
      socket.off(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
    };
  }, [acknowledgeAndRead, conversationKey, myId, setMessages, socket, userId]);

  // ── typing (throttled, auto-stopping) ───────────────────────────────────
  const stopTyping = useCallback(() => {
    const typing = typingState.current;
    clearTimeout(typing.idleTimer);
    if (typing.lastStart) {
      typing.lastStart = 0;
      socketRef.current?.connected && socketRef.current.emit(SOCKET_EVENTS.TYPING_STOP, { recipientId: userId });
    }
  }, [userId]);

  const notifyTyping = useCallback(() => {
    if (!access?.canSend || !socketRef.current?.connected) return;
    const typing = typingState.current;
    const now = Date.now();
    if (now - typing.lastStart > TYPING_REFRESH_MS) {
      typing.lastStart = now;
      socketRef.current.emit(SOCKET_EVENTS.TYPING_START, { recipientId: userId });
    }
    clearTimeout(typing.idleTimer);
    typing.idleTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [access?.canSend, stopTyping, userId]);

  // ── public actions ──────────────────────────────────────────────────────
  const send = useCallback((text) => {
    const body = String(text || "").trim();
    if (!body || !myId) return false;
    const entry = { clientMessageId: newClientMessageId(), messageType: "text", body, senderId: myId, recipientId: String(userId), status: "sending", createdAt: new Date().toISOString(), attachment: null };
    stopTyping();
    setMessages((list) => addPending(list, entry));
    runSend(entry);
    return true;
  }, [myId, runSend, setMessages, stopTyping, userId]);

  /** @returns {string|null} an error message if the file is rejected client-side (the server re-validates everything) */
  const sendAttachment = useCallback((file, caption = "") => {
    if (!file || !myId) return "No file selected.";
    if (!ATTACHMENT_TYPES.includes(file.type)) return "Only PNG, JPEG images and PDF documents can be sent.";
    if (file.size > ATTACHMENT_MAX_BYTES) return "Attachments can be at most 5 MB.";
    if (file.size === 0) return "That file is empty.";
    const entry = {
      clientMessageId: newClientMessageId(), messageType: "attachment", body: caption.trim(), senderId: myId, recipientId: String(userId), status: "sending",
      createdAt: new Date().toISOString(), attachment: { fileName: file.name, mimeType: file.type, size: file.size, kind: file.type.startsWith("image/") ? "image" : "document" },
    };
    pendingFiles.current.set(entry.clientMessageId, { file, caption: caption.trim() });
    setMessages((list) => addPending(list, entry));
    runSend(entry);
    return null;
  }, [myId, runSend, setMessages, userId]);

  const retry = useCallback((clientMessageId) => {
    const entry = messagesRef.current.find((m) => m.clientMessageId === clientMessageId && !m._id);
    if (!entry) return;
    setMessages((list) => markSending(list, clientMessageId));
    runSend({ ...entry, status: "sending" });
  }, [runSend, setMessages]);

  const discard = useCallback((clientMessageId) => {
    pendingFiles.current.delete(clientMessageId);
    setMessages((list) => list.filter((m) => !(m.clientMessageId === clientMessageId && !m._id)));
  }, [setMessages]);

  return {
    conversationKey, messages, participant, access, hasMore: paging.hasMore, loading: status.loading, loadingOlder: status.loadingOlder,
    error: status.error, peerTyping, connectionStatus, reload: load, loadOlder, send, sendAttachment, retry, discard, notifyTyping, stopTyping, markVisibleRead: acknowledgeAndRead,
  };
}

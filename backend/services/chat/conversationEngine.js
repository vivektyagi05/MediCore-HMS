// ─────────────────────────────────────────────────────────────────────────
// THE conversation engine — the one implementation of doctor↔patient
// messaging. REST controllers and Socket.IO handlers are thin transports
// over these functions; doctor and patient hubs use the same functions with
// different navigation only.
//
//   authorisation : resolveChatAccess (clinicalAccessService) — one policy
//   persistence   : chatRepository   — MongoDB is the source of truth
//   realtime      : broadcast.toUsers — fan-out to every tab/device of the
//                   participants' user rooms; never trusted as "saved"
//   files         : storageService   — private objects, metadata only in Mongo
//
// All collaborators are injected (see chatEngine.js for production wiring)
// so the SAME engine code runs against an in-memory repository in the
// socket-level tests. Nothing here logs message bodies or file contents.
// ─────────────────────────────────────────────────────────────────────────
import { ADMIN_ROLES } from "../../constants/roles.js";
import { CHAT_ERROR, CHAT_EVENTS, CHAT_LIMITS, ChatError, isObjectIdString } from "./chatConstants.js";
import { validateChatAttachment } from "./chatAttachmentService.js";

export const conversationKeyOf = (a, b) => [String(a), String(b)].sort().join(":");

const idString = (value) => String(value?._id ?? value);

const READ_ONLY_MESSAGES = Object.freeze({
  COMMUNICATION_WINDOW_EXPIRED: "The communication window for this care relationship has expired. This conversation is read-only.",
  DOCTOR_NOT_ELIGIBLE: "This doctor is not currently available for messaging. This conversation is read-only.",
});

export function serializeMessage(message) {
  const hasAttachment = Boolean(message.attachment?.mimeType);
  return {
    _id: idString(message._id),
    conversationKey: message.conversationKey,
    senderId: idString(message.senderId),
    recipientId: idString(message.recipientId),
    messageType: message.messageType || "text",
    body: message.body ?? "",
    clientMessageId: message.clientMessageId ?? null,
    sentAt: message.sentAt || message.createdAt || null,
    createdAt: message.createdAt || null,
    deliveredAt: message.deliveredAt || null,
    readAt: message.readAt || null,
    // Derived ONCE here so every client renders the same truth.
    status: message.readAt ? "read" : message.deliveredAt ? "delivered" : "sent",
    attachment: hasAttachment
      ? { fileName: message.attachment.fileName, mimeType: message.attachment.mimeType, size: message.attachment.size, kind: message.attachment.kind }
      : null,
  };
}

const previewOf = (message) => {
  if (message.messageType === "attachment" && !message.body) return message.attachment?.kind === "image" ? "Photo" : "Document";
  return String(message.body || "").slice(0, 120);
};

export function createConversationEngine(deps) {
  const {
    repo, resolveAccess, resolveAccessBatch, loadUser, loadUsers, findUserIdsByName,
    isChatEnabled, notify, markChatNotificationsRead, broadcast, storage, presenceFor,
    limiters, now = () => new Date(), log,
  } = deps;

  const typingLastStart = new Map();

  // ── guards ────────────────────────────────────────────────────────────
  const consume = (name, user) => {
    if (!limiters[name].consume(idString(user._id))) {
      throw new ChatError(CHAT_ERROR.RATE_LIMITED, "You are doing that too quickly. Please slow down.");
    }
  };

  const requireChatEnabled = async (user) => {
    // Support (super_admin) conversations are never cut off by the chat toggle.
    if (ADMIN_ROLES.includes(user.role)) return;
    if (!(await isChatEnabled(idString(user._id)))) {
      throw new ChatError(CHAT_ERROR.FEATURE_DISABLED, "Chat is currently unavailable");
    }
  };

  const requireObjectId = (value, label) => {
    if (!isObjectIdString(String(value ?? ""))) throw new ChatError(CHAT_ERROR.VALIDATION, `A valid ${label} is required`);
    return String(value);
  };

  /** Resolve the other participant + access once; `need` is "read" or "send". */
  async function openConversation(user, otherUserId, need) {
    const otherId = requireObjectId(otherUserId, "conversation participant");
    const other = await loadUser(otherId);
    const access = other ? await resolveAccess(user, other) : null;
    const allowed = access ? (need === "send" ? access.canSend : access.canRead) : false;
    if (!allowed) {
      if (access?.canRead && need === "send") {
        throw new ChatError(CHAT_ERROR.READ_ONLY, READ_ONLY_MESSAGES[access.readOnlyReason] || "This conversation is read-only.", { readOnlyReason: access.readOnlyReason });
      }
      // One uniform answer whether the user is missing or merely unrelated, so ids cannot be probed.
      log.warn("chat authorization denied", { userId: idString(user._id), otherUserId: otherId, need, reason: access?.denialReason || "NO_SUCH_USER" });
      throw new ChatError(CHAT_ERROR.FORBIDDEN, "You are not authorized to access this conversation");
    }
    return { other, access, conversationKey: conversationKeyOf(user._id, otherId) };
  }

  const accessSummary = (access) => ({
    status: access.status,
    canSend: access.canSend,
    readOnlyReason: access.readOnlyReason || null,
    readOnlyMessage: access.readOnlyReason ? READ_ONLY_MESSAGES[access.readOnlyReason] || null : null,
  });

  const validateClientMessageId = (value) => {
    if (typeof value !== "string" || !CHAT_LIMITS.CLIENT_MESSAGE_ID.test(value)) {
      throw new ChatError(CHAT_ERROR.VALIDATION, "A valid clientMessageId is required");
    }
    return value;
  };

  const validateBody = (value, { required }) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw new ChatError(CHAT_ERROR.VALIDATION, "A message is required");
    if (text.length > CHAT_LIMITS.BODY_MAX) throw new ChatError(CHAT_ERROR.VALIDATION, `Messages can be at most ${CHAT_LIMITS.BODY_MAX} characters`);
    return text;
  };

  // ── send (text) ───────────────────────────────────────────────────────
  async function afterCreate(user, other, message) {
    const payload = serializeMessage(message);
    // Both participants' rooms: the recipient's devices receive it, the
    // sender's OTHER tabs reconcile it (clients dedupe by _id / clientMessageId).
    broadcast.toUsers([user._id, other._id], CHAT_EVENTS.MESSAGE, payload);
    try {
      await notify(other._id, {
        type: "chat",
        // Generic text only: no message body, no clinical content (PHI minimisation).
        title: `New message from ${user.name || "your care team"}`,
        message: payload.attachment ? "Sent you an attachment" : "Sent you a message",
        entityType: "chat",
        entityId: message._id,
        eventKey: `chat:${idString(message._id)}`,
        actorId: user._id,
        metadata: { conversationKey: message.conversationKey },
      });
    } catch (error) {
      // The message is already durable; a notification failure must not fail the send.
      log.warn("chat notification failed", { messageId: idString(message._id), recipientId: idString(other._id), error: error?.message });
    }
    log.info("chat message accepted", { messageId: idString(message._id), conversationKey: message.conversationKey, senderId: idString(user._id), type: payload.messageType });
    return payload;
  }

  async function reconcileDuplicate(user, existing, recipientId) {
    if (idString(existing.recipientId) !== String(recipientId)) {
      throw new ChatError(CHAT_ERROR.CONFLICT, "clientMessageId was already used for a different message");
    }
    log.info("chat message duplicate reconciled", { messageId: idString(existing._id), senderId: idString(user._id) });
    return { message: serializeMessage(existing), duplicate: true };
  }

  async function sendMessage(user, { recipientId, body, clientMessageId } = {}) {
    consume("send", user);
    await requireChatEnabled(user);
    const cid = validateClientMessageId(clientMessageId);
    const { other, conversationKey } = await openConversation(user, recipientId, "send");
    const text = validateBody(body, { required: true });

    const existing = await repo.findByClientMessageId(user._id, cid);
    if (existing) return reconcileDuplicate(user, existing, other._id);

    const { message, created } = await repo.insert({
      conversationKey, senderId: user._id, recipientId: other._id, messageType: "text", body: text, clientMessageId: cid, sentAt: now(),
    });
    if (!created) return reconcileDuplicate(user, message, other._id);
    return { message: await afterCreate(user, other, message), duplicate: false };
  }

  // ── send (attachment) ─────────────────────────────────────────────────
  async function sendAttachment(user, { recipientId, clientMessageId, caption, file } = {}) {
    consume("upload", user);
    await requireChatEnabled(user);
    const cid = validateClientMessageId(clientMessageId);
    const { other, conversationKey } = await openConversation(user, recipientId, "send");
    const text = validateBody(caption, { required: false });

    const existing = await repo.findByClientMessageId(user._id, cid);
    if (existing) return reconcileDuplicate(user, existing, other._id);

    let meta;
    try {
      meta = validateChatAttachment({ originalName: file?.originalname, declaredMimeType: file?.mimetype, buffer: file?.buffer });
    } catch (error) {
      log.warn("chat attachment rejected", { userId: idString(user._id), code: error.code, size: file?.buffer?.length ?? 0 });
      throw error;
    }

    let stored;
    try {
      stored = await storage.upload("chat-attachments", file.buffer, { originalName: meta.fileName, contentType: meta.mimeType });
    } catch (error) {
      log.error("chat attachment storage failed", { userId: idString(user._id), error: error?.message });
      throw new ChatError(CHAT_ERROR.STORAGE_UNAVAILABLE, "The file could not be stored right now. Please try again.");
    }

    const discardStoredObject = async () => {
      try {
        await storage.delete(stored.key);
      } catch (cleanupError) {
        log.error("chat attachment orphan cleanup failed", { error: cleanupError?.message });
      }
    };

    let inserted;
    try {
      inserted = await repo.insert({
        conversationKey, senderId: user._id, recipientId: other._id, messageType: "attachment", body: text, clientMessageId: cid, sentAt: now(),
        attachment: { storageKey: stored.key, fileName: meta.fileName, mimeType: meta.mimeType, size: meta.size, kind: meta.kind },
      });
    } catch (error) {
      await discardStoredObject();
      throw error;
    }
    if (!inserted.created) {
      await discardStoredObject(); // a concurrent identical request won; its object is the one referenced
      return reconcileDuplicate(user, inserted.message, other._id);
    }
    return { message: await afterCreate(user, other, inserted.message), duplicate: false };
  }

  async function downloadAttachment(user, messageId) {
    const id = requireObjectId(messageId, "message id");
    const notFound = () => new ChatError(CHAT_ERROR.NOT_FOUND, "Attachment not found");
    const message = await repo.findById(id, { withAttachmentKey: true });
    if (!message?.attachment?.storageKey) throw notFound();

    const me = idString(user._id);
    const senderId = idString(message.senderId);
    const recipientId = idString(message.recipientId);
    if (me !== senderId && me !== recipientId) {
      log.warn("chat attachment access denied", { userId: me, messageId: id });
      throw notFound();
    }
    const otherId = me === senderId ? recipientId : senderId;
    const { conversationKey } = await openConversation(user, otherId, "read");
    if (conversationKey !== message.conversationKey) throw notFound();

    try {
      const buffer = await storage.read(message.attachment.storageKey);
      return { buffer, mimeType: message.attachment.mimeType, fileName: message.attachment.fileName, kind: message.attachment.kind };
    } catch (error) {
      if (error?.name === "StorageNotFoundError") throw new ChatError(CHAT_ERROR.NOT_FOUND, "This attachment is no longer available");
      log.error("chat attachment read failed", { messageId: id, error: error?.message });
      throw new ChatError(CHAT_ERROR.STORAGE_UNAVAILABLE, "The file could not be retrieved right now. Please try again.");
    }
  }

  // ── history / sync ────────────────────────────────────────────────────
  async function getHistory(user, { userId, before, limit } = {}) {
    const { other, access, conversationKey } = await openConversation(user, userId, "read");
    const pageSize = Math.min(Math.max(Number(limit) || CHAT_LIMITS.HISTORY_PAGE_DEFAULT, 1), CHAT_LIMITS.HISTORY_PAGE_MAX);
    if (before !== undefined && before !== null && before !== "") requireObjectId(before, "cursor");

    const rows = await repo.listBefore(conversationKey, before || null, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize).reverse(); // oldest -> newest for rendering
    return {
      conversationKey,
      participant: { _id: idString(other._id), name: other.name, role: other.role },
      access: accessSummary(access),
      messages: page.map(serializeMessage),
      hasMore,
      nextBefore: hasMore && page.length ? idString(page[0]._id) : null,
    };
  }

  /** Mark undelivered messages addressed to `user` as delivered and tell the sender. */
  async function deliverIds(user, otherId, conversationKey, ids) {
    const undelivered = await repo.findUndeliveredIds(conversationKey, user._id, ids, CHAT_LIMITS.RECEIPT_IDS_MAX);
    if (!undelivered.length) return { messageIds: [], deliveredAt: null };
    const at = now();
    await repo.markDelivered(undelivered, user._id, at);
    broadcast.toUsers([otherId], CHAT_EVENTS.DELIVERED, { conversationKey, messageIds: undelivered, deliveredAt: at });
    return { messageIds: undelivered, deliveredAt: at };
  }

  async function acknowledgeDelivered(user, { userId, messageIds } = {}) {
    consume("receipt", user);
    const { other, conversationKey } = await openConversation(user, userId, "read");
    const ids = Array.isArray(messageIds) ? messageIds.slice(0, CHAT_LIMITS.RECEIPT_IDS_MAX) : [];
    if (!ids.length || !ids.every((id) => isObjectIdString(String(id)))) {
      throw new ChatError(CHAT_ERROR.VALIDATION, "messageIds must be a non-empty list of valid ids");
    }
    return deliverIds(user, idString(other._id), conversationKey, ids.map(String));
  }

  async function markRead(user, { userId, upToMessageId } = {}) {
    consume("receipt", user);
    const { other, conversationKey } = await openConversation(user, userId, "read");
    if (upToMessageId) requireObjectId(upToMessageId, "message id");
    const ids = await repo.findUnreadIds(conversationKey, user._id, upToMessageId || null, CHAT_LIMITS.RECEIPT_IDS_MAX);
    const at = now();
    if (ids.length) {
      await repo.markRead(ids, user._id, at);
      broadcast.toUsers([user._id, other._id], CHAT_EVENTS.READ, { conversationKey, readerId: idString(user._id), messageIds: ids, readAt: at });
    }
    // Chat notifications for this conversation are now stale; keep the bell consistent with the thread.
    let notificationsCleared = 0;
    try {
      notificationsCleared = await markChatNotificationsRead(user._id, conversationKey, at);
    } catch (error) {
      log.warn("chat notification read-sync failed", { userId: idString(user._id), error: error?.message });
    }
    const unreadCount = await repo.countUnread(user._id, conversationKey);
    return { conversationKey, messageIds: ids, readAt: ids.length ? at : null, unreadCount, notificationsCleared };
  }

  async function syncConversation(user, { userId, afterMessageId, knownOutgoingIds } = {}) {
    consume("sync", user);
    const { other, access, conversationKey } = await openConversation(user, userId, "read");
    const otherId = idString(other._id);
    if (afterMessageId) requireObjectId(afterMessageId, "cursor");
    const known = (Array.isArray(knownOutgoingIds) ? knownOutgoingIds : []).slice(0, CHAT_LIMITS.SYNC_KNOWN_IDS_MAX);
    if (!known.every((id) => isObjectIdString(String(id)))) throw new ChatError(CHAT_ERROR.VALIDATION, "knownOutgoingIds must be valid ids");

    let rows;
    let hasMore = false;
    if (afterMessageId) {
      rows = await repo.listAfter(conversationKey, afterMessageId, CHAT_LIMITS.SYNC_PAGE_MAX + 1);
      hasMore = rows.length > CHAT_LIMITS.SYNC_PAGE_MAX;
      rows = rows.slice(0, CHAT_LIMITS.SYNC_PAGE_MAX);
    } else {
      rows = (await repo.listBefore(conversationKey, null, CHAT_LIMITS.HISTORY_PAGE_DEFAULT)).reverse();
    }

    // Receiving the message through a sync is the delivery acknowledgement for offline recipients.
    const incomingIds = rows.filter((row) => idString(row.recipientId) === idString(user._id) && !row.deliveredAt).map((row) => idString(row._id));
    const delivered = incomingIds.length ? await deliverIds(user, otherId, conversationKey, incomingIds) : { messageIds: [], deliveredAt: null };
    const deliveredSet = new Set(delivered.messageIds);
    const messages = rows.map((row) => serializeMessage(deliveredSet.has(idString(row._id)) ? { ...row, deliveredAt: delivered.deliveredAt } : row));

    const updates = (await repo.findStates(conversationKey, known)).map((row) => ({
      _id: idString(row._id), deliveredAt: row.deliveredAt || null, readAt: row.readAt || null, status: row.readAt ? "read" : row.deliveredAt ? "delivered" : "sent",
    }));
    const unreadCount = await repo.countUnread(user._id, conversationKey);
    log.info("chat sync", { userId: idString(user._id), conversationKey, returned: messages.length, deliveredNow: delivered.messageIds.length });
    return { conversationKey, messages, updates, hasMore, access: accessSummary(access), unreadCount };
  }

  // ── typing ────────────────────────────────────────────────────────────
  async function typing(user, { userId, active } = {}) {
    consume("typing", user);
    await requireChatEnabled(user);
    const { other, conversationKey } = await openConversation(user, userId, "send");
    const key = `${idString(user._id)}:${conversationKey}`;
    if (active) {
      const t = Date.now();
      if (t - (typingLastStart.get(key) || 0) < 1000) return { conversationKey, emitted: false }; // server-side throttle
      typingLastStart.set(key, t);
    } else {
      typingLastStart.delete(key);
    }
    broadcast.toUsers([other._id], active ? CHAT_EVENTS.TYPING_START : CHAT_EVENTS.TYPING_STOP, { conversationKey, senderId: idString(user._id) });
    return { conversationKey, emitted: true, otherUserId: idString(other._id) };
  }

  // ── conversation list / unread ────────────────────────────────────────
  async function listConversations(user, { limit, cursor, search, unreadOnly } = {}) {
    const pageSize = Math.min(Math.max(Number(limit) || CHAT_LIMITS.CONVERSATION_PAGE_DEFAULT, 1), CHAT_LIMITS.CONVERSATION_PAGE_MAX);
    if (cursor) requireObjectId(cursor, "cursor");

    let onlyKeys;
    const term = typeof search === "string" ? search.trim().slice(0, 60) : "";
    if (term) {
      const ids = await findUserIdsByName(term, 200);
      if (!ids.length) return { items: [], nextCursor: null };
      onlyKeys = ids.map((id) => conversationKeyOf(user._id, id));
    }

    const rows = await repo.aggregateConversations(user._id, { cursorId: cursor || null, limit: pageSize + 1, onlyKeys, unreadOnly: Boolean(unreadOnly) });
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);
    const me = idString(user._id);
    const otherIdOf = (row) => row._id.split(":").find((part) => part !== me);

    const others = (await loadUsers(pageRows.map(otherIdOf).filter(Boolean))).filter(Boolean);
    const accessByUser = await resolveAccessBatch(user, others);
    const presence = await presenceFor(others.map((o) => idString(o._id)));
    const otherById = new Map(others.map((o) => [idString(o._id), o]));

    const items = [];
    for (const row of pageRows) {
      const other = otherById.get(otherIdOf(row));
      const access = other && accessByUser.get(idString(other._id));
      if (!other || !access?.canRead) continue; // the same read policy REST history / socket join enforce
      const presenceInfo = presence.get(idString(other._id)) || { online: false, lastSeenAt: null };
      items.push({
        conversationKey: row._id,
        participant: { _id: idString(other._id), name: other.name, role: other.role, online: presenceInfo.online, lastSeenAt: presenceInfo.lastSeenAt },
        lastMessage: {
          _id: idString(row.lastMessage._id),
          senderId: idString(row.lastMessage.senderId),
          preview: previewOf(row.lastMessage),
          messageType: row.lastMessage.messageType || "text",
          createdAt: row.lastMessage.createdAt,
          status: row.lastMessage.readAt ? "read" : row.lastMessage.deliveredAt ? "delivered" : "sent",
        },
        lastMessageAt: row.lastMessage.createdAt,
        unreadCount: row.unreadCount,
        communicationStatus: access.status,
        canSend: access.canSend,
        readOnlyReason: access.readOnlyReason || null,
      });
    }
    return { items, nextCursor: hasMore && pageRows.length ? idString(pageRows[pageRows.length - 1].lastId) : null };
  }

  async function unreadSummary(user) {
    return { unreadMessages: await repo.countUnread(user._id) };
  }

  return {
    sendMessage, sendAttachment, downloadAttachment, getHistory, syncConversation,
    acknowledgeDelivered, markRead, typing, listConversations, unreadSummary,
    openConversation,
  };
}

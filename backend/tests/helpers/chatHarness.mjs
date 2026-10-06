// Test harness for the conversation engine. It runs the REAL engine, the REAL
// access-policy functions (evaluateChatAccess / summarizeChatRelationship) and
// the REAL chat-attachment validation. Only persistence (an in-memory
// repository with the same contract as services/chat/chatRepository.js) and
// storage are substituted, because no MongoDB is reachable in this sandbox.
// What this does NOT prove: the Mongo queries/indexes themselves.
import mongoose from "mongoose";
import {
  CHAT_ACTIVE_STATUSES, CHAT_FOLLOWUP_STATUSES, evaluateChatAccess, summarizeChatRelationship,
} from "../../services/clinicalAccessService.js";
import { createConversationEngine, conversationKeyOf } from "../../services/chat/conversationEngine.js";
import { createSlidingWindowLimiter } from "../../services/chat/slidingWindowLimiter.js";

export const newId = () => new mongoose.Types.ObjectId();
const s = (v) => String(v?._id ?? v);

export function createInMemoryRepo() {
  const rows = [];
  let clock = Date.now();
  const stamp = () => new Date((clock += 5));
  const repo = {
    rows,
    failNextInsert: null,
    async findById(id, { withAttachmentKey = false } = {}) {
      const row = rows.find((r) => s(r._id) === s(id));
      if (!row) return null;
      // Shallow copy: structuredClone would corrupt ObjectId instances.
      const copy = { ...row, attachment: row.attachment ? { ...row.attachment } : row.attachment };
      if (!withAttachmentKey && copy.attachment) delete copy.attachment.storageKey;
      return copy;
    },
    async findByClientMessageId(senderId, cid) {
      return rows.find((r) => s(r.senderId) === s(senderId) && r.clientMessageId === cid) || null;
    },
    async insert(doc) {
      if (repo.failNextInsert) { const e = repo.failNextInsert; repo.failNextInsert = null; throw e; }
      // unique (senderId, clientMessageId) — emulates the partial unique index (E11000 path)
      const dup = doc.clientMessageId && rows.find((r) => s(r.senderId) === s(doc.senderId) && r.clientMessageId === doc.clientMessageId);
      if (dup) return { message: dup, created: false };
      const createdAt = stamp();
      const row = { ...doc, _id: newId(), createdAt, updatedAt: createdAt, deliveredAt: null, readAt: null };
      rows.push(row);
      return { message: row, created: true };
    },
    async listBefore(key, beforeId, limit) {
      return rows.filter((r) => r.conversationKey === key && (!beforeId || s(r._id) < s(beforeId))).sort((a, b) => (s(a._id) < s(b._id) ? 1 : -1)).slice(0, limit);
    },
    async listAfter(key, afterId, limit) {
      return rows.filter((r) => r.conversationKey === key && s(r._id) > s(afterId)).sort((a, b) => (s(a._id) < s(b._id) ? -1 : 1)).slice(0, limit);
    },
    async findStates(key, ids) {
      return rows.filter((r) => r.conversationKey === key && ids.map(s).includes(s(r._id)));
    },
    async findUndeliveredIds(key, recipientId, ids, limit) {
      return rows.filter((r) => r.conversationKey === key && s(r.recipientId) === s(recipientId) && !r.deliveredAt && (!ids?.length || ids.map(s).includes(s(r._id))))
        .sort((a, b) => (s(a._id) < s(b._id) ? -1 : 1)).slice(0, limit).map((r) => s(r._id));
    },
    async markDelivered(ids, recipientId, at) {
      for (const r of rows) if (ids.map(s).includes(s(r._id)) && s(r.recipientId) === s(recipientId) && !r.deliveredAt) r.deliveredAt = at;
    },
    async findUnreadIds(key, recipientId, upToId, limit) {
      return rows.filter((r) => r.conversationKey === key && s(r.recipientId) === s(recipientId) && !r.readAt && (!upToId || s(r._id) <= s(upToId)))
        .sort((a, b) => (s(a._id) < s(b._id) ? -1 : 1)).slice(0, limit).map((r) => s(r._id));
    },
    async markRead(ids, recipientId, at) {
      for (const r of rows) {
        if (ids.map(s).includes(s(r._id)) && s(r.recipientId) === s(recipientId)) { if (!r.deliveredAt) r.deliveredAt = at; if (!r.readAt) r.readAt = at; }
      }
    },
    async countUnread(recipientId, key) {
      return rows.filter((r) => s(r.recipientId) === s(recipientId) && !r.readAt && (!key || r.conversationKey === key)).length;
    },
    async aggregateConversations(userId, { cursorId, limit, onlyKeys, unreadOnly }) {
      const mine = rows.filter((r) => (s(r.senderId) === s(userId) || s(r.recipientId) === s(userId)) && (!onlyKeys || onlyKeys.includes(r.conversationKey)));
      const groups = new Map();
      for (const r of mine.sort((a, b) => (s(a._id) < s(b._id) ? 1 : -1))) {
        if (!groups.has(r.conversationKey)) groups.set(r.conversationKey, { _id: r.conversationKey, lastMessage: r, lastId: r._id, unreadCount: 0 });
        if (s(r.recipientId) === s(userId) && !r.readAt) groups.get(r.conversationKey).unreadCount += 1;
      }
      let out = [...groups.values()];
      if (unreadOnly) out = out.filter((g) => g.unreadCount > 0);
      if (cursorId) out = out.filter((g) => s(g.lastId) < s(cursorId));
      return out.sort((a, b) => (s(a.lastId) < s(b.lastId) ? 1 : -1)).slice(0, limit);
    },
  };
  return repo;
}

export function createStorageDouble() {
  const objects = new Map();
  let n = 0;
  return {
    objects,
    failUpload: false,
    failRead: false,
    async upload(category, buffer) {
      if (this.failUpload) throw new Error("simulated storage outage");
      const key = `${category}/obj-${(n += 1)}`;
      objects.set(key, Buffer.from(buffer));
      return { key, size: buffer.length };
    },
    async read(key) {
      if (this.failRead) throw new Error("simulated storage read failure");
      if (!objects.has(key)) { const e = new Error("missing"); e.name = "StorageNotFoundError"; throw e; }
      return objects.get(key);
    },
    async delete(key) { objects.delete(key); },
  };
}

/**
 * relationships: [{ doctor, patient, appointments:[{status,date}], doctorEligible?: boolean }]
 * Access is computed with the REAL pure policy, never a hand-written boolean.
 */
export function createAccessDouble(relationships, { now = () => Date.now() } = {}) {
  const evaluate = (requester, other) => {
    if (requester.isActive === false || other.isActive === false) return { status: "none", canRead: false, canSend: false, readOnlyReason: null, denialReason: "ACCOUNT_INACTIVE" };
    if (s(requester) === s(other)) return { status: "none", canRead: false, canSend: false, readOnlyReason: null, denialReason: "INVALID_PARTICIPANTS" };
    if (requester.role === "super_admin" || other.role === "super_admin") return { status: "active", canRead: true, canSend: true, readOnlyReason: null, denialReason: null, adminSupport: true };
    const doctor = requester.role === "doctor" ? requester : other.role === "doctor" ? other : null;
    const patient = requester.role === "patient" ? requester : other.role === "patient" ? other : null;
    const rel = doctor && patient && relationships.find((r) => s(r.doctor) === s(doctor) && s(r.patient) === s(patient));
    return evaluateChatAccess({
      summary: summarizeChatRelationship(rel?.appointments || []),
      doctorEligible: rel?.doctorEligible !== false,
      requesterIsDoctor: requester.role === "doctor",
      now: now(),
    });
  };
  return {
    resolveAccess: async (a, b) => evaluate(a, b),
    resolveAccessBatch: async (requester, others) => new Map(others.map((o) => [s(o), evaluate(requester, o)])),
  };
}

export function createEngineHarness({ users, relationships, broadcastSink, chatEnabled = true, limits } = {}) {
  const repo = createInMemoryRepo();
  const storage = createStorageDouble();
  const access = createAccessDouble(relationships);
  const notifications = [];
  const broadcasts = [];
  const logs = [];
  const log = { info: (m, x) => logs.push(["info", m, x]), warn: (m, x) => logs.push(["warn", m, x]), error: (m, x) => logs.push(["error", m, x]) };
  const byId = new Map(users.map((u) => [s(u), u]));
  const lim = { send: [100, 10_000], upload: [100, 10_000], receipt: [1000, 10_000], sync: [1000, 10_000], typing: [1000, 10_000], ...(limits || {}) };
  const state = { chatEnabled, notifyFails: false };
  const engine = createConversationEngine({
    repo, storage, log,
    resolveAccess: access.resolveAccess,
    resolveAccessBatch: access.resolveAccessBatch,
    loadUser: async (id) => byId.get(String(id)) || null,
    loadUsers: async (ids) => ids.map((id) => byId.get(String(id)) || null),
    findUserIdsByName: async (term) => users.filter((u) => u.name.toLowerCase().includes(term.toLowerCase())).map(s),
    isChatEnabled: async () => state.chatEnabled,
    notify: async (userId, payload) => { if (state.notifyFails) throw new Error("notification store down"); notifications.push({ userId: s(userId), ...payload }); },
    markChatNotificationsRead: async () => 0,
    broadcast: { toUsers(ids, event, payload) { broadcasts.push({ ids: ids.map(s), event, payload }); broadcastSink?.(ids.map(s), event, payload); } },
    presenceFor: async (ids) => new Map(ids.map((id) => [id, { online: false, lastSeenAt: null }])),
    limiters: Object.fromEntries(Object.entries(lim).map(([k, [max, windowMs]]) => [k, createSlidingWindowLimiter({ windowMs, max })])),
  });
  return { engine, repo, storage, notifications, broadcasts, logs, state, conversationKeyOf };
}

export const makeUsers = () => ({
  doctor: { _id: newId(), role: "doctor", name: "Dr. Asha Rao", isActive: true },
  patient: { _id: newId(), role: "patient", name: "Ravi Kumar", isActive: true },
  otherPatient: { _id: newId(), role: "patient", name: "Meera Shah", isActive: true },
  otherDoctor: { _id: newId(), role: "doctor", name: "Dr. Vikram Sen", isActive: true },
  admin: { _id: newId(), role: "super_admin", name: "Support", isActive: true },
});

export const DAY = 24 * 60 * 60 * 1000;
export const ACTIVE_APPT = { status: "payment_completed", date: new Date() };
export const EXPIRED_APPT = { status: "completed", date: new Date(Date.now() - 90 * DAY) };
export const RECENT_DONE_APPT = { status: "completed", date: new Date(Date.now() - 3 * DAY) };
export const statuses = { CHAT_ACTIVE_STATUSES, CHAT_FOLLOWUP_STATUSES };

// Minimal real image/PDF byte fixtures.
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n");

// ─────────────────────────────────────────────────────────────────────────
// MongoDB persistence for chat. The ONLY module that touches ChatMessage.
// Every mutation is a conditional/atomic update (no read→check→write races):
//  - insert           unique (senderId, clientMessageId) index is the
//                     idempotency boundary; E11000 is resolved by returning
//                     the already-stored message
//  - markDelivered    only rows with deliveredAt == null, addressed to the reader
//  - markRead         only rows with readAt == null, addressed to the reader;
//                     delivered is set FIRST so "read but not delivered" can
//                     never be observed
// The engine takes this repository by injection so the exact same engine
// code runs against an in-memory implementation in socket-level tests.
// ─────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import ChatMessage from "../../models/ChatMessage.js";

const oid = (value) => new mongoose.Types.ObjectId(String(value));

export const chatRepository = {
  async findById(id, { withAttachmentKey = false } = {}) {
    const query = ChatMessage.findById(id);
    if (withAttachmentKey) query.select("+attachment.storageKey");
    return query.lean();
  },

  async findByClientMessageId(senderId, clientMessageId) {
    return ChatMessage.findOne({ senderId, clientMessageId }).lean();
  },

  /** @returns {Promise<{ message: object, created: boolean }>} */
  async insert(doc) {
    try {
      const created = await ChatMessage.create(doc);
      return { message: created.toObject(), created: true };
    } catch (error) {
      if (error?.code === 11000 && doc.clientMessageId) {
        const existing = await ChatMessage.findOne({ senderId: doc.senderId, clientMessageId: doc.clientMessageId }).lean();
        if (existing) return { message: existing, created: false };
      }
      throw error;
    }
  },

  /** Newest-first page strictly older than `beforeId`. Returns up to `limit` rows (descending). */
  async listBefore(conversationKey, beforeId, limit) {
    const filter = { conversationKey };
    if (beforeId) filter._id = { $lt: oid(beforeId) };
    return ChatMessage.find(filter).sort({ _id: -1 }).limit(limit).lean();
  },

  /** Oldest-first page strictly newer than `afterId`. */
  async listAfter(conversationKey, afterId, limit) {
    return ChatMessage.find({ conversationKey, _id: { $gt: oid(afterId) } }).sort({ _id: 1 }).limit(limit).lean();
  },

  /** Current delivery/read state of specific messages (sync reconciliation). */
  async findStates(conversationKey, ids) {
    if (!ids.length) return [];
    return ChatMessage.find({ conversationKey, _id: { $in: ids.map(oid) } }).select("_id deliveredAt readAt").lean();
  },

  /** Ids of undelivered messages addressed to `recipientId` in the conversation, optionally restricted to `ids`. */
  async findUndeliveredIds(conversationKey, recipientId, ids, limit) {
    const filter = { conversationKey, recipientId, deliveredAt: null };
    if (ids?.length) filter._id = { $in: ids.map(oid) };
    const rows = await ChatMessage.find(filter).sort({ _id: 1 }).limit(limit).select("_id").lean();
    return rows.map((row) => String(row._id));
  },

  async markDelivered(ids, recipientId, at) {
    if (!ids.length) return;
    await ChatMessage.updateMany({ _id: { $in: ids.map(oid) }, recipientId, deliveredAt: null }, { $set: { deliveredAt: at } });
  },

  async findUnreadIds(conversationKey, recipientId, upToId, limit) {
    const filter = { conversationKey, recipientId, readAt: null };
    if (upToId) filter._id = { $lte: oid(upToId) };
    const rows = await ChatMessage.find(filter).sort({ _id: 1 }).limit(limit).select("_id").lean();
    return rows.map((row) => String(row._id));
  },

  async markRead(ids, recipientId, at) {
    if (!ids.length) return;
    const objectIds = ids.map(oid);
    await ChatMessage.updateMany({ _id: { $in: objectIds }, recipientId, deliveredAt: null }, { $set: { deliveredAt: at } });
    await ChatMessage.updateMany({ _id: { $in: objectIds }, recipientId, readAt: null }, { $set: { readAt: at } });
  },

  async countUnread(recipientId, conversationKey) {
    const filter = { recipientId, readAt: null };
    if (conversationKey) filter.conversationKey = conversationKey;
    return ChatMessage.countDocuments(filter);
  },

  /**
   * One aggregation for the whole page (no N+1): newest-first conversations
   * with last message + unread count. Cursor = last message id of the
   * previous page's final conversation.
   */
  async aggregateConversations(userId, { cursorId, limit, onlyKeys, unreadOnly }) {
    const me = oid(userId);
    const match = { $or: [{ senderId: me }, { recipientId: me }] };
    if (onlyKeys) match.conversationKey = { $in: onlyKeys };
    const pipeline = [
      { $match: match },
      { $sort: { _id: -1 } },
      {
        $group: {
          _id: "$conversationKey",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: { $cond: [{ $and: [{ $eq: ["$recipientId", me] }, { $eq: [{ $ifNull: ["$readAt", null] }, null] }] }, 1, 0] },
          },
        },
      },
      { $addFields: { lastId: "$lastMessage._id" } },
    ];
    if (unreadOnly) pipeline.push({ $match: { unreadCount: { $gt: 0 } } });
    if (cursorId) pipeline.push({ $match: { lastId: { $lt: oid(cursorId) } } });
    pipeline.push({ $sort: { lastId: -1 } }, { $limit: limit });
    pipeline.push({ $project: { "lastMessage.attachment.storageKey": 0, "lastMessage.metadata": 0, "lastMessage.__v": 0 } });
    return ChatMessage.aggregate(pipeline);
  },
};

// Production wiring of the ONE conversation engine (see conversationEngine.js).
import mongoose from "mongoose";
import NotificationDelivery from "../../models/NotificationDelivery.js";
import OnlineSession from "../../models/OnlineSession.js";
import User from "../../models/User.js";
import { logger } from "../../utils/logger.js";
import { notificationEmitter } from "../../realtime/notificationEmitter.js";
import { presenceManager } from "../../socket/presenceManager.js";
import { roomManager } from "../../socket/roomManager.js";
import { getIO } from "../../socket/socketServer.js";
import { storageService } from "../../storage/storageService.js";
import { isFeatureEnabled } from "../featureToggleService.js";
import { resolveChatAccess, resolveChatAccessBatch } from "../clinicalAccessService.js";
import { chatRepository } from "./chatRepository.js";
import { createConversationEngine } from "./conversationEngine.js";
import { createSlidingWindowLimiter } from "./slidingWindowLimiter.js";
import { findUserIdsByName, listChatContacts } from "./chatDirectoryService.js";

const USER_FIELDS = "_id name role isActive";

export const loadUser = (id) => User.findById(id).select(USER_FIELDS).lean();
export const loadUsers = (ids) => (ids.length ? User.find({ _id: { $in: ids } }).select(USER_FIELDS).lean() : []);

/** online = a live socket on THIS process; lastSeenAt = most recent recorded activity. */
export async function presenceFor(userIds) {
  const result = new Map();
  if (!userIds.length) return result;
  const rows = await OnlineSession.aggregate([
    { $match: { userId: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: "$userId", lastSeenAt: { $max: "$lastActiveAt" } } },
  ]);
  const seen = new Map(rows.map((row) => [String(row._id), row.lastSeenAt]));
  for (const id of userIds) result.set(id, { online: presenceManager.isOnline(id), lastSeenAt: seen.get(id) || null });
  return result;
}

export const chatBroadcast = {
  toUsers(userIds, event, payload) {
    const io = getIO();
    if (!io) return;
    let target = io;
    for (const id of new Set(userIds.map(String))) target = target.to(roomManager.userRoom(id));
    target.emit(event, payload); // one emit; socket.io de-duplicates sockets present in several rooms
  },
};

export const chatLimiters = {
  send: createSlidingWindowLimiter({ windowMs: 10_000, max: 20 }),
  upload: createSlidingWindowLimiter({ windowMs: 60_000, max: 10 }),
  receipt: createSlidingWindowLimiter({ windowMs: 10_000, max: 60 }),
  sync: createSlidingWindowLimiter({ windowMs: 10_000, max: 15 }),
  typing: createSlidingWindowLimiter({ windowMs: 10_000, max: 40 }),
};

export const chatEngine = createConversationEngine({
  repo: chatRepository,
  resolveAccess: resolveChatAccess,
  resolveAccessBatch: resolveChatAccessBatch,
  loadUser,
  loadUsers,
  findUserIdsByName,
  isChatEnabled: (userId) => isFeatureEnabled("chat", { userId }),
  notify: (userId, payload) => notificationEmitter.emitToUser(userId, payload),
  markChatNotificationsRead: async (userId, conversationKey, at) => {
    const result = await NotificationDelivery.updateMany(
      { recipientId: userId, type: "chat", "metadata.conversationKey": conversationKey, readAt: { $exists: false } },
      { $set: { readAt: at } },
    );
    return result.modifiedCount ?? 0;
  },
  broadcast: chatBroadcast,
  storage: storageService,
  presenceFor,
  limiters: chatLimiters,
  log: logger,
});

export const listContactsFor = (user, options) => listChatContacts(user, { ...options, presenceFor });

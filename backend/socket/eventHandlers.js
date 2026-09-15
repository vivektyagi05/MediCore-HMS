import ChatMessage from "../models/ChatMessage.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import User from "../models/User.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { presenceManager } from "./presenceManager.js";
import { roomManager } from "./roomManager.js";
import { wrapAsyncSocketHandler } from "./asyncSocketHandler.js";
import { usersCanChat } from "../utils/chatAuthorization.js";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 40;

const eventCounters = new Map();

const checkRateLimit = (socket, eventName) => {
  const key = `${socket.id}:${eventName}`;
  const now = Date.now();
  const entry = eventCounters.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  entry.count += 1;
  eventCounters.set(key, entry);
  return entry.count <= RATE_LIMIT_MAX;
};

const assertAllowedEvent = (socket, eventName) => {
  if (!checkRateLimit(socket, eventName)) {
    socket.emit("realtime:error", { message: "Too many realtime events. Please slow down." });
    return false;
  }
  return true;
};

// BUGFIX (stability): rate limiter entries were created per socketId:eventName
// and never removed, other than being overwritten on the next event for that
// same key. A socket that fires many distinct event names (or reconnects
// often, minting new socket ids) grows this Map forever for the life of the
// process. Sweep expired entries periodically so it can't become an
// unbounded memory leak under sustained real usage.
const RATE_LIMIT_SWEEP_MS = 60_000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of eventCounters) {
    if (entry.resetAt < now) eventCounters.delete(key);
  }
}, RATE_LIMIT_SWEEP_MS);
sweepTimer.unref?.();

export const registerEventHandlers = (io, socket) => {
  const on = (eventName, handler) => socket.on(eventName, wrapAsyncSocketHandler(socket, eventName, handler));

  on("room:join", async (payload, ack) => {
    if (!assertAllowedEvent(socket, "room:join")) return;
    const room = payload?.room;
    if (typeof room !== "string" || !room) {
      ack?.({ success: false, message: "A valid room is required" });
      return;
    }
    const allowed = await roomManager.canJoinRoom(socket.user, room);
    if (!allowed) {
      ack?.({ success: false, message: "You are not allowed to join this room" });
      return;
    }
    await socket.join(room);
    ack?.({ success: true, room });
  });

  on("room:leave", async (payload, ack) => {
    const room = payload?.room;
    if (typeof room !== "string" || !room) {
      ack?.({ success: false, message: "A valid room is required" });
      return;
    }
    await socket.leave(room);
    ack?.({ success: true, room });
  });

  on("presence:ping", async (_payload, ack) => {
    if (!assertAllowedEvent(socket, "presence:ping")) return;
    await presenceManager.heartbeat(socket);
    ack?.({ success: true, serverTime: new Date() });
  });

  on("notification:read", async (payload, ack) => {
    if (!assertAllowedEvent(socket, "notification:read")) return;
    const notificationId = payload?.notificationId;
    if (typeof notificationId !== "string" || !notificationId) {
      ack?.({ success: false, message: "A valid notificationId is required" });
      return;
    }
    const notification = await NotificationDelivery.findOneAndUpdate(
      { _id: notificationId, recipientId: socket.user._id },
      { readAt: new Date() },
      { returnDocument: "after" },
    );
    ack?.({ success: Boolean(notification), notification });
  });

  on("chat:typing:start", async (payload) => {
    if (!assertAllowedEvent(socket, "chat:typing:start")) return;
    const { recipientId, appointmentId } = payload || {};
    if (!recipientId) return;
    const conversationKey = roomManager.conversationKey(socket.user._id, recipientId);
    socket.to(roomManager.conversationRoom(conversationKey)).emit("chat:typing:start", {
      senderId: socket.user._id,
      recipientId,
      appointmentId,
    });
  });

  on("chat:typing:stop", async (payload) => {
    if (!assertAllowedEvent(socket, "chat:typing:stop")) return;
    const { recipientId, appointmentId } = payload || {};
    if (!recipientId) return;
    const conversationKey = roomManager.conversationKey(socket.user._id, recipientId);
    socket.to(roomManager.conversationRoom(conversationKey)).emit("chat:typing:stop", {
      senderId: socket.user._id,
      recipientId,
      appointmentId,
    });
  });

  on("chat:send", async (payload, ack) => {
    if (!assertAllowedEvent(socket, "chat:send")) return;
    const { recipientId, body, appointmentId } = payload || {};
    if (!recipientId || !body?.trim()) {
      ack?.({ success: false, message: "Recipient and message are required" });
      return;
    }

    const recipient = await User.findById(recipientId).select("_id isActive role").lean();
    if (!recipient?.isActive) {
      ack?.({ success: false, message: "Recipient is not available" });
      return;
    }

    // BUGFIX (DOC-03, real security gap): sending a message previously had
    // no relationship check at all beyond "recipient account is active" —
    // any authenticated user could message any other user on the
    // platform. Now requires a real doctor-patient relationship (or an
    // admin participant), via the same shared check roomManager and
    // getConversation use.
    const allowed = await usersCanChat(socket.user, recipient);
    if (!allowed) {
      ack?.({ success: false, message: "You are not authorized to message this user" });
      return;
    }

    const conversationKey = roomManager.conversationKey(socket.user._id, recipientId);
    const room = roomManager.conversationRoom(conversationKey);
    await socket.join(room);

    const message = await ChatMessage.create({
      conversationKey,
      appointmentId,
      senderId: socket.user._id,
      recipientId,
      body: body.trim(),
      deliveredAt: new Date(),
    });

    io.to(room).to(roomManager.userRoom(recipientId)).emit("chat:message", message);
    await notificationEmitter.emitToUser(recipientId, {
      type: "chat",
      title: `New message from ${socket.user.name}`,
      message: body.trim().slice(0, 160),
      entityType: "chat",
      entityId: message._id,
      eventKey: `chat:${message._id}`,
      metadata: { conversationKey, appointmentId },
    });

    ack?.({ success: true, message });
  });
};

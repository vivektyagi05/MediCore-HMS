import ChatMessage from "../models/ChatMessage.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import User from "../models/User.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { presenceManager } from "./presenceManager.js";
import { roomManager } from "./roomManager.js";

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

export const registerEventHandlers = (io, socket) => {
  socket.on("room:join", async ({ room }, ack) => {
    if (!assertAllowedEvent(socket, "room:join")) return;
    const allowed = await roomManager.canJoinRoom(socket.user, room);
    if (!allowed) {
      ack?.({ success: false, message: "You are not allowed to join this room" });
      return;
    }
    await socket.join(room);
    ack?.({ success: true, room });
  });

  socket.on("room:leave", async ({ room }, ack) => {
    await socket.leave(room);
    ack?.({ success: true, room });
  });

  socket.on("presence:ping", async (_payload, ack) => {
    if (!assertAllowedEvent(socket, "presence:ping")) return;
    await presenceManager.heartbeat(socket);
    ack?.({ success: true, serverTime: new Date() });
  });

  socket.on("notification:read", async ({ notificationId }, ack) => {
    if (!assertAllowedEvent(socket, "notification:read")) return;
    const notification = await NotificationDelivery.findOneAndUpdate(
      { _id: notificationId, recipientId: socket.user._id },
      { readAt: new Date() },
      { returnDocument: "after" },
    );
    ack?.({ success: Boolean(notification), notification });
  });

  socket.on("chat:typing:start", async ({ recipientId, appointmentId }) => {
    if (!assertAllowedEvent(socket, "chat:typing:start")) return;
    const conversationKey = roomManager.conversationKey(socket.user._id, recipientId);
    socket.to(roomManager.conversationRoom(conversationKey)).emit("chat:typing:start", {
      senderId: socket.user._id,
      recipientId,
      appointmentId,
    });
  });

  socket.on("chat:typing:stop", async ({ recipientId, appointmentId }) => {
    if (!assertAllowedEvent(socket, "chat:typing:stop")) return;
    const conversationKey = roomManager.conversationKey(socket.user._id, recipientId);
    socket.to(roomManager.conversationRoom(conversationKey)).emit("chat:typing:stop", {
      senderId: socket.user._id,
      recipientId,
      appointmentId,
    });
  });

  socket.on("chat:send", async ({ recipientId, body, appointmentId }, ack) => {
    if (!assertAllowedEvent(socket, "chat:send")) return;
    if (!recipientId || !body?.trim()) {
      ack?.({ success: false, message: "Recipient and message are required" });
      return;
    }

    const recipient = await User.findById(recipientId).select("_id isActive").lean();
    if (!recipient?.isActive) {
      ack?.({ success: false, message: "Recipient is not available" });
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

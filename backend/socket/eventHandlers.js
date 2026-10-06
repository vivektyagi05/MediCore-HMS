import NotificationDelivery from "../models/NotificationDelivery.js";
import { presenceManager } from "./presenceManager.js";
import { revalidateSession, SESSION_REJECTION_MESSAGES } from "../services/sessionAuthService.js";
import { roomManager } from "./roomManager.js";
import { wrapAsyncSocketHandler } from "./asyncSocketHandler.js";
import { chatEngine } from "../services/chat/chatEngine.js";
import { registerChatHandlers } from "./chatHandlers.js";

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
    // Long-lived sockets bypass the (per-connection) handshake check, so a
    // deactivation or password reset that happens mid-connection would
    // otherwise never be enforced until the client reconnects. The
    // heartbeat the frontend already sends every interval is reused as the
    // revalidation tick; on rejection the socket is force-disconnected, the
    // same outcome protect() gives REST callers immediately.
    const rejection = await revalidateSession(socket.user._id, socket.tokenSecurityVersion);
    if (rejection) {
      ack?.({ success: false, message: SESSION_REJECTION_MESSAGES[rejection] });
      socket.emit("auth:invalidated", { reason: rejection });
      socket.disconnect(true);
      return;
    }
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

  // All doctor↔patient messaging (send, delivery/read receipts, typing,
  // reconnect sync) lives in ONE place: the conversation engine behind
  // socket/chatHandlers.js. There is deliberately no second chat path here.
  registerChatHandlers(io, socket, { engine: chatEngine });
};

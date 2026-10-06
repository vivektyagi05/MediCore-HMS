// ─────────────────────────────────────────────────────────────────────────
// Socket.IO transport for the conversation engine. Every handler:
//   • runs for an authenticated socket (socketAuth) whose session is
//     re-validated against the DB at most every SESSION_TTL_MS — so a
//     password reset (securityVersion) or deactivation cuts chat off within
//     seconds even on a long-lived connection, not "at next reconnect"
//   • delegates authorisation / validation / persistence / rate limiting to
//     the engine (nothing is trusted from the payload except ids that the
//     engine re-authorises; sender identity is always socket.user)
//   • answers with a deterministic ack:
//       { success: true, ...data }
//       { success: false, message, error: { code, message } }
//     Fire-and-forget events (typing) report failures via `chat:error`.
// Socket.IO is transport only: a persisted message is the only "sent" truth.
// ─────────────────────────────────────────────────────────────────────────
import { logger } from "../utils/logger.js";
import { revalidateSession, SESSION_REJECTION_MESSAGES } from "../services/sessionAuthService.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { CHAT_ERROR, CHAT_EVENTS, ChatError } from "../services/chat/chatConstants.js";

const SESSION_TTL_MS = 15_000;
const TYPING_AUTO_STOP_MS = 5_000;

export const toErrorPayload = (error) => {
  if (error instanceof ChatError) {
    return { code: error.code, message: error.message, ...(error.details?.readOnlyReason ? { readOnlyReason: error.details.readOnlyReason } : {}) };
  }
  if (error instanceof AppError) return { code: CHAT_ERROR.FORBIDDEN, message: error.message };
  return null;
};

export function registerChatHandlers(io, socket, { engine, revalidate = revalidateSession, sessionTtlMs = SESSION_TTL_MS } = {}) {
  let invalidated = false;
  let sessionCheckedAt = Date.now(); // the handshake just authenticated this socket
  const typingTimers = new Map(); // otherUserId -> auto-stop timer

  const ensureSession = async () => {
    if (Date.now() - sessionCheckedAt < sessionTtlMs) return;
    const rejection = await revalidate(socket.user._id, socket.tokenSecurityVersion);
    if (rejection) {
      socket.emit("auth:invalidated", { reason: rejection });
      invalidated = true; // disconnect AFTER the failing ack has been delivered
      throw new ChatError(CHAT_ERROR.SESSION_INVALID, SESSION_REJECTION_MESSAGES[rejection]);
    }
    sessionCheckedAt = Date.now();
  };

  const on = (event, handler) => {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : null;
      try {
        await ensureSession();
        const data = await handler(payload && typeof payload === "object" ? payload : {});
        reply?.({ success: true, ...data });
      } catch (error) {
        const known = toErrorPayload(error);
        if (!known) {
          logger.error("Chat socket handler failed", { event, socketId: socket.id, userId: String(socket.user?._id), message: error?.message, stack: error?.stack });
        }
        const payloadOut = known || { code: "CHAT_INTERNAL", message: "Something went wrong processing that request" };
        if (reply) reply({ success: false, message: payloadOut.message, error: payloadOut });
        else socket.emit(CHAT_EVENTS.ERROR, { event, ...payloadOut });
        if (invalidated) setImmediate(() => socket.disconnect(true));
      }
    });
  };

  on(CHAT_EVENTS.SEND, async ({ recipientId, body, clientMessageId }) => {
    const { message, duplicate } = await engine.sendMessage(socket.user, { recipientId, body, clientMessageId });
    return { message, duplicate };
  });

  on(CHAT_EVENTS.DELIVERED, async ({ userId, messageIds }) => {
    const result = await engine.acknowledgeDelivered(socket.user, { userId, messageIds });
    return { messageIds: result.messageIds };
  });

  on(CHAT_EVENTS.READ, async ({ userId, upToMessageId }) => engine.markRead(socket.user, { userId, upToMessageId }));

  on(CHAT_EVENTS.SYNC, async ({ userId, afterMessageId, knownOutgoingIds }) =>
    engine.syncConversation(socket.user, { userId, afterMessageId, knownOutgoingIds }));

  const stopTyping = async (userId) => {
    clearTimeout(typingTimers.get(userId));
    typingTimers.delete(userId);
    try {
      await engine.typing(socket.user, { userId, active: false });
    } catch (error) {
      logger.warn("chat typing auto-stop failed", { userId: String(socket.user._id), message: error?.message });
    }
  };

  on(CHAT_EVENTS.TYPING_START, async ({ recipientId }) => {
    const result = await engine.typing(socket.user, { userId: recipientId, active: true });
    if (result.emitted) {
      clearTimeout(typingTimers.get(result.otherUserId));
      const timer = setTimeout(() => stopTyping(result.otherUserId), TYPING_AUTO_STOP_MS);
      timer.unref?.();
      typingTimers.set(result.otherUserId, timer);
    }
    return {};
  });

  on(CHAT_EVENTS.TYPING_STOP, async ({ recipientId }) => {
    clearTimeout(typingTimers.get(String(recipientId)));
    typingTimers.delete(String(recipientId));
    await engine.typing(socket.user, { userId: recipientId, active: false });
    return {};
  });

  // A dropped connection must not leave the other side staring at "typing…".
  socket.on("disconnect", async () => {
    const pending = [...typingTimers.keys()];
    for (const userId of pending) await stopTyping(userId);
  });
}

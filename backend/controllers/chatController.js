// REST transport for the conversation engine: the durable API + the
// recovery/fallback path for everything the socket does. No logic lives here
// beyond request parsing and response shaping.
import multer from "multer";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { chatEngine, listContactsFor } from "../services/chat/chatEngine.js";
import { CHAT_ERROR, CHAT_LIMITS, ChatError } from "../services/chat/chatConstants.js";

const ok = (res, data, message, status = 200) => res.status(status).json({ success: true, data, message });

export const listConversations = asyncHandler(async (req, res) => {
  const { limit, cursor, search, unread } = req.query;
  ok(res, await chatEngine.listConversations(req.user, { limit, cursor, search, unreadOnly: unread === "true" }), "Conversations fetched successfully");
});

export const listContacts = asyncHandler(async (req, res) => {
  const { page, limit, search } = req.query;
  ok(res, await listContactsFor(req.user, { page, limit, search }), "Contacts fetched successfully");
});

export const getUnreadSummary = asyncHandler(async (req, res) => {
  ok(res, await chatEngine.unreadSummary(req.user), "Unread summary fetched successfully");
});

export const getConversation = asyncHandler(async (req, res) => {
  const { before, limit } = req.query;
  ok(res, await chatEngine.getHistory(req.user, { userId: req.params.userId, before, limit }), "Conversation fetched successfully");
});

export const syncConversation = asyncHandler(async (req, res) => {
  const { afterMessageId, knownOutgoingIds } = req.query;
  const known = typeof knownOutgoingIds === "string" && knownOutgoingIds ? knownOutgoingIds.split(",") : [];
  ok(res, await chatEngine.syncConversation(req.user, { userId: req.params.userId, afterMessageId, knownOutgoingIds: known }), "Conversation synchronized");
});

export const sendMessage = asyncHandler(async (req, res) => {
  const { body, clientMessageId } = req.body || {};
  const result = await chatEngine.sendMessage(req.user, { recipientId: req.params.userId, body, clientMessageId });
  ok(res, result, result.duplicate ? "Message already received" : "Message sent", result.duplicate ? 200 : 201);
});

export const markConversationRead = asyncHandler(async (req, res) => {
  ok(res, await chatEngine.markRead(req.user, { userId: req.params.userId, upToMessageId: req.body?.upToMessageId }), "Messages marked as read");
});

export const acknowledgeDelivered = asyncHandler(async (req, res) => {
  ok(res, await chatEngine.acknowledgeDelivered(req.user, { userId: req.params.userId, messageIds: req.body?.messageIds }), "Delivery acknowledged");
});

// ── attachments ─────────────────────────────────────────────────────────
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_LIMITS.ATTACHMENT_MAX_BYTES, files: 1, fields: 4, fieldSize: 8 * 1024 },
}).single("file");

/** Translate multer's own errors into the chat error contract. */
export const parseAttachmentUpload = (req, res, next) => {
  uploader(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(new ChatError(CHAT_ERROR.ATTACHMENT_TOO_LARGE, `Attachments can be at most ${Math.floor(CHAT_LIMITS.ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB`));
    }
    return next(new ChatError(CHAT_ERROR.ATTACHMENT_INVALID, "The upload could not be processed"));
  });
};

export const sendAttachment = asyncHandler(async (req, res) => {
  if (!req.file) throw new ChatError(CHAT_ERROR.VALIDATION, "A file is required");
  const { clientMessageId, caption } = req.body || {};
  const result = await chatEngine.sendAttachment(req.user, { recipientId: req.params.userId, clientMessageId, caption, file: req.file });
  ok(res, result, result.duplicate ? "Attachment already received" : "Attachment sent", result.duplicate ? 200 : 201);
});

const asciiName = (name) => String(name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

export const downloadAttachment = asyncHandler(async (req, res) => {
  const file = await chatEngine.downloadAttachment(req.user, req.params.messageId);
  res.setHeader("Content-Type", file.mimeType); // server-recorded, validated at upload — never client-supplied now
  res.setHeader("Content-Length", file.buffer.length);
  res.setHeader("Content-Disposition", `${file.kind === "image" ? "inline" : "attachment"}; filename="${asciiName(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.status(200).end(file.buffer);
});

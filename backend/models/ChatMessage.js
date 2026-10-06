import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// ChatMessage — MongoDB is the source of truth for every doctor↔patient
// message. Socket.IO is only a transport; nothing here is "saved" because
// a socket event fired.
//
// Lifecycle fields (all server-written, never client-supplied):
//   sentAt       server accepted + persisted the message
//   deliveredAt  the RECIPIENT's client acknowledged receipt (socket ack or
//                a chat:sync that returned it). Persisting a message does
//                NOT set this. Offline recipient => stays null.
//   readAt       recipient explicitly opened/read it
//
// Idempotency: (senderId, clientMessageId) is unique (partial index), so a
// retried / double-clicked / replayed send cannot create a second document.
//
// Attachments hold only METADATA + an opaque storage key (storageService).
// The key is `select: false` and is stripped from every serialisation; it is
// never returned to a client. No binary / base64 ever lives in this collection.
// ─────────────────────────────────────────────────────────────────────────

export const CHAT_ATTACHMENT_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "application/pdf"]);

const attachmentSchema = new mongoose.Schema(
  {
    storageKey: { type: String, select: false },
    fileName: { type: String, trim: true, maxlength: 120 },
    mimeType: { type: String, enum: CHAT_ATTACHMENT_MIME_TYPES },
    size: { type: Number, min: 0 },
    kind: { type: String, enum: ["image", "document"] },
  },
  { _id: false },
);

const chatMessageSchema = new mongoose.Schema(
  {
    conversationKey: { type: String, required: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    messageType: { type: String, enum: ["text", "attachment", "system"], default: "text" },
    body: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: "",
      // Text/system messages need a body; an attachment message may carry
      // only the file (caption optional).
      validate: {
        validator(value) {
          return this.messageType === "attachment" ? true : typeof value === "string" && value.length > 0;
        },
        message: "Message body is required",
      },
    },
    clientMessageId: { type: String, trim: true, maxlength: 64 },
    sentAt: { type: Date },
    deliveredAt: Date,
    readAt: Date,
    attachment: { type: attachmentSchema, default: undefined },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        if (ret.attachment) delete ret.attachment.storageKey;
        return ret;
      },
    },
  },
);

// Query-pattern driven (see services/chat/chatRepository.js):
//  - history / sync / cursor pagination:  conversationKey + _id
chatMessageSchema.index({ conversationKey: 1, _id: -1 });
//  - unread counts + per-conversation unread grouping + mark-read:
chatMessageSchema.index({ recipientId: 1, readAt: 1, conversationKey: 1 });
//  - idempotency boundary (also serves "my sent messages" lookups):
chatMessageSchema.index(
  { senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } },
);
//  - existing pair/time reads (doctor patient-relationship unread counts etc.):
chatMessageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });

const ChatMessage = mongoose.models.ChatMessage || mongoose.model("ChatMessage", chatMessageSchema);

export default ChatMessage;

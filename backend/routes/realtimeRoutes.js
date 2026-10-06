import { Router } from "express";
import {
  getNotifications,
  getSmartInbox,
  getPresence,
  markNotificationRead,
} from "../controllers/realtimeController.js";
import {
  acknowledgeDelivered,
  downloadAttachment,
  getConversation,
  getUnreadSummary,
  listContacts,
  listConversations,
  markConversationRead,
  parseAttachmentUpload,
  sendAttachment,
  sendMessage,
  syncConversation,
} from "../controllers/chatController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/notifications", protect, getNotifications);
router.get("/inbox", protect, getSmartInbox);
router.patch("/notifications/:id/read", protect, markNotificationRead);
router.get("/presence", protect, getPresence);

// ── Communication (one engine; see services/chat/conversationEngine.js) ──
// Static paths first so they are never captured by "/chat/:userId".
router.get("/chat/conversations", protect, listConversations);
router.get("/chat/contacts", protect, listContacts);
router.get("/chat/unread-count", protect, getUnreadSummary);
router.get("/chat/messages/:messageId/attachment", protect, downloadAttachment);
router.get("/chat/:userId", protect, getConversation);
router.get("/chat/:userId/sync", protect, syncConversation);
router.post("/chat/:userId/messages", protect, sendMessage);
router.post("/chat/:userId/attachments", protect, parseAttachmentUpload, sendAttachment);
router.post("/chat/:userId/read", protect, markConversationRead);
router.post("/chat/:userId/delivered", protect, acknowledgeDelivered);

export default router;

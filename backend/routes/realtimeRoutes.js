import { Router } from "express";
import {
  getConversation,
  getNotifications,
  getPresence,
  markNotificationRead,
} from "../controllers/realtimeController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/notifications", protect, getNotifications);
router.patch("/notifications/:id/read", protect, markNotificationRead);
router.get("/presence", protect, getPresence);
router.get("/chat/:userId", protect, getConversation);

export default router;

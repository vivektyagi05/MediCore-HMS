import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import OnlineSession from "../models/OnlineSession.js";
import { ADMIN_ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { presenceManager } from "../socket/presenceManager.js";
import { roomManager } from "../socket/roomManager.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

export const getNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { recipientId: req.user._id };
  if (req.query.unread === "true") filter.readAt = { $exists: false };
  if (req.query.since) filter.createdAt = { $gt: new Date(req.query.since) };

  const [notifications, total, unreadCount] = await Promise.all([
    NotificationDelivery.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    NotificationDelivery.countDocuments(filter),
    NotificationDelivery.countDocuments({ recipientId: req.user._id, readAt: { $exists: false } }),
  ]);

  res.status(200).json({
    success: true,
    data: { notifications, unreadCount, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Realtime notifications fetched successfully",
  });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid notification id", 400);

  const notification = await NotificationDelivery.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { readAt: new Date() },
    { returnDocument: "after" },
  );
  if (!notification) throw new AppError("Notification not found", 404);

  res.status(200).json({
    success: true,
    data: { notification },
    message: "Notification marked as read",
  });
});

export const getPresence = asyncHandler(async (req, res) => {
  const activeSessions = ADMIN_ROLES.includes(req.user.role)
    ? await OnlineSession.find({ status: "online" }).populate("userId", "name email role").sort({ lastActiveAt: -1 }).limit(100).lean()
    : [];

  res.status(200).json({
    success: true,
    data: { onlineUsers: presenceManager.snapshot(), activeSessions },
    message: "Online presence fetched successfully",
  });
});

export const getConversation = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) throw new AppError("Invalid conversation user id", 400);
  const { page, limit, skip } = getPagination(req.query);
  const conversationKey = roomManager.conversationKey(req.user._id, req.params.userId);

  const [messages, total] = await Promise.all([
    ChatMessage.find({ conversationKey })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("senderId", "name email role")
      .populate("recipientId", "name email role")
      .lean(),
    ChatMessage.countDocuments({ conversationKey }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      conversationKey,
      messages: messages.reverse(),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    message: "Conversation fetched successfully",
  });
});

import NotificationDelivery from "../models/NotificationDelivery.js";
import User from "../models/User.js";
import { ADMIN_ROLES } from "../constants/roles.js";
import { getIO } from "../socket/socketServer.js";
import { roomManager } from "../socket/roomManager.js";

const serialize = (notification) => notification.toJSON?.() || notification;

const createDelivery = async (recipientId, payload) => {
  if (payload.eventKey) {
    const existing = await NotificationDelivery.findOne({
      recipientId,
      eventKey: payload.eventKey,
    });
    if (existing) return { notification: existing, created: false };
  }

  try {
    const notification = await NotificationDelivery.create({
      recipientId,
      actorId: payload.actorId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      entityType: payload.entityType,
      entityId: payload.entityId,
      severity: payload.severity || "info",
      eventKey: payload.eventKey,
      metadata: payload.metadata || {},
      deliveredAt: new Date(),
    });
    return { notification, created: true };
  } catch (error) {
    // The unique (recipientId,eventKey) index is the final idempotency guard for concurrent requests.
    if (payload.eventKey && error?.code === 11000) {
      const existing = await NotificationDelivery.findOne({ recipientId, eventKey: payload.eventKey });
      if (existing) return { notification: existing, created: false };
    }
    throw error;
  }
};

export const notificationEmitter = {
  async emitToUser(userId, payload) {
    if (!userId) return null;
    const { notification, created } = await createDelivery(userId, payload);
    if (!created) return notification;
    const data = serialize(notification);
    getIO()?.to(roomManager.userRoom(userId)).emit("notification:new", data);
    return notification;
  },

  async emitToUsers(userIds, payload) {
    const uniqueIds = [...new Set(userIds.filter(Boolean).map((id) => id.toString()))];
    return Promise.all(uniqueIds.map((userId) => this.emitToUser(userId, payload)));
  },

  async emitToRole(role, payload) {
    const users = await User.find({ role, isActive: true }).select("_id").lean();
    const notifications = await this.emitToUsers(users.map((user) => user._id), payload);
    getIO()?.to(roomManager.roleRoom(role)).emit("dashboard:sync", {
      type: payload.type,
      entityType: payload.entityType,
      entityId: payload.entityId,
      at: new Date(),
    });
    return notifications;
  },

  async emitToAdmins(payload) {
    const users = await User.find({ role: { $in: ADMIN_ROLES }, isActive: true }).select("_id").lean();
    const notifications = await this.emitToUsers(users.map((user) => user._id), payload);
    getIO()?.to(roomManager.adminRoom()).emit("dashboard:sync", {
      type: payload.type,
      entityType: payload.entityType,
      entityId: payload.entityId,
      at: new Date(),
    });
    return notifications;
  },

  emitDashboardSync(room, payload) {
    getIO()?.to(room).emit("dashboard:sync", { ...payload, at: new Date() });
  },
};


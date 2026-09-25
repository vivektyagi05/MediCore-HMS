import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import OnlineSession from "../models/OnlineSession.js";
import Appointment from "../models/Appointment.js";
import Prescription from "../models/Prescription.js";
import MedicalReport from "../models/MedicalReport.js";
import Review from "../models/Review.js";
import { ADMIN_ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { presenceManager } from "../socket/presenceManager.js";
import { roomManager } from "../socket/roomManager.js";
import { getIO } from "../socket/socketServer.js";
import { selectUnreadMessageIdsForReader } from "../utils/chatReadState.js";
import { onlineFilter } from "../socket/presenceQuery.js";
import { clampPagination, buildPaginationMeta } from "../utils/paginationValidation.js";
import { usersCanReadConversationHistory } from "../services/clinicalAccessService.js";
import User from "../models/User.js";
import { resolveCategory, classifyPriority, resolveAction, priorityWeight, PRIORITY } from "../services/doctorInboxAggregates.js";

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

// Phase D5, Step 7 / Phase DOC-02 — Smart Inbox. Reuses the exact same
// NotificationDelivery collection and dashboard bell data as getNotifications
// above; this adds grouping-by-category, deterministic priority, real
// per-item actions, search, filtering, and real pagination on top instead of
// building any new data source or duplicating the emitter pipeline.
//
// One bounded query (INBOX_SCAN_CEILING, same pattern as governance's
// GOVERNANCE_SCAN_CEILING) loads this doctor's own recent notifications;
// a handful of small batched $in lookups (never N+1 — one query per real
// entity type actually present in the page) resolve the context
// (appointmentStatus / patientId / reviewReplied) that
// doctorInboxAggregates.js's pure classifiers need. Category/priority/action
// are then computed once per item and reused for both the attention summary
// and the filtered, paginated item list — a single source of truth, matching
// the read-once-derive-many pattern the rest of this codebase's aggregate
// builders already use.
const INBOX_SCAN_CEILING = 500;

async function buildInboxContext(notifications) {
  const idsByEntityType = { appointment: [], prescription: [], report: [], review: [] };
  for (const n of notifications) {
    if (idsByEntityType[n.entityType] && n.entityId) idsByEntityType[n.entityType].push(n.entityId);
  }

  const [appointments, prescriptions, reports, reviews] = await Promise.all([
    idsByEntityType.appointment.length
      ? Appointment.find({ _id: { $in: idsByEntityType.appointment } }).select("status patientId").lean()
      : [],
    idsByEntityType.prescription.length
      ? Prescription.find({ _id: { $in: idsByEntityType.prescription } }).select("patientId").lean()
      : [],
    idsByEntityType.report.length
      ? MedicalReport.find({ _id: { $in: idsByEntityType.report } }).select("userId").lean()
      : [],
    idsByEntityType.review.length
      ? Review.find({ _id: { $in: idsByEntityType.review } }).select("doctorReply.message").lean()
      : [],
  ]);

  const appointmentById = new Map(appointments.map((a) => [String(a._id), a]));
  const prescriptionById = new Map(prescriptions.map((p) => [String(p._id), p]));
  const reportById = new Map(reports.map((r) => [String(r._id), r]));
  const reviewById = new Map(reviews.map((r) => [String(r._id), r]));

  return (notification) => {
    const id = notification.entityId ? String(notification.entityId) : null;
    if (!id) return {};
    if (notification.entityType === "appointment") {
      const appointment = appointmentById.get(id);
      return appointment ? { appointmentStatus: appointment.status, patientId: appointment.patientId } : {};
    }
    if (notification.entityType === "prescription") {
      const prescription = prescriptionById.get(id);
      return prescription ? { patientId: prescription.patientId } : {};
    }
    if (notification.entityType === "report") {
      const report = reportById.get(id);
      return report ? { patientId: report.userId } : {};
    }
    if (notification.entityType === "review") {
      const review = reviewById.get(id);
      return review ? { reviewReplied: Boolean(review.doctorReply?.message) } : {};
    }
    return {};
  };
}

export const getSmartInbox = asyncHandler(async (req, res) => {
  const notifications = await NotificationDelivery.find({ recipientId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(INBOX_SCAN_CEILING)
    .lean();

  const resolveContext = await buildInboxContext(notifications);

  // Compute category/priority/action once per item — this is the single
  // source of truth both the attention summary/category counts and the
  // filtered item list read from below.
  const enriched = notifications.map((notification) => {
    const context = resolveContext(notification);
    const category = resolveCategory(notification);
    const priority = classifyPriority(notification, context);
    const action = resolveAction(notification, context);
    return { notification, category, priority, action };
  });

  // Attention summary reflects the whole (unread/search-independent) inbox,
  // matching the Dashboard's Attention Center convention — a stable
  // "state of my inbox" strip that doesn't shift as the doctor narrows
  // category/priority filters below.
  const attentionSummary = {
    urgent: enriched.filter((e) => e.priority === PRIORITY.URGENT).length,
    actionRequired: enriched.filter((e) => e.priority === PRIORITY.ACTION_REQUIRED).length,
    unread: enriched.filter((e) => !e.notification.readAt).length,
    total: enriched.length,
  };

  const categoryCounts = new Map();
  for (const { category } of enriched) {
    const existing = categoryCounts.get(category.key) || { key: category.key, label: category.label, count: 0 };
    existing.count += 1;
    categoryCounts.set(category.key, existing);
  }
  const categories = Array.from(categoryCounts.values()).sort((a, b) => b.count - a.count);

  // ── Filters (STEP 5/6): all applied against the already-loaded, bounded
  // set above — no second query, matching STEP 5's "if the existing dataset
  // is reasonably sized and already fetched, client-side filtering may be
  // acceptable" guidance for a single doctor's own notification volume. ──
  let filtered = enriched;
  if (req.query.unread === "true") filtered = filtered.filter((e) => !e.notification.readAt);
  if (req.query.category) filtered = filtered.filter((e) => e.category.key === req.query.category);
  if (req.query.priority) filtered = filtered.filter((e) => e.priority === req.query.priority);
  if (req.query.search) {
    const term = String(req.query.search).trim().toLowerCase();
    if (term) {
      filtered = filtered.filter(
        (e) =>
          e.notification.title?.toLowerCase().includes(term) ||
          e.notification.message?.toLowerCase().includes(term) ||
          e.category.label.toLowerCase().includes(term) ||
          String(e.notification.entityId || "").toLowerCase() === term,
      );
    }
  }

  // STEP 14 — deterministic ordering: newest-relevant-first. When no
  // priority filter is active, urgent/action-required naturally surface
  // first (each tier still newest-first internally) so the frontend can
  // render tier headers by walking the page in order without a second
  // grouped fetch; a priority filter (single tier) sorts purely by recency.
  filtered = filtered.slice().sort((a, b) => {
    if (!req.query.priority) {
      const weightDiff = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (weightDiff !== 0) return weightDiff;
    }
    return new Date(b.notification.createdAt) - new Date(a.notification.createdAt);
  });

  const { page, pageSize, skip } = clampPagination(req.query.page, req.query.pageSize, { total: filtered.length });
  const pageItems = filtered.slice(skip, skip + pageSize).map(({ notification, category, priority, action }) => ({
    ...notification,
    category: category.key,
    categoryLabel: category.label,
    priority,
    action,
  }));

  res.status(200).json({
    success: true,
    data: {
      items: pageItems,
      attentionSummary,
      categories,
      pagination: buildPaginationMeta(page, pageSize, filtered.length),
    },
    message: "Smart inbox fetched successfully",
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
    ? await OnlineSession.find(onlineFilter()).populate("userId", "name email role").sort({ lastActiveAt: -1 }).limit(100).lean()
    : [];

  res.status(200).json({
    success: true,
    data: { onlineUsers: presenceManager.snapshotFor(req.user), activeSessions },
    message: "Online presence fetched successfully",
  });
});

export const getConversation = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) throw new AppError("Invalid conversation user id", 400);

  // BUGFIX (DOC-03, real security gap): this endpoint previously had no
  // authorization beyond being logged in — any authenticated user could
  // read the full message history of any two users by supplying their id
  // (an IDOR). Now requires a real doctor-patient relationship (or an
  // admin participant), same shared check as chat:send/roomManager.
  const otherUser = await User.findById(req.params.userId).select("_id role isActive").lean();
  if (!otherUser) throw new AppError("Conversation participant not found", 404);
  const allowed = await usersCanReadConversationHistory(req.user, otherUser);
  if (!allowed) throw new AppError("You are not authorized to view this conversation", 403);

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

  // BUGFIX (DOC-03B, real broken link found in the chat end-to-end trace):
  // ChatMessage.readAt was declared on the schema and READ from in three
  // places (doctorController's per-patient unread counts, this doctor's
  // clinical-profile unread count, and predictionEngine's inbox unread
  // signal) but was never WRITTEN anywhere in the codebase — opening a
  // conversation never marked the other person's messages as read, so
  // "unread" counts and Attention-Center "unread message" flags could only
  // ever grow, never clear, even after the doctor/patient actually read
  // them. Fixed at the single real read point: viewing this page (only on
  // page 1 of the newest messages, so paging into old history doesn't
  // falsely mark unseen-but-unfetched pages as read) marks this viewer's
  // own unread messages read and tells the sender's client so their badge
  // updates live, without a page refresh.
  if (page === 1) {
    const unreadIds = selectUnreadMessageIdsForReader(messages, req.user._id);

    if (unreadIds.length) {
      const readAt = new Date();
      await ChatMessage.updateMany({ _id: { $in: unreadIds } }, { $set: { readAt } });
      messages.forEach((m) => {
        if (unreadIds.some((id) => String(id) === String(m._id))) m.readAt = readAt;
      });

      getIO()?.to(roomManager.userRoom(req.params.userId)).to(roomManager.conversationRoom(conversationKey)).emit("chat:read", {
        conversationKey,
        readerId: req.user._id,
        messageIds: unreadIds,
        readAt,
      });
    }
  }

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

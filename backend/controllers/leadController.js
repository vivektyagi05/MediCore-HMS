import crypto from "crypto";
import mongoose from "mongoose";
import Lead, { LEAD_CONTACT_METHODS, LEAD_INQUIRY_TYPES, LEAD_PRIORITIES, LEAD_STATUSES } from "../models/Lead.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { logger } from "../utils/logger.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { writeAdminLog } from "../utils/adminAudit.js";
import { sendContactLeadAcknowledgement, isBrevoConfigured } from "../services/emailService.js";
import { CURRENT_PRIVACY_POLICY_VERSION, LEGAL_DOCUMENTS } from "../../shared/legalDocuments.js";

const inquiryTypes = new Set(Object.values(LEAD_INQUIRY_TYPES));
const contactMethods = new Set(Object.values(LEAD_CONTACT_METHODS));
const statuses = new Set(Object.values(LEAD_STATUSES));
const priorities = new Set(Object.values(LEAD_PRIORITIES));
const transitions = Object.freeze({
  [LEAD_STATUSES.NEW]: new Set([LEAD_STATUSES.ACKNOWLEDGED, LEAD_STATUSES.IN_PROGRESS, LEAD_STATUSES.CLOSED]),
  [LEAD_STATUSES.ACKNOWLEDGED]: new Set([LEAD_STATUSES.IN_PROGRESS, LEAD_STATUSES.WAITING_FOR_USER, LEAD_STATUSES.RESOLVED, LEAD_STATUSES.CLOSED]),
  [LEAD_STATUSES.IN_PROGRESS]: new Set([LEAD_STATUSES.WAITING_FOR_USER, LEAD_STATUSES.RESOLVED, LEAD_STATUSES.CLOSED]),
  [LEAD_STATUSES.WAITING_FOR_USER]: new Set([LEAD_STATUSES.IN_PROGRESS, LEAD_STATUSES.RESOLVED, LEAD_STATUSES.CLOSED]),
  [LEAD_STATUSES.RESOLVED]: new Set([LEAD_STATUSES.CLOSED, LEAD_STATUSES.IN_PROGRESS]),
  [LEAD_STATUSES.CLOSED]: new Set([LEAD_STATUSES.IN_PROGRESS]),
});

const normalize = (value) => String(value ?? "").trim();
const publicId = () => `MC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const fingerprint = (body) => crypto.createHash("sha256").update([
  normalize(body.email).toLowerCase(),
  normalize(body.phone),
  normalize(body.subject).toLowerCase(),
  normalize(body.message).toLowerCase(),
].join("\u001f")).digest("hex");

const validatePublicPayload = (body) => {
  const allowed = new Set(["name", "email", "phone", "inquiryType", "subject", "message", "preferredContactMethod", "consent"]);
  const unexpected = Object.keys(body || {}).find((key) => !allowed.has(key));
  if (unexpected) throw new AppError("Unexpected contact field", 400, { field: unexpected });
  const name = normalize(body?.name);
  const email = normalize(body?.email).toLowerCase();
  const phone = normalize(body?.phone);
  const subject = normalize(body?.subject);
  const message = normalize(body?.message);
  const inquiryType = normalize(body?.inquiryType);
  const preferredContactMethod = normalize(body?.preferredContactMethod) || LEAD_CONTACT_METHODS.EITHER;
  const errors = {};
  if (name.length < 2 || name.length > 120) errors.name = "Name must be between 2 and 120 characters";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = "Enter a valid email address";
  if (phone && !/^\+?[0-9()\-\s]{7,25}$/.test(phone)) errors.phone = "Enter a valid phone number";
  if (!inquiryTypes.has(inquiryType)) errors.inquiryType = "Unsupported inquiry type";
  if (subject.length < 3 || subject.length > 180) errors.subject = "Subject must be between 3 and 180 characters";
  if (message.length < 10 || message.length > 4000) errors.message = "Message must be between 10 and 4000 characters";
  if (!contactMethods.has(preferredContactMethod)) errors.preferredContactMethod = "Unsupported contact method";
  if (preferredContactMethod === LEAD_CONTACT_METHODS.PHONE && !phone) errors.phone = "Phone is required when phone contact is selected";
  if (body?.consent !== true) errors.consent = "Consent is required";
  if (Object.keys(errors).length) throw new AppError("Please correct the contact form", 400, errors);
  return { name, email, phone, inquiryType, subject, message, preferredContactMethod };
};

const safeLead = (lead, { admin = false } = {}) => ({
  id: String(lead._id), publicId: lead.publicId, name: lead.name, email: lead.email, phone: lead.phone,
  inquiryType: lead.inquiryType, subject: lead.subject, message: lead.message,
  preferredContactMethod: lead.preferredContactMethod, source: lead.source, status: lead.status,
  priority: lead.priority, assignedTo: lead.assignedTo, assignedAt: lead.assignedAt, assignedBy: lead.assignedBy,
  tags: lead.tags, firstResponseAt: lead.firstResponseAt, resolvedAt: lead.resolvedAt, closedAt: lead.closedAt,
  createdAt: lead.createdAt, updatedAt: lead.updatedAt,
  privacyPolicyVersion: lead.privacyPolicyVersion, termsVersion: lead.termsVersion, consentedAt: lead.consentedAt,
  notes: admin ? (lead.notes || []).map((n) => ({ id: String(n._id), body: n.body, author: n.author, createdAt: n.createdAt })) : undefined,
  timeline: admin ? (lead.timeline || []).map((e) => ({ type: e.type, actorId: e.actorId, from: e.from, to: e.to, note: e.note, createdAt: e.createdAt })) : undefined,
  notification: admin ? lead.notification : undefined,
});

export const createLead = asyncHandler(async (req, res) => {
  const data = validatePublicPayload(req.body || {});
  const fp = fingerprint(data);
  const recent = await Lead.findOne({ submissionFingerprint: fp, createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } }).select("publicId createdAt").lean();
  if (recent) {
    return res.status(200).json({ success: true, data: { referenceId: recent.publicId }, message: "This enquiry was already received recently." });
  }

  let lead;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      lead = await Lead.create({
        ...data,
        publicId: publicId(),
        user: req.user?._id || null,
        source: "CONTACT_FORM",
        privacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        termsVersion: LEGAL_DOCUMENTS.terms.version,
        consentedAt: new Date(),
        submissionFingerprint: fp,
        timeline: [{ type: "created" }],
      });
      break;
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.publicId && attempt < 4) continue;
      throw error;
    }
  }

  let notificationStatus = "skipped";
  if (isBrevoConfigured()) {
    try {
      const delivery = await sendContactLeadAcknowledgement({ toEmail: lead.email, toName: lead.name, referenceId: lead.publicId });
      notificationStatus = "delivered";
      await Lead.updateOne({ _id: lead._id }, { $set: { "notification.attemptedAt": new Date(), "notification.deliveredAt": new Date(), "notification.messageId": delivery.messageId, "notification.status": "delivered" } });
    } catch (error) {
      notificationStatus = "failed";
      await Lead.updateOne({ _id: lead._id }, { $set: { "notification.attemptedAt": new Date(), "notification.status": "failed" } });
      logger.error("Lead acknowledgement delivery failed", { event: "lead_acknowledgement_failed", leadId: lead.publicId, errorName: error.name });
    }
  } else {
    await Lead.updateOne({ _id: lead._id }, { $set: { "notification.status": "skipped" } });
  }

  try {
    await notificationEmitter.emitToAdmins({
      type: "lead",
      title: "New contact enquiry",
      message: `${lead.publicId} · ${lead.inquiryType} · ${lead.subject}`,
      entityType: "lead",
      entityId: lead._id,
      severity: "info",
      eventKey: `lead_created:${lead._id}`,
      metadata: {
        referenceId: lead.publicId,
        inquiryType: lead.inquiryType,
        action: { to: "/admin/leads" },
      },
    });
  } catch (error) {
    logger.error("Lead realtime notification failed", {
      event: "lead_realtime_notification_failed",
      leadId: lead.publicId,
      errorName: error?.name,
    });
  }

  logger.info("Lead created", { event: "lead_created", leadId: lead.publicId, inquiryType: lead.inquiryType, notificationStatus });
  return res.status(201).json({ success: true, data: { referenceId: lead.publicId, emailNotification: { status: notificationStatus } }, message: "Your enquiry has been submitted successfully." });
});

const pagination = (query) => { const page = Math.max(Number(query.page) || 1, 1); const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100); return { page, limit, skip: (page - 1) * limit }; };
const buildFilter = (query) => {
  const filter = {};
  if (query.status && statuses.has(query.status)) filter.status = query.status;
  if (query.priority && priorities.has(query.priority)) filter.priority = query.priority;
  if (query.inquiryType && inquiryTypes.has(query.inquiryType)) filter.inquiryType = query.inquiryType;
  if (query.assignedTo && mongoose.Types.ObjectId.isValid(query.assignedTo)) filter.assignedTo = query.assignedTo;
  if (query.search?.trim()) {
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 80);
    const regex = new RegExp(escaped, "i");
    filter.$or = [{ publicId: regex }, { name: regex }, { email: regex }, { phone: regex }, { subject: regex }];
  }
  return filter;
};

export const listLeads = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query);
  const filter = buildFilter(req.query);
  const [leads, total] = await Promise.all([
    Lead.find(filter).populate("assignedTo", "name email role").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
  ]);
  res.json({ success: true, data: { leads: leads.map((l) => safeLead(l)), pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } }, message: "Leads fetched successfully" });
});

export const getLead = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Lead not found", 404);
  const lead = await Lead.findById(req.params.id).populate("assignedTo", "name email role").populate("notes.author", "name email role").populate("timeline.actorId", "name email role").lean();
  if (!lead) throw new AppError("Lead not found", 404);
  res.json({ success: true, data: safeLead(lead, { admin: true }), message: "Lead fetched successfully" });
});

export const assignLead = asyncHandler(async (req, res) => {
  const { assignedTo } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(assignedTo)) throw new AppError("A valid staff user is required", 400);
  const assignee = await User.findOne({ _id: assignedTo, role: { $in: ["admin", "super_admin"] }, isActive: true }).select("_id").lean();
  if (!assignee) throw new AppError("Assigned user is not available", 400);
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw new AppError("Lead not found", 404);
  const previous = lead.assignedTo ? String(lead.assignedTo) : "";
  lead.assignedTo = assignee._id; lead.assignedAt = new Date(); lead.assignedBy = req.user._id;
  lead.timeline.push({ type: "assigned", actorId: req.user._id, from: previous, to: String(assignee._id) });
  await lead.save();
  await writeAdminLog({ req, action: "lead_assigned", resourceType: "Lead", resourceId: lead.publicId, metadata: { assignedTo: String(assignee._id) } });
  res.json({ success: true, data: safeLead(lead), message: "Lead assigned successfully" });
});

export const changeLeadPriority = asyncHandler(async (req, res) => {
  const { priority } = req.body || {};
  if (!priorities.has(priority)) throw new AppError("Invalid priority", 400);
  const lead = await Lead.findById(req.params.id); if (!lead) throw new AppError("Lead not found", 404);
  const previous = lead.priority; lead.priority = priority;
  lead.timeline.push({ type: "priority_changed", actorId: req.user._id, from: previous, to: priority });
  await lead.save();
  await writeAdminLog({ req, action: "lead_priority_changed", resourceType: "Lead", resourceId: lead.publicId, metadata: { from: previous, to: priority } });
  res.json({ success: true, data: safeLead(lead), message: "Lead priority updated" });
});

export const changeLeadStatus = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!statuses.has(status)) throw new AppError("Invalid status", 400);
  const lead = await Lead.findById(req.params.id); if (!lead) throw new AppError("Lead not found", 404);
  if (!transitions[lead.status]?.has(status)) throw new AppError(`Invalid status transition from ${lead.status} to ${status}`, 409);
  const previous = lead.status; const now = new Date(); lead.status = status;
  if (!lead.firstResponseAt && [LEAD_STATUSES.ACKNOWLEDGED, LEAD_STATUSES.IN_PROGRESS].includes(status)) lead.firstResponseAt = now;
  if (status === LEAD_STATUSES.RESOLVED) lead.resolvedAt = now;
  if (status === LEAD_STATUSES.CLOSED) lead.closedAt = now;
  lead.timeline.push({ type: status === LEAD_STATUSES.RESOLVED ? "resolved" : status === LEAD_STATUSES.CLOSED ? "closed" : "status_changed", actorId: req.user._id, from: previous, to: status });
  await lead.save();
  await writeAdminLog({ req, action: `lead_${status}`, resourceType: "Lead", resourceId: lead.publicId, metadata: { from: previous, to: status } });
  res.json({ success: true, data: safeLead(lead), message: "Lead status updated" });
});

export const addLeadNote = asyncHandler(async (req, res) => {
  const body = normalize(req.body?.body); if (body.length < 1 || body.length > 2000) throw new AppError("Note must be between 1 and 2000 characters", 400);
  if (Object.keys(req.body || {}).some((key) => key !== "body")) throw new AppError("Unexpected note field", 400);
  const lead = await Lead.findById(req.params.id); if (!lead) throw new AppError("Lead not found", 404);
  lead.notes.push({ body, author: req.user._id }); lead.timeline.push({ type: "note_added", actorId: req.user._id, note: body.slice(0, 200) });
  await lead.save();
  await writeAdminLog({ req, action: "lead_note_added", resourceType: "Lead", resourceId: lead.publicId });
  res.status(201).json({ success: true, data: safeLead(lead, { admin: true }), message: "Internal note added" });
});

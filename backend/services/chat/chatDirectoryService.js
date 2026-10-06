// ─────────────────────────────────────────────────────────────────────────
// Server-authoritative "who may I message?" list for the Communication Hubs.
//
// Candidates are derived ONLY from real doctor↔patient appointment
// relationships through the same pure policy functions as resolveChatAccess
// (summarizeChatRelationship / evaluateChatAccess). A user can never type an
// id and start a conversation: sending still goes through the engine, which
// re-authorises every message, and this list is just what that policy yields.
// ─────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import User from "../../models/User.js";
import { ROLES } from "../../constants/roles.js";
import { isDoctorClinicallyEligible } from "../doctorLifecycleService.js";
import {
  CHAT_ACTIVE_STATUSES, CHAT_FOLLOWUP_STATUSES, CHAT_ACCESS, evaluateChatAccess,
} from "../clinicalAccessService.js";
import { conversationKeyOf } from "./conversationEngine.js";

const CONTACT_PAGE_DEFAULT = 20;
const CONTACT_PAGE_MAX = 50;

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function findUserIdsByName(term, limit = 200) {
  const rows = await User.find({ name: { $regex: escapeRegex(term), $options: "i" }, isActive: { $ne: false } })
    .select("_id").limit(limit).lean();
  return rows.map((row) => String(row._id));
}

const RELATIONSHIP_GROUP = {
  hasActive: { $max: { $cond: [{ $in: ["$status", CHAT_ACTIVE_STATUSES] }, 1, 0] } },
  latestFollowUpAt: { $max: { $cond: [{ $in: ["$status", CHAT_FOLLOWUP_STATUSES] }, "$date", null] } },
  lastAppointmentAt: { $max: "$date" },
};

const summaryOf = (group) => ({
  hasRelationship: true,
  hasActive: group.hasActive === 1,
  latestFollowUpAt: group.latestFollowUpAt ? new Date(group.latestFollowUpAt).getTime() : null,
});

/**
 * @returns {Promise<{ items: object[], hasMore: boolean, page: number }>}
 */
export async function listChatContacts(user, { page = 1, limit = CONTACT_PAGE_DEFAULT, search = "", presenceFor } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || CONTACT_PAGE_DEFAULT, 1), CONTACT_PAGE_MAX);
  const pageNumber = Math.max(Number(page) || 1, 1);
  const statuses = [...CHAT_ACTIVE_STATUSES, ...CHAT_FOLLOWUP_STATUSES];
  const term = String(search || "").trim().slice(0, 60);
  const matchedUserIds = term ? await findUserIdsByName(term) : null;
  if (matchedUserIds && !matchedUserIds.length) return { items: [], hasMore: false, page: pageNumber };

  const paging = [{ $sort: { lastAppointmentAt: -1, _id: -1 } }, { $skip: (pageNumber - 1) * pageSize }, { $limit: pageSize + 1 }];
  let items = [];
  let hasMore;

  if (user.role === ROLES.DOCTOR) {
    const doctor = await Doctor.findOne({ userId: user._id }).select("_id verificationStatus isVerified isActive").lean();
    if (!doctor || !isDoctorClinicallyEligible(doctor)) return { items: [], hasMore: false, page: pageNumber };
    const match = { doctorId: doctor._id, status: { $in: statuses } };
    // Aggregation does not cast ids for us: convert explicitly.
    if (matchedUserIds) match.patientId = { $in: matchedUserIds.map((id) => new mongoose.Types.ObjectId(id)) };
    const groups = await Appointment.aggregate([{ $match: match }, { $group: { _id: "$patientId", ...RELATIONSHIP_GROUP } }, ...paging]);
    hasMore = groups.length > pageSize;
    const pageGroups = groups.slice(0, pageSize);
    const users = await User.find({ _id: { $in: pageGroups.map((g) => g._id) }, role: ROLES.PATIENT, isActive: { $ne: false } }).select("_id name role").lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    for (const group of pageGroups) {
      const patient = byId.get(String(group._id));
      if (!patient) continue;
      const access = evaluateChatAccess({ summary: summaryOf(group), doctorEligible: true, requesterIsDoctor: true });
      if (access.status === CHAT_ACCESS.NONE) continue;
      items.push({ participant: { _id: String(patient._id), name: patient.name, role: patient.role }, access, lastAppointmentAt: group.lastAppointmentAt });
    }
  } else if (user.role === ROLES.PATIENT) {
    const match = { patientId: user._id, status: { $in: statuses } };
    if (matchedUserIds) {
      const doctorsByName = await Doctor.find({ userId: { $in: matchedUserIds } }).select("_id").lean();
      if (!doctorsByName.length) return { items: [], hasMore: false, page: pageNumber };
      match.doctorId = { $in: doctorsByName.map((d) => d._id) };
    }
    const groups = await Appointment.aggregate([{ $match: match }, { $group: { _id: "$doctorId", ...RELATIONSHIP_GROUP } }, ...paging]);
    hasMore = groups.length > pageSize;
    const pageGroups = groups.slice(0, pageSize);
    const doctors = await Doctor.find({ _id: { $in: pageGroups.map((g) => g._id) } })
      .select("_id userId specialization verificationStatus isVerified isActive").lean();
    const doctorById = new Map(doctors.map((d) => [String(d._id), d]));
    const users = await User.find({ _id: { $in: doctors.map((d) => d.userId) }, isActive: { $ne: false } }).select("_id name role").lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));
    for (const group of pageGroups) {
      const doctor = doctorById.get(String(group._id));
      const doctorUser = doctor && userById.get(String(doctor.userId));
      if (!doctorUser) continue;
      const access = evaluateChatAccess({ summary: summaryOf(group), doctorEligible: isDoctorClinicallyEligible(doctor), requesterIsDoctor: false });
      if (access.status === CHAT_ACCESS.NONE) continue;
      items.push({
        participant: { _id: String(doctorUser._id), name: doctorUser.name, role: doctorUser.role, specialization: doctor.specialization || null },
        access, lastAppointmentAt: group.lastAppointmentAt,
      });
    }
  } else {
    return { items: [], hasMore: false, page: pageNumber };
  }

  const presence = presenceFor ? await presenceFor(items.map((item) => item.participant._id)) : new Map();
  items = items.map(({ participant, access, lastAppointmentAt }) => ({
    conversationKey: conversationKeyOf(user._id, participant._id),
    participant: { ...participant, ...(presence.get(participant._id) || { online: false, lastSeenAt: null }) },
    communicationStatus: access.status,
    canSend: access.canSend,
    readOnlyReason: access.readOnlyReason || null,
    lastAppointmentAt,
  }));
  return { items, hasMore, page: pageNumber };
}

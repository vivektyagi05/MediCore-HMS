import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";
import { usersCanReadConversationHistory } from "../services/clinicalAccessService.js";

export const roomManager = {
  userRoom(userId) {
    return `user:${userId}`;
  },

  roleRoom(role) {
    return `role:${role}`;
  },

  adminRoom() {
    return "role:admin";
  },

  doctorRoom(doctorId) {
    return `doctor:${doctorId}`;
  },

  patientRoom(patientId) {
    return `patient:${patientId}`;
  },

  appointmentRoom(appointmentId) {
    return `appointment:${appointmentId}`;
  },

  conversationRoom(conversationKey) {
    return `chat:${conversationKey}`;
  },

  conversationKey(userA, userB) {
    return [userA.toString(), userB.toString()].sort().join(":");
  },

  async defaultRoomsForUser(user) {
    const rooms = [this.userRoom(user._id), this.roleRoom(user.role)];
    if (ADMIN_ROLES.includes(user.role)) rooms.push(this.adminRoom());
    if (user.role === ROLES.PATIENT) rooms.push(this.patientRoom(user._id));
    if (user.role === ROLES.DOCTOR) {
      const doctor = await Doctor.findOne({ userId: user._id }).select("_id").lean();
      if (doctor) rooms.push(this.doctorRoom(doctor._id));
    }
    return rooms;
  },

  async canJoinRoom(user, room) {
    if (room === this.userRoom(user._id) || room === this.roleRoom(user.role)) return true;
    if (room === this.adminRoom()) return ADMIN_ROLES.includes(user.role);
    if (room === this.patientRoom(user._id)) return user.role === ROLES.PATIENT;

    if (room.startsWith("appointment:")) {
      const appointmentId = room.replace("appointment:", "");
      const appointment = await Appointment.findById(appointmentId).populate("doctorId", "userId").lean();
      if (!appointment) return false;
      if (ADMIN_ROLES.includes(user.role)) return true;
      if (user.role === ROLES.PATIENT) return appointment.patientId.toString() === user._id.toString();
      if (user.role === ROLES.DOCTOR) return appointment.doctorId?.userId?.toString() === user._id.toString();
    }

    if (room.startsWith("chat:")) {
      // Joining follows READ access (the same canRead REST history and the
      // attachment download use), NOT send access: a legitimately read-only
      // conversation can still be opened and kept in sync, while sending,
      // typing and uploading stay blocked by the engine. The room key is
      // parsed strictly (exactly two 24-hex ids, canonical order, caller is
      // one of them) and the relationship is re-derived server-side.
      const key = room.slice("chat:".length);
      const parts = key.split(":");
      if (parts.length !== 2 || !parts.every((part) => /^[a-f\d]{24}$/i.test(part))) return false;
      const [idA, idB] = parts;
      if (key !== [idA, idB].sort().join(":")) return false;
      if (![idA, idB].includes(user._id.toString())) return false;
      const otherUserId = idA === user._id.toString() ? idB : idA;
      const otherUser = await User.findById(otherUserId).select("_id role isActive").lean();
      if (!otherUser) return false;
      return usersCanReadConversationHistory(user, otherUser);
    }

    return false;
  },
};

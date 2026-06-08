import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";

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
      return room.split(":").includes(user._id.toString());
    }

    return false;
  },
};

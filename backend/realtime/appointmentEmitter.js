import { notificationEmitter } from "./notificationEmitter.js";
import { getIO } from "../socket/socketServer.js";
import { roomManager } from "../socket/roomManager.js";

const appointmentPayload = (appointment) => ({
  appointmentId: appointment._id,
  status: appointment.status,
  paymentStatus: appointment.paymentStatus,
  date: appointment.date,
  timeSlot: appointment.timeSlot,
});

export const appointmentEmitter = {
  async created(appointment) {
    const payload = appointmentPayload(appointment);
    getIO()?.to(roomManager.doctorRoom(appointment.doctorId._id)).emit("appointment:created", payload);
    getIO()?.to(roomManager.patientRoom(appointment.patientId._id)).emit("appointment:created", payload);
    getIO()?.to(roomManager.adminRoom()).emit("appointment:created", payload);

    await Promise.all([
      notificationEmitter.emitToUser(appointment.doctorId.userId._id, {
        type: "appointment",
        title: "New appointment booked",
        message: `${appointment.patientId.name} booked ${new Date(appointment.date).toLocaleDateString()} at ${appointment.timeSlot}`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey: `appointment:${appointment._id}:created:doctor`,
        severity: "info",
      }),
      notificationEmitter.emitToAdmins({
        type: "appointment",
        title: "Appointment booked",
        message: `${appointment.patientId.name} booked with Dr. ${appointment.doctorId.userId.name}`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey: `appointment:${appointment._id}:created:admin`,
      }),
    ]);
  },

  async statusUpdated(appointment) {
    const payload = appointmentPayload(appointment);
    const io = getIO();
    io?.to(roomManager.appointmentRoom(appointment._id)).emit("appointment:updated", payload);
    io?.to(roomManager.patientRoom(appointment.patientId._id)).emit("appointment:updated", payload);
    io?.to(roomManager.doctorRoom(appointment.doctorId._id)).emit("appointment:updated", payload);
    io?.to(roomManager.adminRoom()).emit("appointment:updated", payload);

    await notificationEmitter.emitToUser(appointment.patientId._id, {
      type: "appointment",
      title: "Appointment updated",
      message: `Your appointment is now ${appointment.status}`,
      entityType: "appointment",
      entityId: appointment._id,
      eventKey: `appointment:${appointment._id}:status:${appointment.status}`,
      severity: appointment.status === "cancelled" ? "warning" : "success",
    });
  },

  slotUnavailable(doctorId, date, timeSlot) {
    getIO()?.to(roomManager.doctorRoom(doctorId)).to(roomManager.adminRoom()).emit("appointment:slot-unavailable", {
      doctorId,
      date,
      timeSlot,
      at: new Date(),
    });
  },
};

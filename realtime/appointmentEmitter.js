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
        // Additive (Phase DOC-02 Smart Inbox): lets the inbox classify a
        // still-pending booking as Action Required without a second lookup —
        // metadata is already a Mixed field used the same way elsewhere
        // (paymentEmitter's invoiceId/refundRequestId).
        metadata: { status: appointment.status },
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

    // PHASE P10 (Follow-up/Continuity, brief §9/§16) — a patient booking
    // their own appointment already knows about it, which is why this
    // function has only ever notified the doctor+admins. But when a doctor
    // books ON BEHALF OF a patient (scheduleFollowUpAppointment reuses this
    // exact function), the patient previously received NO notification at
    // all — the doctor's own Follow-up Queue dialog literally told them
    // "the patient will be notified immediately", which was not true.
    // Additive: only fires for doctor/admin-initiated bookings, so a
    // patient's own booking flow is completely unaffected.
    if (appointment.bookedBy && appointment.bookedBy !== "patient") {
      const isFollowUp = appointment.appointmentType === "follow_up";
      await notificationEmitter.emitToUser(appointment.patientId._id, {
        type: "appointment",
        title: isFollowUp ? "Follow-up appointment scheduled" : "Appointment scheduled for you",
        message: isFollowUp
          ? `Dr. ${appointment.doctorId.userId.name} scheduled a follow-up appointment for you on ${new Date(appointment.date).toLocaleDateString()} at ${appointment.timeSlot}.`
          : `Dr. ${appointment.doctorId.userId.name} scheduled an appointment for you on ${new Date(appointment.date).toLocaleDateString()} at ${appointment.timeSlot}.`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey: `appointment:${appointment._id}:created:patient`,
        severity: "info",
      });
    }
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

  // Phase DOC-04 — real reschedule notification/realtime event. Notifies
  // whichever side did NOT initiate the reschedule (mirrors the
  // cancellation notification pattern in appointmentCancellationService.js:
  // the actor doesn't need to be told about their own action).
  async rescheduled(appointment, { fromDate, fromTimeSlot, rescheduledBy }) {
    const payload = { ...appointmentPayload(appointment), fromDate, fromTimeSlot };
    const io = getIO();
    io?.to(roomManager.appointmentRoom(appointment._id)).emit("appointment:rescheduled", payload);
    io?.to(roomManager.patientRoom(appointment.patientId._id)).emit("appointment:rescheduled", payload);
    io?.to(roomManager.doctorRoom(appointment.doctorId._id)).emit("appointment:rescheduled", payload);
    io?.to(roomManager.adminRoom()).emit("appointment:rescheduled", payload);

    const oldWhen = `${new Date(fromDate).toDateString()} at ${fromTimeSlot}`;
    const newWhen = `${new Date(appointment.date).toDateString()} at ${appointment.timeSlot}`;

    if (rescheduledBy !== "patient") {
      await notificationEmitter.emitToUser(appointment.patientId._id, {
        type: "appointment",
        title: "Appointment rescheduled",
        message: `Your appointment was moved from ${oldWhen} to ${newWhen}.`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey: `appointment:${appointment._id}:rescheduled:${appointment.date}:${appointment.timeSlot}`,
        severity: "info",
      });
    }
    if (rescheduledBy !== "doctor" && appointment.doctorId?.userId?._id) {
      await notificationEmitter.emitToUser(appointment.doctorId.userId._id, {
        type: "appointment",
        title: "Appointment rescheduled",
        message: `${appointment.patientId.name}'s appointment was moved from ${oldWhen} to ${newWhen}.`,
        entityType: "appointment",
        entityId: appointment._id,
        eventKey: `appointment:${appointment._id}:rescheduled-doctor:${appointment.date}:${appointment.timeSlot}`,
        severity: "info",
      });
    }
  },
};

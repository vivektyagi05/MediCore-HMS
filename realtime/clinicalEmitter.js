// Realtime events for the Doctor Clinical Intelligence Workspace (Phase D2).
// Reuses the existing Socket.IO server / room manager / notification
// pipeline — no new transport, no new notification model.
import { notificationEmitter } from "./notificationEmitter.js";
import { getIO } from "../socket/socketServer.js";
import { roomManager } from "../socket/roomManager.js";

export const clinicalEmitter = {
  // BUGFIX (Phase DOC-06): this only ever emitted a live Socket.IO event to
  // the patient's room. A patient who wasn't online at that exact moment
  // never learned a prescription existed — nothing was ever persisted to
  // NotificationDelivery, so it never showed up in their notification bell
  // afterwards either. Same bug class DOC-02/DOC-05 already fixed for other
  // producers (review/payout notices mis-typed); this producer was simply
  // never wired to notificationEmitter at all. eventKey makes it idempotent
  // the same way every other producer in this codebase already is.
  async prescriptionCreated(doctorId, patientId, prescription) {
    const io = getIO();
    io?.to(roomManager.doctorRoom(doctorId)).emit("prescription:created", {
      prescriptionId: prescription._id,
      appointmentId: prescription.appointmentId,
    });
    io?.to(roomManager.patientRoom(patientId)).emit("prescription:created", {
      prescriptionId: prescription._id,
    });
    await notificationEmitter.emitToUser(patientId, {
      type: "prescription",
      title: "New prescription available",
      message: `Your doctor issued a new prescription${prescription.diagnosis ? ` for ${prescription.diagnosis}` : ""}.`,
      entityType: "Prescription",
      entityId: prescription._id,
      eventKey: `prescription:${prescription._id}:created:patient`,
      severity: "info",
    });
  },

  reportUploaded(doctorId, patientId, report) {
    const io = getIO();
    io?.to(roomManager.doctorRoom(doctorId)).emit("report:uploaded", {
      reportId: report._id,
      title: report.title,
    });
  },

  // PHASE P6 — doctor-room-only sync so the doctor's own Command
  // Center/Clinical Workspace stay consistent across tabs (dashboardSyncTick
  // pattern). Not patient-facing: a report being marked reviewed internally
  // isn't a fact the patient needs a notification about.
  reportReviewed(doctorId, patientId, report) {
    getIO()?.to(roomManager.doctorRoom(doctorId)).emit("report:reviewed", {
      reportId: report._id,
      patientId,
    });
  },

  scheduleUpdated(doctorId) {
    getIO()?.to(roomManager.doctorRoom(doctorId)).emit("schedule:updated", { doctorId, at: new Date() });
  },

  async leaveStatusChanged(leave) {
    getIO()?.to(roomManager.doctorRoom(leave.doctorId)).emit("leave:updated", {
      leaveId: leave._id,
      status: leave.status,
    });
    if (leave.userId) {
      await notificationEmitter.emitToUser(leave.userId, {
        type: "schedule",
        title: `Leave request ${leave.status}`,
        message: `Your leave request (${new Date(leave.startDate).toLocaleDateString()} - ${new Date(leave.endDate).toLocaleDateString()}) was ${leave.status}.`,
        entityType: "LeaveRequest",
        entityId: leave._id,
        eventKey: `leave:${leave._id}:status:${leave.status}`,
        severity: leave.status === "approved" ? "success" : "info",
      });
    }
  },

  documentVerified(doctorUserId, document) {
    getIO()?.to(roomManager.userRoom(doctorUserId)).emit("document:verified", {
      documentId: document._id,
      status: document.status,
    });
    return notificationEmitter.emitToUser(doctorUserId, {
      type: "document",
      title: `Document ${document.status}`,
      message: `Your document "${document.title}" was ${document.status}.`,
      entityType: "DoctorDocument",
      entityId: document._id,
      eventKey: `doctor-document:${document._id}:status:${document.status}`,
      severity: document.status === "verified" ? "success" : "warning",
    });
  },

  // BUGFIX (Phase DOC-06): this notified only the issuing doctor's own room
  // — the patient the certificate was actually issued for received no
  // realtime event and no persisted notification at all, despite a new
  // patient-facing download endpoint now existing for exactly this
  // document. Mirrors prescriptionCreated's fix above.
  async certificateCreated(doctorId, patientId, certificate) {
    const io = getIO();
    io?.to(roomManager.doctorRoom(doctorId)).emit("certificate:created", {
      certificateId: certificate._id,
    });
    io?.to(roomManager.patientRoom(patientId)).emit("certificate:created", {
      certificateId: certificate._id,
    });
    await notificationEmitter.emitToUser(patientId, {
      type: "certificate",
      title: "New certificate issued",
      message: `Your doctor issued a new ${certificate.type?.replace(/_/g, " ") || ""} certificate: "${certificate.title}".`,
      entityType: "Certificate",
      entityId: certificate._id,
      eventKey: `certificate:${certificate._id}:created:patient`,
      severity: "info",
    });
  },
};

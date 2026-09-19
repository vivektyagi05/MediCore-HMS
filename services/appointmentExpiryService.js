import Appointment from "../models/Appointment.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import { env } from "../config/env.js";
import { appointmentEmitter } from "../realtime/appointmentEmitter.js";
import { appendAppointmentHistory } from "./appointmentHistoryService.js";

// GAP FOUND: nothing ever released a slot when a patient never paid.
// PAYMENT_PENDING -> CANCELLED is a legal transition (see STATUS_TRANSITIONS),
// but nothing ever triggered it automatically — an unpaid appointment held its
// slot in ACTIVE_STATUSES forever, permanently blocking that doctor+date+time
// for every other patient. This releases it after env.paymentWindowMinutes.
export const expireStalePaymentWindows = async () => {
  const cutoff = new Date(Date.now() - env.paymentWindowMinutes * 60 * 1000);

  const staleAppointments = await Appointment.find({
    status: APPOINTMENT_STATUS.PAYMENT_PENDING,
    updatedAt: { $lt: cutoff },
  })
    .populate("patientId", "name email role")
    .populate({
      path: "doctorId",
      select: "specialization fees userId",
      populate: { path: "userId", select: "name email role" },
    });

  const results = [];
  for (const appointment of staleAppointments) {
    const previousStatus = appointment.status;
    appointment.status = APPOINTMENT_STATUS.CANCELLED;
    appointment.cancelReason = `Payment window (${env.paymentWindowMinutes} min) expired — slot released automatically`;
    appendAppointmentHistory({ appointment, status: APPOINTMENT_STATUS.CANCELLED, fromStatus: previousStatus, actorRole: "system", reason: appointment.cancelReason });
    await appointment.save();

    // Reuses the exact same realtime + notification pipeline every other
    // status change goes through — no parallel notification path.
    await appointmentEmitter.statusUpdated(appointment);

    results.push(appointment._id);
  }

  return results;
};

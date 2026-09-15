import Appointment from "../models/Appointment.js";
import ReminderLog from "../models/ReminderLog.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";

// Deliberately NOT the full ACTIVE_STATUSES list — an appointment that has
// already reached payment_completed doesn't need a "complete your payment"
// reminder. This is its own correctly-scoped subset: everything before
// payment succeeds, including payment_pending (order created, checkout
// abandoned) which the original version missed entirely — a patient who
// started paying and dropped off never got nudged before
// expireStalePaymentWindows auto-cancelled their booking.
const UNPAID_STATUSES = [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.APPROVED,
  APPOINTMENT_STATUS.PAYMENT_PENDING,
];

export const paymentReminder = {
  async run() {
    const appointments = await Appointment.find({
      status: { $in: UNPAID_STATUSES },
      paymentStatus: "pending",
    })
      .populate("patientId", "name email")
      .limit(100)
      .lean();

    const results = [];
    for (const appointment of appointments) {
      const eventKey = `reminder:payment:${appointment._id}`;
      const existing = await ReminderLog.findOne({ eventKey }).lean();
      if (existing) continue;

      const reminder = await ReminderLog.create({
        userId: appointment.patientId._id,
        entityType: "payment",
        entityId: appointment._id,
        reminderType: "payment_due",
        scheduledFor: new Date(),
        status: "sent",
        sentAt: new Date(),
        eventKey,
      });

      await notificationEmitter.emitToUser(appointment.patientId._id, {
        type: "payment",
        title: "Payment pending",
        message: "Your appointment payment is still pending. Complete payment to keep your booking ready.",
        entityType: "appointment",
        entityId: appointment._id,
        eventKey,
        severity: "warning",
      });
      results.push(reminder);
    }

    return results;
  },
};

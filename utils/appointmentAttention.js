// Single source of truth for "does this appointment need attention" —
// extracted from admin/appointmentAdminController.js (Phase UI-3) so the
// Doctor Appointments rebuild (Phase DOC-04) can reuse the EXACT same real,
// documented rule instead of maintaining a second copy that could drift.
//
// Built only from fields that actually exist on the Appointment document
// (status/paymentStatus/date/createdAt) — never a fabricated score field.
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";

// Mongo query fragment — usable directly inside a $and/$or filter.
export const buildAttentionMatch = (now = Date.now()) => ({
  $or: [
    {
      status: APPOINTMENT_STATUS.PENDING,
      createdAt: { $lte: new Date(now - 24 * 60 * 60 * 1000) },
    },
    { paymentStatus: "failed" },
    {
      status: APPOINTMENT_STATUS.APPROVED,
      paymentStatus: "pending",
      date: { $lte: new Date(now + 24 * 60 * 60 * 1000) },
    },
  ],
});

// Pure in-memory predicate mirroring buildAttentionMatch, for callers that
// already have the appointment loaded (e.g. enriching a page of results
// without a second query per row).
export const computeNeedsAttention = (appointment, now = Date.now()) =>
  (appointment.status === APPOINTMENT_STATUS.PENDING &&
    new Date(appointment.createdAt).getTime() <= now - 24 * 60 * 60 * 1000) ||
  appointment.paymentStatus === "failed" ||
  (appointment.status === APPOINTMENT_STATUS.APPROVED &&
    appointment.paymentStatus === "pending" &&
    new Date(appointment.date).getTime() <= now + 24 * 60 * 60 * 1000);

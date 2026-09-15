// Smart Search: interprets a natural-language query into filters against
// EXISTING models/collections only. It never introduces a new data model —
// it just recognizes intent and runs the matching query.

import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import RefundRequest from "../models/RefundRequest.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";

const MONTH_WINDOW_DAYS = 30;

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Returns null when the query doesn't match a recognized natural-language
// intent, so the caller can fall back to the existing plain-text search.
export async function parseNaturalLanguageQuery(query, user) {
  const q = query.toLowerCase().trim();
  const isAdmin = ADMIN_ROLES.includes(user.role);

  // "my appointments this month"
  if (/appointment/.test(q) && /(this month|month)/.test(q) && /(my|mine)/.test(q)) {
    const since = new Date();
    since.setDate(since.getDate() - MONTH_WINDOW_DAYS);
    const filter = user.role === ROLES.PATIENT ? { patientId: user._id } : {};
    if (user.role === ROLES.DOCTOR) {
      const doctor = await Doctor.findOne({ userId: user._id }).lean();
      if (doctor) filter.doctorId = doctor._id;
    }
    filter.date = { $gte: since };
    const appointments = await Appointment.find(filter).sort({ date: -1 }).limit(50).populate("patientId", "name").lean();
    return {
      intent: "my_appointments_this_month",
      resultType: "appointments",
      results: appointments,
      label: `${appointments.length} appointment(s) in the last ${MONTH_WINDOW_DAYS} days`,
    };
  }

  // "patients waiting for approval" / "appointments awaiting approval"
  if (/(waiting|pending|awaiting)/.test(q) && /(approval|approve)/.test(q)) {
    if (!isAdmin && user.role !== ROLES.DOCTOR) return null;
    const filter = { status: "pending" };
    if (user.role === ROLES.DOCTOR) {
      const doctor = await Doctor.findOne({ userId: user._id }).lean();
      if (doctor) filter.doctorId = doctor._id;
    }
    const appointments = await Appointment.find(filter).sort({ date: 1 }).limit(50).populate("patientId", "name").lean();
    return {
      intent: "pending_approvals",
      resultType: "appointments",
      results: appointments,
      label: `${appointments.length} appointment(s) awaiting approval`,
    };
  }

  // "refunds pending today" / "refunds pending"
  if (/refund/.test(q) && /pending/.test(q)) {
    if (!isAdmin) return null;
    const filter = { status: "pending" };
    if (/today/.test(q)) filter.createdAt = { $gte: startOfDay(), $lte: endOfDay() };
    const refunds = await RefundRequest.find(filter).sort({ createdAt: -1 }).limit(50).populate("requestedBy", "name").lean();
    return {
      intent: "refunds_pending",
      resultType: "refunds",
      results: refunds,
      label: `${refunds.length} refund(s) pending${/today/.test(q) ? " today" : ""}`,
    };
  }

  // "doctors with the highest ratings" / "top rated doctors"
  if (/doctor/.test(q) && /(highest rating|top rated|best rated|rating)/.test(q)) {
    const doctors = await Doctor.find({ isActive: true }).populate("userId", "name").sort({ rating: -1 }).limit(10).lean();
    return {
      intent: "top_rated_doctors",
      resultType: "doctors",
      results: doctors,
      label: `Top ${doctors.length} doctor(s) by rating`,
    };
  }

  return null;
}

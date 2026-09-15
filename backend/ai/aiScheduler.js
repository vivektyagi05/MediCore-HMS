import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import LeaveRequest from "../models/LeaveRequest.js";
import { ACTIVE_STATUSES } from "../constants/appointmentStatus.js";
import { generateDaySlots } from "../utils/slotEngine.js";

const nextDays = (count = 7) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + index + 1);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  });

const dayOfWeek = (date) => date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();

export const aiScheduler = {
  async suggestSlots({ doctorId, patientId, limit = 6 }) {
    const doctor = await Doctor.findById(doctorId).populate("userId", "name email").lean();
    if (!doctor) return [];

    const dates = nextDays(14);
    const existing = await Appointment.find({
      doctorId: doctor._id,
      date: { $gte: dates[0], $lte: dates[dates.length - 1] },
      // BUGFIX: this used a hardcoded ["pending","approved"] list — the exact
      // same too-narrow set found and fixed in appointmentController/models
      // this session. A slot that was already paid for (payment_completed)
      // or mid-payment (payment_pending) was still being suggested by the AI
      // as available, since neither of those statuses were in this list.
      status: { $in: ACTIVE_STATUSES },
    }).lean();

    // BUGFIX (Phase DOC-07 audit): this AI suggester never checked
    // doctor.blockedDates or approved LeaveRequests at all — it could
    // "suggest" a slot on a day the doctor has explicitly blocked off or is
    // on approved leave, which is exactly the fabricated-availability
    // failure mode this phase's "AI must not invent availability" rule
    // exists to prevent (the same real backend/frontend booking path
    // already excludes both of these; the AI path had silently drifted out
    // of sync with it).
    const approvedLeaves = await LeaveRequest.find({
      doctorId: doctor._id,
      status: "approved",
      startDate: { $lte: dates[dates.length - 1] },
      endDate: { $gte: dates[0] },
    }).select("startDate endDate").lean();
    const blockedDateKeys = new Set(
      (doctor.blockedDates || []).map((item) => new Date(item.date).toISOString().slice(0, 10)),
    );
    const isUnavailableDate = (date) => {
      const dateKey = date.toISOString().slice(0, 10);
      if (blockedDateKeys.has(dateKey)) return true;
      return approvedLeaves.some((leave) => new Date(leave.startDate) <= date && new Date(leave.endDate) >= date);
    };

    const bookedKeys = new Set(existing.map((item) => `${item.date.toISOString().slice(0, 10)}:${item.timeSlot}`));
    const patientHistory = patientId ? await Appointment.find({ patientId }).select("timeSlot").lean() : [];
    const preferredHours = new Set(patientHistory.map((item) => item.timeSlot?.slice(0, 2)));

    const suggestions = [];
    for (const date of dates) {
      if (isUnavailableDate(date)) continue;
      const availability = doctor.availability.find((slot) => slot.dayOfWeek === dayOfWeek(date));
      if (!availability) continue;

      for (const timeSlot of generateDaySlots(availability)) {
        const dateKey = date.toISOString().slice(0, 10);
        if (bookedKeys.has(`${dateKey}:${timeSlot}`)) continue;
        const hour = Number(timeSlot.slice(0, 2));
        const lowTrafficScore = hour < 11 || hour > 15 ? 18 : 8;
        const preferenceScore = preferredHours.has(timeSlot.slice(0, 2)) ? 10 : 0;
        suggestions.push({
          doctorId: doctor._id,
          doctorName: doctor.userId?.name,
          date,
          timeSlot,
          score: 70 + lowTrafficScore + preferenceScore,
          reason: lowTrafficScore > 10 ? "Lower traffic timing" : "Balanced schedule fit",
        });
      }
    }

    return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async optimizeSchedules() {
    const doctors = await Doctor.find().populate("userId", "name").lean();
    const now = new Date();
    const future = new Date(now);
    future.setUTCDate(future.getUTCDate() + 30);
    // BUGFIX: this had no status filter at all, so a cancelled appointment
    // still counted toward a doctor's "load" — misclassifying a doctor with
    // several cancellations as overloaded when their real active caseload
    // might be light. Only statuses that still represent real, active work
    // should count.
    const appointments = await Appointment.find({
      date: { $gte: now, $lte: future },
      status: { $in: ACTIVE_STATUSES },
    }).lean();

    return doctors.map((doctor) => {
      const doctorAppointments = appointments.filter((item) => item.doctorId.toString() === doctor._id.toString());
      const load = doctorAppointments.length;
      const status = load > 25 ? "overloaded" : load < 5 ? "underutilized" : "balanced";
      return {
        doctorId: doctor._id,
        doctorName: doctor.userId?.name || "Doctor",
        specialization: doctor.specialization,
        load,
        status,
        recommendation:
          status === "overloaded"
            ? "Add buffer slots, route non-urgent bookings to comparable specialists, or open teleconsult windows."
            : status === "underutilized"
              ? "Promote low-traffic slots and surface this doctor higher in recommendations."
              : "Current schedule load is balanced.",
      };
    });
  },
};

import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";

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
      status: { $in: ["pending", "approved"] },
    }).lean();

    const bookedKeys = new Set(existing.map((item) => `${item.date.toISOString().slice(0, 10)}:${item.timeSlot}`));
    const patientHistory = patientId ? await Appointment.find({ patientId }).select("timeSlot").lean() : [];
    const preferredHours = new Set(patientHistory.map((item) => item.timeSlot?.slice(0, 2)));

    const suggestions = [];
    for (const date of dates) {
      const availability = doctor.availability.find((slot) => slot.dayOfWeek === dayOfWeek(date));
      if (!availability) continue;

      for (const timeSlot of availability.timeSlots) {
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
    const appointments = await Appointment.find({ date: { $gte: now, $lte: future } }).lean();

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

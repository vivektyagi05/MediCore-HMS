import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";

const getDayOfWeek = (dateValue) =>
  new Date(dateValue).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();

const hasAvailability = (doctor, date, timeSlot) => {
  if (!date) return doctor.availability.length > 0;
  const day = getDayOfWeek(date);
  const availability = doctor.availability.find((slot) => slot.dayOfWeek === day);
  if (!availability) return false;
  return timeSlot ? availability.timeSlots.includes(timeSlot) : availability.timeSlots.length > 0;
};

export const doctorRecommendation = {
  async recommend({ patientId, symptoms = [], departments = [], date, timeSlot, limit = 8 }) {
    const specializationRegexes = departments.map((department) => new RegExp(department, "i"));
    const filter = specializationRegexes.length ? { specialization: { $in: specializationRegexes } } : {};

    const [doctors, patientHistory] = await Promise.all([
      Doctor.find(filter).populate("userId", "name email role").lean(),
      Appointment.find({ patientId }).select("doctorId status").lean(),
    ]);

    const previousDoctorIds = new Set(patientHistory.map((item) => item.doctorId.toString()));
    const appointmentCounts = await Appointment.aggregate([
      { $match: { doctorId: { $in: doctors.map((doctor) => doctor._id) } } },
      { $group: { _id: "$doctorId", total: { $sum: 1 }, cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } } } },
    ]);
    const loadMap = new Map(appointmentCounts.map((item) => [item._id.toString(), item]));

    return doctors
      .map((doctor) => {
        const load = loadMap.get(doctor._id.toString()) || { total: 0, cancelled: 0 };
        const availabilityScore = hasAvailability(doctor, date, timeSlot) ? 30 : 0;
        const ratingScore = Math.round((doctor.rating || 0) * 10);
        const historyScore = previousDoctorIds.has(doctor._id.toString()) ? 12 : 0;
        const loadPenalty = Math.min(load.total, 25);
        const cancellationPenalty = load.total ? Math.round((load.cancelled / load.total) * 15) : 0;
        const symptomScore = symptoms.length ? 8 : 0;
        const score = Math.max(30, Math.min(98, 45 + availabilityScore + ratingScore + historyScore + symptomScore - loadPenalty - cancellationPenalty));

        return {
          doctor,
          matchPercentage: score,
          reasons: [
            availabilityScore ? "Available around preferred schedule" : "Relevant specialist",
            ratingScore ? `Rated ${doctor.rating}/5` : "Profile ready for bookings",
            historyScore ? "Previously consulted by this patient" : "Good new-care match",
          ],
          load: load.total,
        };
      })
      .sort((a, b) => b.matchPercentage - a.matchPercentage)
      .slice(0, limit);
  },
};

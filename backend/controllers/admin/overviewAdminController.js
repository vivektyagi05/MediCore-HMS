import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import User from "../../models/User.js";
import Payment, { PAYMENT_STATUS } from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import Review from "../../models/Review.js";
import OnlineSession from "../../models/OnlineSession.js";
import AdminActivityLog from "../../models/AdminActivityLog.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { onlineFilter } from "../../socket/presenceQuery.js";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfWeek = () => {
  const d = startOfToday();
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday as start of week
  d.setDate(d.getDate() - diff);
  return d;
};

const startOfMonth = () => {
  const d = startOfToday();
  d.setDate(1);
  return d;
};

const sumCaptured = async (fromDate) => {
  const result = await Payment.aggregate([
    {
      $match: {
        status: { $in: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED] },
        paidAt: { $gte: fromDate },
      },
    },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);
  return result[0]?.total || 0;
};

// Extracted so the AI Executive Brief (backend/ai/generativeAssistant.js)
// can reuse the exact same real aggregates instead of re-deriving them —
// no duplicated query logic, no risk of the AI brief drifting from the
// numbers shown on the dashboard itself.
export const buildPlatformOverviewData = async () => {
  const today = startOfToday();
  const week = startOfWeek();
  const month = startOfMonth();

  const [
    revenueToday,
    revenueWeek,
    revenueMonth,
    appointmentsToday,
    pendingAppointments,
    completedToday,
    cancelledToday,
    pendingDoctorVerifications,
    pendingRefunds,
    pendingRefundAmountAgg,
    totalDoctors,
    activeDoctors,
    totalPatients,
    doctorsOnline,
    patientsActive,
    recentActivity,
    reviewCount,
    appointmentTotals,
  ] = await Promise.all([
    sumCaptured(today),
    sumCaptured(week),
    sumCaptured(month),
    Appointment.countDocuments({ date: { $gte: today } }),
    Appointment.countDocuments({ status: "pending" }),
    Appointment.countDocuments({ status: "completed", updatedAt: { $gte: today } }),
    Appointment.countDocuments({ status: "cancelled", updatedAt: { $gte: today } }),
    Doctor.countDocuments({ verificationStatus: "pending" }),
    RefundRequest.countDocuments({ status: "pending" }),
    RefundRequest.aggregate([
      { $match: { status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Doctor.countDocuments({}),
    Doctor.countDocuments({ isActive: true }),
    User.countDocuments({ role: ROLES.PATIENT }),
    OnlineSession.countDocuments(onlineFilter({ role: ROLES.DOCTOR })),
    OnlineSession.countDocuments(onlineFilter({ role: ROLES.PATIENT })),
    AdminActivityLog.find({})
      .populate("actorId", "name email role")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    Review.countDocuments({ adminDeleted: { $ne: true } }),
    Appointment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const statusBreakdown = appointmentTotals.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  return {
    revenue: {
      today: revenueToday,
      week: revenueWeek,
      month: revenueMonth,
    },
    appointments: {
      today: appointmentsToday,
      pending: pendingAppointments,
      completedToday,
      cancelledToday,
      statusBreakdown,
    },
    pendingApprovals: {
      doctorVerifications: pendingDoctorVerifications,
      refunds: pendingRefunds,
      total: pendingDoctorVerifications + pendingRefunds + pendingAppointments,
    },
    refunds: {
      pendingCount: pendingRefunds,
      pendingAmount: pendingRefundAmountAgg[0]?.total || 0,
    },
    doctors: {
      total: totalDoctors,
      active: activeDoctors,
      online: doctorsOnline,
    },
    patients: {
      total: totalPatients,
      active: patientsActive,
    },
    reviews: {
      total: reviewCount,
    },
    recentActivity,
  };
};

export const getPlatformOverview = asyncHandler(async (_req, res) => {
  const data = await buildPlatformOverviewData();
  res.status(200).json({
    success: true,
    data,
    message: "Platform overview fetched successfully",
  });
});

export const buildPlatformAnalyticsData = async (days = 30) => {
  const boundedDays = Math.min(Math.max(Number(days) || 30, 7), 90);
  const since = new Date();
  since.setDate(since.getDate() - boundedDays);
  since.setHours(0, 0, 0, 0);

  const [
    appointmentsPerDay,
    revenuePerDay,
    doctorGrowth,
    patientGrowth,
    topSpecialties,
    topDoctors,
    cancellationAgg,
    approvalAgg,
  ] = await Promise.all([
    Appointment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.CAPTURED, paidAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt" } }, total: { $sum: "$totalAmount" } } },
      { $sort: { _id: 1 } },
    ]),
    Doctor.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    User.aggregate([
      { $match: { role: ROLES.PATIENT, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Doctor.aggregate([
      { $group: { _id: "$specialization", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Appointment.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: "$doctorId", consultations: { $sum: 1 } } },
      { $sort: { consultations: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "doctors",
          localField: "_id",
          foreignField: "_id",
          as: "doctor",
        },
      },
      { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "doctor.userId",
          foreignField: "_id",
          as: "doctorUser",
        },
      },
      { $unwind: { path: "$doctorUser", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          consultations: 1,
          specialization: "$doctor.specialization",
          name: "$doctorUser.name",
        },
      },
    ]),
    Appointment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
        },
      },
    ]),
    Appointment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: {
            $sum: {
              $cond: [{ $in: ["$status", ["approved", "payment_completed", "consultation_started", "consultation_completed", "completed", "review_eligible"]] }, 1, 0],
            },
          },
        },
      },
    ]),
  ]);

  const cancellationRow = cancellationAgg[0] || { total: 0, cancelled: 0 };
  const approvalRow = approvalAgg[0] || { total: 0, approved: 0 };

  return {
    rangeDays: boundedDays,
    appointmentsPerDay,
    revenuePerDay,
    doctorGrowth,
    patientGrowth,
    topSpecialties,
    topDoctors,
    cancellationRate: cancellationRow.total ? Number(((cancellationRow.cancelled / cancellationRow.total) * 100).toFixed(1)) : 0,
    approvalRate: approvalRow.total ? Number(((approvalRow.approved / approvalRow.total) * 100).toFixed(1)) : 0,
  };
};

export const getPlatformAnalytics = asyncHandler(async (req, res) => {
  const data = await buildPlatformAnalyticsData(req.query.days);
  res.status(200).json({
    success: true,
    data,
    message: "Platform analytics fetched successfully",
  });
});

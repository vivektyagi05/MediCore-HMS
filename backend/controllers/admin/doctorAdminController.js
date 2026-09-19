// PHASE UI-2 — Doctor Management Workspace (admin side).
//
// This controller adds admin-facing read surfaces for the Doctor domain. It
// deliberately does NOT duplicate anything that already exists:
//  - create/update/delete/approve/reject/verify-document stay on the
//    existing /api/doctors routes (doctorController.js) — reused as-is.
//  - activate/deactivate a doctor's account reuses the existing
//    /api/admin/users/:id/status endpoint (userAdminController.toggleUserStatus)
//    against doctor.userId — there is no separate "doctor active" flag to
//    duplicate; a doctor's operational status IS their linked User's isActive.
//  - performance/reputation/revenue numbers are read through the exact same
//    builder functions the Doctor's own Business Intelligence Platform uses
//    (buildDoctorAnalyticsIntelligence / buildDoctorRevenueIntelligence /
//    buildDoctorReviewIntelligence / buildDoctorReputationIntelligence), so
//    the admin view and the doctor's own dashboard can never disagree.
import mongoose from "mongoose";
import Doctor from "../../models/Doctor.js";
import User from "../../models/User.js";
import Appointment from "../../models/Appointment.js";
import Review from "../../models/Review.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { userHasPermission } from "../../middleware/adminMiddleware.js";
import { buildDoctorAnalyticsIntelligence } from "../doctor/workflowController.js";
import { buildDoctorRevenueIntelligence } from "../doctor/doctorEarningsController.js";
import { buildDoctorReviewIntelligence } from "../doctor/doctorReviewController.js";
import { buildDoctorReputationIntelligence } from "../publicController.js";
import { buildDoctorProfilePhotoUrl } from "../../services/doctorPublicSerializer.js";
import { MASTER_KINDS, resolveCanonicalFilterValue, validateCanonicalLocationFilters } from "../../services/masterDataService.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

// BUGFIX (Doctor Management Workspace audit): the "Add Doctor" form's user
// picker was populated from the existing Doctor LIST and submitted a
// Doctor _id as if it were the linked User's _id -- createDoctor's
// User.findById(req.body.userId) would then always 404 ("Doctor user
// account was not found") because a Doctor profile id is never a valid
// User id. The control existed but could never actually succeed. This
// endpoint gives the picker the data it actually needs: real doctor-role
// users who don't already have a Doctor profile.
export const getEligibleDoctorUsersAdmin = asyncHandler(async (_req, res) => {
  const linkedUserIds = await Doctor.distinct("userId");
  const users = await User.find({
    role: ROLES.DOCTOR,
    isActive: true,
    _id: { $nin: linkedUserIds },
  })
    .select("name email createdAt")
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ success: true, data: { users }, message: "Eligible doctor users fetched successfully" });
});


// per-doctor appointment count (real activity signal, not fabricated).
// Sorting/filtering only ever touches fields that actually exist on these
// two collections.
export const listDoctorsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const match = {};

  if (req.query.verificationStatus) match.verificationStatus = req.query.verificationStatus;

  if (req.query.specializationMasterId) {
    const specialization = await resolveCanonicalFilterValue(req.query.specializationMasterId, MASTER_KINDS.SPECIALIZATION, "specialization");
    match.specializationMasterId = specialization._id;
  } else if (req.query.specialization && mongoose.Types.ObjectId.isValid(req.query.specialization)) {
    const specialization = await resolveCanonicalFilterValue(req.query.specialization, MASTER_KINDS.SPECIALIZATION, "specialization");
    match.specializationMasterId = specialization._id;
  } else if (req.query.specialization) {
    match.specialization = new RegExp(req.query.specialization, "i");
  }

  const canonicalLocation = await validateCanonicalLocationFilters({
    state: req.query.stateMasterId || (req.query.state && mongoose.Types.ObjectId.isValid(req.query.state) ? req.query.state : undefined),
    district: req.query.districtMasterId || (req.query.district && mongoose.Types.ObjectId.isValid(req.query.district) ? req.query.district : undefined),
    city: req.query.cityMasterId || (req.query.city && mongoose.Types.ObjectId.isValid(req.query.city) ? req.query.city : undefined),
  });
  if (canonicalLocation.state) match.stateMasterId = canonicalLocation.state._id;
  if (canonicalLocation.district) match.districtMasterId = canonicalLocation.district._id;
  if (canonicalLocation.city) match.cityMasterId = canonicalLocation.city._id;

  if (req.query.state && !mongoose.Types.ObjectId.isValid(req.query.state) && !req.query.stateMasterId) match.state = new RegExp(req.query.state, "i");
  if (req.query.district && !mongoose.Types.ObjectId.isValid(req.query.district) && !req.query.districtMasterId) match.district = new RegExp(req.query.district, "i");
  if (req.query.city && !mongoose.Types.ObjectId.isValid(req.query.city) && !req.query.cityMasterId) match.city = new RegExp(req.query.city, "i");
  if (req.query.consultationMode) match.consultationMode = req.query.consultationMode;
  if (req.query.status === "active") match.isActive = true;
  if (req.query.status === "inactive") match.isActive = false;
  if (req.query.minRating) match.rating = { $gte: Number(req.query.minRating) };

  const sortMap = {
    name_asc: { "user.name": 1 },
    newest: { createdAt: -1 },
    rating: { rating: -1 },
    experience: { experience: -1 },
    activity: { appointmentCount: -1 },
  };
  const sortBy = sortMap[req.query.sort] || { createdAt: -1 };

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
  ];

  if (req.query.search) {
    const term = new RegExp(req.query.search, "i");
    pipeline.push({ $match: { $or: [{ "user.name": term }, { "user.email": term }] } });
  }

  pipeline.push(
    {
      $lookup: {
        from: "appointments",
        let: { doctorId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$doctorId", "$$doctorId"] } } },
          { $count: "count" },
        ],
        as: "appointmentStats",
      },
    },
    {
      $addFields: {
        appointmentCount: { $ifNull: [{ $arrayElemAt: ["$appointmentStats.count", 0] }, 0] },
        pendingDocumentsCount: {
          $size: {
            $filter: {
              input: { $ifNull: ["$documents", []] },
              cond: { $eq: ["$$this.status", "pending"] },
            },
          },
        },
      },
    },
    { $project: { appointmentStats: 0, "user.password": 0 } },
    { $sort: sortBy },
    { $skip: skip },
    { $limit: limit },
  );

  const countPipeline = [{ $match: match }];
  if (req.query.search) {
    const term = new RegExp(req.query.search, "i");
    countPipeline.push(
      { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $match: { $or: [{ "user.name": term }, { "user.email": term }] } },
    );
  }
  countPipeline.push({ $count: "total" });

  const [doctors, countResult] = await Promise.all([
    Doctor.aggregate(pipeline),
    Doctor.aggregate(countPipeline),
  ]);

  const total = countResult[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      doctors,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    message: "Doctors fetched successfully",
  });
});

// Real counts only. "attentionRequired" is deliberately a documented rule
// (pending verification OR at least one pending document OR a deactivated
// account) — never a fabricated score.
export const getDoctorStatsAdmin = asyncHandler(async (_req, res) => {
  const [total, active, inactive, pending, approved, rejected, withPendingDocs] = await Promise.all([
    Doctor.countDocuments({}),
    Doctor.countDocuments({ isActive: true }),
    Doctor.countDocuments({ isActive: false }),
    Doctor.countDocuments({ verificationStatus: "pending" }),
    Doctor.countDocuments({ verificationStatus: "approved" }),
    Doctor.countDocuments({ verificationStatus: "rejected" }),
    Doctor.countDocuments({ "documents.status": "pending" }),
  ]);

  const attentionRequired = await Doctor.countDocuments({
    $or: [{ verificationStatus: "pending" }, { "documents.status": "pending" }, { isActive: false }],
  });

  res.status(200).json({
    success: true,
    data: { total, active, inactive, pending, approved, rejected, withPendingDocs, attentionRequired },
    message: "Doctor stats fetched successfully",
  });
});

// Doctor Detail Workspace aggregate. Composes the doctor's own real record
// with the same intelligence builders their own dashboard uses. Revenue is
// deliberately NOT included here — see getDoctorEarningsAdmin, which is
// gated behind the manage_payments permission so financial data isn't
// exposed to every admin just because the API could technically return it.
export const getDoctorDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid doctor id", 400);

  const doctor = await Doctor.findById(req.params.id).populate("userId", "name email isActive createdAt").lean();
  if (!doctor) throw new AppError("Doctor not found", 404);

  const [analytics, reviews, reputation, appointmentCount, canViewFinance] = await Promise.all([
    buildDoctorAnalyticsIntelligence(doctor),
    buildDoctorReviewIntelligence(doctor._id),
    buildDoctorReputationIntelligence(doctor._id),
    Appointment.countDocuments({ doctorId: doctor._id }),
    userHasPermission(req.user, "manage_payments"),
  ]);

  // buildDoctorAnalyticsIntelligence() bundles revenue-derived fields
  // together with pure activity metrics (it's the doctor's own dashboard
  // builder, which is always allowed to see its own revenue). The admin
  // Performance tab is NOT gated behind manage_payments, so those revenue
  // fields are stripped out here unless the requesting admin actually has
  // that permission -- otherwise every admin could see revenue numbers
  // through the "Performance" tab even with the dedicated Earnings tab
  // correctly locked down.
  const {
    revenue: _revenue,
    revenueTrend: _revenueTrend,
    revenueFunnel: _revenueFunnel,
    revenueForecast: _revenueForecast,
    growthForecast: _growthForecast,
    monthlyGrowth: _monthlyGrowth,
    ...activityOnlyAnalytics
  } = analytics;
  const performance = canViewFinance ? analytics : activityOnlyAnalytics;

  res.status(200).json({
    success: true,
    data: {
      doctor: { ...doctor, profilePhotoUrl: buildDoctorProfilePhotoUrl(doctor.profilePhoto, req) },
      appointmentCount,
      performance,
      reviews: { negativeCount: reviews.negativeCount, unrepliedCount: reviews.unrepliedCount, responseRate: reviews.responseRate },
      reputation,
    },
    message: "Doctor detail fetched successfully",
  });
});

// Financial data — gated behind manage_payments (see doctorAdminRoutes.js),
// same permission key the Executive Dashboard's revenue widgets already use.
export const getDoctorEarningsAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid doctor id", 400);

  const doctor = await Doctor.findById(req.params.id).select("_id").lean();
  if (!doctor) throw new AppError("Doctor not found", 404);

  const revenue = await buildDoctorRevenueIntelligence(doctor._id);

  res.status(200).json({ success: true, data: revenue, message: "Doctor earnings fetched successfully" });
});

// Real document download via an authenticated stream — replaces the
// frontend's previous hardcoded `http://localhost:5000/${filePath}` link,
// which pointed at a path this server never actually serves statically
// (no express.static mount exists for storage/) and would 404 in any
// environment, and would have leaked documents to anyone with the URL since
// it bypassed auth entirely. This mirrors the res.download() pattern
// already used for prescriptions/certificates/reports.
export const downloadDoctorDocumentAdmin = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.doctorId).select("documents").lean();
  if (!doctor) throw new AppError("Doctor not found", 404);

  const document = doctor.documents.find((doc) => doc._id.toString() === req.params.documentId);
  if (!document) throw new AppError("Document not found", 404);

  res.download(document.filePath, document.fileName, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ success: false, message: "Document file could not be found on disk" });
    }
  });
});

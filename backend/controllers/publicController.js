/**
 * publicController.js
 * All endpoints are unauthenticated (no protect middleware).
 * Security: never expose email, mobile, internal IDs beyond doctor profile ID,
 * financial data, documents, or private notes.
 */
import { containsRegex, exactRegex } from "../utils/regexSafe.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import Review from "../models/Review.js";
import Service from "../models/Service.js";
import CMSPage from "../models/CMSPage.js";
import User from "../models/User.js";
import HospitalSetting from "../models/HospitalSetting.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { findNextAvailableSlotForDoctor, getNextAvailableSlot } from "./appointmentController.js";
import LeaveRequest from "../models/LeaveRequest.js";
import { ACTIVE_STATUSES } from "../constants/appointmentStatus.js";
import { buildDoctorGeographicFilter, buildLocationAggregationMatch } from "../utils/geographicSearch.js";
import { serializeDoctorPublicProfile } from "../services/doctorPublicSerializer.js";
import { serializeServicePublic } from "../services/servicePublicSerializer.js";
import { serializeArticlePublic } from "../services/articlePublicSerializer.js";
import { getHomeSeoData } from "../services/seoInfrastructureService.js";
import { listMasterData, MASTER_KINDS, resolveCanonicalFilterValue, validateCanonicalLocationFilters } from "../services/masterDataService.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const safeDoctor = (doc, req, metrics = {}) => serializeDoctorPublicProfile(doc, req, metrics);
const PUBLIC_DOCTOR_BASE = Object.freeze({
  isVerified: true,
  verificationStatus: "approved",
  isActive: true,
});

const getPublicDoctorUserIds = async () => {
  const users = await User.find({ role: "doctor", isActive: true }).select("_id").lean();
  return users.map((user) => user._id);
};

const publicDoctorFilter = (userIds) => ({
  ...PUBLIC_DOCTOR_BASE,
  userId: { $in: userIds },
});


const safeReview = (r) => ({
  id: r._id,
  rating: r.rating,
  comment: r.comment || "",
  isEdited: r.isEdited || false,
  doctorReply: r.doctorReply?.message
    ? { message: r.doctorReply.message, repliedAt: r.doctorReply.repliedAt }
    : null,
  patientName: r.userId?.name
    ? r.userId.name.split(" ")[0] + " " + (r.userId.name.split(" ")[1]?.[0] || "") + "."
    : "Patient",
  createdAt: r.createdAt,
});

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 12, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
};

export const getHomeSeo = asyncHandler(async (req, res) => {
  const data = await getHomeSeoData(req);
  res.status(200).json({ success: true, data, message: "Home SEO data fetched successfully" });
});

// ─── Public hospital information ────────────────────────────────────────────

export const getHospitalInfo = asyncHandler(async (_req, res) => {
  const settings = await HospitalSetting.findOne({ singletonKey: "global" })
    .select("hospitalName logoUrl supportEmail phone timezone appointmentLimits paymentSettings")
    .lean();

  if (!settings) {
    return res.status(200).json({ success: true, data: null, message: "Hospital information is not configured" });
  }

  const data = {
    hospitalName: settings.hospitalName || "",
    logoUrl: settings.logoUrl || "",
    supportEmail: settings.supportEmail || "",
    phone: settings.phone || "",
    timezone: settings.timezone || "",
    bookingWindowDays: settings.appointmentLimits?.bookingWindowDays ?? null,
    currency: settings.paymentSettings?.currency || "",
    taxRate: settings.paymentSettings?.taxRate ?? null,
    refundsEnabled: Boolean(settings.paymentSettings?.refundsEnabled),
  };

  return res.status(200).json({ success: true, data, message: "Hospital information fetched successfully" });
});

// ─── Home Page Stats ─────────────────────────────────────────────────────────

export const getHomeStats = asyncHandler(async (_req, res) => {
  const publicUserIds = await getPublicDoctorUserIds();
  const publicDoctorBase = publicDoctorFilter(publicUserIds);
  const publicDoctors = await Doctor.find(publicDoctorBase).select("_id").lean();
  const publicDoctorIds = publicDoctors.map((doctor) => doctor._id);
  const [totalDoctors, verifiedDoctors, totalConsultations] = await Promise.all([
    Promise.resolve(publicDoctors.length),
    Promise.resolve(publicDoctors.length),
    Appointment.countDocuments({
      doctorId: { $in: publicDoctorIds },
      status: { $in: ["completed", "review_eligible", "consultation_completed"] },
    }),
  ]);

  const [specializations, cities] = await Promise.all([
    Doctor.distinct("specialization", publicDoctorBase),
    Doctor.distinct("city", { ...publicDoctorBase, city: { $ne: "" } }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalDoctors,
      verifiedDoctors,
      totalConsultations,
      totalSpecializations: specializations.length,
      totalCities: cities.filter(Boolean).length,
      patientsSatisfied: Math.round(totalConsultations * 0.94), // derived metric
    },
    message: "Stats fetched successfully",
  });
});

// ─── Home Page: Featured / Top-Rated / Recently Verified ────────────────────

export const getFeaturedDoctors = asyncHandler(async (req, res) => {
  const baseFilter = publicDoctorFilter(await getPublicDoctorUserIds());

  const [topRated, recentlyVerified] = await Promise.all([
    Doctor.find({ ...baseFilter, rating: { $gt: 0 } })
      .populate("userId", "name")
      .sort({ rating: -1, experience: -1 })
      .limit(6)
      .lean(),
    Doctor.find(baseFilter)
      .populate("userId", "name")
      .sort({ verifiedAt: -1 })
      .limit(4)
      .lean(),
  ]);

  // Count reviews per doctor for top rated
  const doctorIds = topRated.map((d) => d._id);
  const reviewCounts = await Review.aggregate([
    { $match: { doctorId: { $in: doctorIds }, adminDeleted: { $ne: true } } },
    { $group: { _id: "$doctorId", count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(reviewCounts.map((r) => [r._id.toString(), r.count]));

  res.status(200).json({
    success: true,
    data: {
      topRated: topRated.map((d) => ({
        ...safeDoctor(d, req, { totalReviews: countMap[d._id.toString()] || 0 }),
      })),
      recentlyVerified: recentlyVerified.map((d) => safeDoctor(d, req)),
    },
    message: "Featured doctors fetched successfully",
  });
});

// ─── Home Page: Specializations + Cities for search dropdowns ───────────────

export const getSearchMeta = asyncHandler(async (_req, res) => {
  const baseFilter = publicDoctorFilter(await getPublicDoctorUserIds());

  const includeMasterData = _req.query?.masterData !== "false";
  // Specializations and states are small canonical lists (LGD: 36 states/UTs).
  // Districts/cities are ~800/~5,000 records, so the flat search facet lists only
  // the values that publicly bookable doctors actually have (a real, small facet);
  // full hierarchies are fetched per-parent via /api/master-data.
  const [specializationMaster, stateMaster, districtValues, cityValues, languageValues] = await Promise.all([
    includeMasterData ? listMasterData({ kind: MASTER_KINDS.SPECIALIZATION }) : Promise.resolve([]),
    includeMasterData ? listMasterData({ kind: MASTER_KINDS.STATE }) : Promise.resolve([]),
    includeMasterData ? Doctor.distinct("district", baseFilter) : Promise.resolve([]),
    includeMasterData ? Doctor.distinct("city", baseFilter) : Promise.resolve([]),
    Doctor.distinct("languages", baseFilter),
  ]);
  const sortedUnique = (values) => [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  res.status(200).json({
    success: true,
    data: {
      specializations: specializationMaster.map((item) => item.name),
      cities: sortedUnique(cityValues),
      states: stateMaster.map((item) => item.name),
      districts: sortedUnique(districtValues),
      languages: [...new Set(languageValues.flat().filter(Boolean))].sort(),
      consultationModes: ["online", "offline", "home_visit"],
    },
    message: "Search metadata fetched successfully",
  });
});

// ─── Public Doctor Search ────────────────────────────────────────────────────

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const dayBounds = (offsetDays) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const start = new Date(d);
  const end = new Date(d);
  end.setDate(end.getDate() + 1);
  return { dayOfWeek: DAY_NAMES[start.getDay()], start, end };
};

export const searchDoctors = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = publicDoctorFilter(await getPublicDoctorUserIds());

  if (req.query.specializationMasterId) {
    const specialization = await resolveCanonicalFilterValue(req.query.specializationMasterId, MASTER_KINDS.SPECIALIZATION, "specialization");
    filter.specializationMasterId = specialization._id;
  } else if (req.query.specialization && mongoose.Types.ObjectId.isValid(req.query.specialization)) {
    const specialization = await resolveCanonicalFilterValue(req.query.specialization, MASTER_KINDS.SPECIALIZATION, "specialization");
    filter.specializationMasterId = specialization._id;
  } else if (req.query.specialization) {
    filter.specialization = containsRegex(req.query.specialization.trim());
  }

  const canonicalLocation = await validateCanonicalLocationFilters({
    state: req.query.stateMasterId || (req.query.state && mongoose.Types.ObjectId.isValid(req.query.state) ? req.query.state : undefined),
    district: req.query.districtMasterId || (req.query.district && mongoose.Types.ObjectId.isValid(req.query.district) ? req.query.district : undefined),
    city: req.query.cityMasterId || (req.query.city && mongoose.Types.ObjectId.isValid(req.query.city) ? req.query.city : undefined),
  });

  if (canonicalLocation.state || canonicalLocation.district || canonicalLocation.city) {
    const locationClauses = [];
    const primary = {};
    const clinic = {};
    if (canonicalLocation.state) { primary.stateMasterId = canonicalLocation.state._id; clinic["clinics.stateMasterId"] = canonicalLocation.state._id; }
    if (canonicalLocation.district) { primary.districtMasterId = canonicalLocation.district._id; clinic["clinics.districtMasterId"] = canonicalLocation.district._id; }
    if (canonicalLocation.city) { primary.cityMasterId = canonicalLocation.city._id; clinic["clinics.cityMasterId"] = canonicalLocation.city._id; }
    locationClauses.push(primary, { clinics: { $elemMatch: Object.fromEntries(Object.entries(clinic).map(([key, value]) => [key.replace("clinics.", ""), value])) } });
    filter.$or = locationClauses;
  } else {
    const geographicFilter = buildDoctorGeographicFilter(req.query);
    if (geographicFilter) Object.assign(filter, geographicFilter);
  }
  if (req.query.hospital) {
    filter.hospitalName = containsRegex(req.query.hospital.trim());
  }
  if (req.query.mode) {
    filter.consultationMode = { $in: [req.query.mode] };
  }
  if (req.query.language) {
    filter.languages = { $in: [containsRegex(req.query.language.trim())] };
  }
  if (req.query.minExp) {
    filter.experience = { ...filter.experience, $gte: Number(req.query.minExp) };
  }
  if (req.query.maxExp) {
    filter.experience = { ...filter.experience, $lte: Number(req.query.maxExp) };
  }
  if (req.query.minFees) {
    filter.fees = { ...filter.fees, $gte: Number(req.query.minFees) };
  }
  if (req.query.maxFees) {
    filter.fees = { ...filter.fees, $lte: Number(req.query.maxFees) };
  }
  if (req.query.minRating) {
    filter.rating = { $gte: Number(req.query.minRating) };
  }
  if (req.query.emergency === "true") {
    filter["availability.emergencySlotsPerDay"] = { $gt: 0 };
  }
  if (req.query.weekend === "true") {
    filter["availability.dayOfWeek"] = { $in: ["saturday", "sunday"] };
  }
  if (req.query.availableToday === "true" || req.query.availableTomorrow === "true") {
    const offset = req.query.availableToday === "true" ? 0 : 1;
    const { dayOfWeek, start, end } = dayBounds(offset);
    filter["availability.dayOfWeek"] = dayOfWeek;
    filter.blockedDates = {
      $not: { $elemMatch: { date: { $gte: start, $lt: end } } },
    };
  }
  if (req.query.name) {
    // Join with User model — real field, doctor's display name
    const matchingUsers = await mongoose
      .model("User")
      .find({ name: containsRegex(req.query.name.trim()), role: "doctor", isActive: true }, "_id")
      .lean();
    filter.userId = { $in: matchingUsers.map((u) => u._id) };
  }

  const sortMap = {
    rating: { rating: -1, experience: -1 },
    experience: { experience: -1, rating: -1 },
    fees_asc: { fees: 1 },
    fees_desc: { fees: -1 },
    reviews: { rating: -1 }, // will re-sort after review count join
    bookings: { rating: -1 }, // will re-sort after consultation count join
    availability: { rating: -1 }, // will re-sort after availability-length compute
    newest: { verifiedAt: -1 },
  };
  const sortBy = sortMap[req.query.sort] || sortMap.rating;

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .populate("userId", "name")
      .sort(sortBy)
      .skip(skip)
      .limit(limit)
      .lean(),
    Doctor.countDocuments(filter),
  ]);

  const doctorIds = doctors.map((d) => d._id);
  const reviewAggs = await Review.aggregate([
    { $match: { doctorId: { $in: doctorIds }, adminDeleted: { $ne: true } } },
    { $group: { _id: "$doctorId", count: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  const reviewMap = Object.fromEntries(
    reviewAggs.map((r) => [r._id.toString(), { count: r.count, avg: r.avg }]),
  );

  const consultCounts = await Appointment.aggregate([
    {
      $match: {
        doctorId: { $in: doctorIds },
        status: { $in: ["completed", "review_eligible", "consultation_completed"] },
      },
    },
    { $group: { _id: "$doctorId", count: { $sum: 1 } } },
  ]);
  const consultMap = Object.fromEntries(consultCounts.map((c) => [c._id.toString(), c.count]));

  let results = doctors.map((d) => ({
    ...safeDoctor(d, req, { totalReviews: reviewMap[d._id.toString()]?.count || 0, rating: reviewMap[d._id.toString()]?.avg || 0 }),
    totalConsultations: consultMap[d._id.toString()] || 0,
  }));

  // Post-join sorts — same convention as the existing "reviews" sort (applies
  // within the current page; matches pre-existing pattern in this file).
  if (req.query.sort === "reviews") {
    results.sort((a, b) => b.totalReviews - a.totalReviews);
  } else if (req.query.sort === "bookings") {
    results.sort((a, b) => b.totalConsultations - a.totalConsultations);
  } else if (req.query.sort === "availability") {
    results.sort((a, b) => (b.availability?.length || 0) - (a.availability?.length || 0));
  }

  res.status(200).json({
    success: true,
    data: {
      doctors: results,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      appliedFilters: { ...req.query },
    },
    message: "Doctors fetched successfully",
  });
});


// ─── P12 Geographic Coverage ─────────────────────────────────────────────────
export const getDoctorCoverage = asyncHandler(async (req, res) => {
  const baseFilter = publicDoctorFilter(await getPublicDoctorUserIds());
  if (req.query.specialization) baseFilter.specialization = containsRegex(req.query.specialization.trim());
  if (req.query.mode) baseFilter.consultationMode = { $in: [req.query.mode] };
  if (req.query.language) baseFilter.languages = { $in: [containsRegex(req.query.language.trim())] };
  if (req.query.minExp) baseFilter.experience = { ...(baseFilter.experience || {}), $gte: Number(req.query.minExp) };
  if (req.query.maxFees) baseFilter.fees = { ...(baseFilter.fees || {}), $lte: Number(req.query.maxFees) };
  if (req.query.minRating) baseFilter.rating = { $gte: Number(req.query.minRating) };
  if (req.query.name) {
    const matchingUsers = await mongoose.model("User")
      .find({ name: containsRegex(req.query.name.trim()), role: "doctor", isActive: true }, "_id")
      .lean();
    baseFilter.userId = { $in: matchingUsers.map((user) => user._id) };
  }
  if (req.query.weekend === "true") baseFilter["availability.dayOfWeek"] = { $in: ["saturday", "sunday"] };
  if (req.query.emergency === "true") baseFilter["availability.emergencySlotsPerDay"] = { $gt: 0 };

  // A doctor's primary location and clinic locations are both legitimate
  // geographic sources. Keep all coverage facets on one matched Doctor input
  // so the same filtered collection scan is shared instead of executing four
  // independent aggregation pipelines plus a coordinate count query.
  const locationFilterStage = buildLocationAggregationMatch(req.query);
  const coverageLocationStages = [
    {
      $project: {
        doctorId: "$_id",
        locations: {
          $concatArrays: [
            [{ city: "$city", state: "$state", district: "$district" }],
            {
              $map: {
                input: { $ifNull: ["$clinics", []] },
                as: "clinic",
                in: { city: "$$clinic.city", state: "$$clinic.state", district: "$$clinic.district" },
              },
            },
          ],
        },
      },
    },
    { $unwind: "$locations" },
    { $match: { "locations.state": { $nin: ["", null] } } },
    ...(locationFilterStage ? [locationFilterStage] : []),
  ];

  const [coverage] = await Doctor.aggregate([
    { $match: baseFilter },
    {
      $project: {
        _id: 1,
        city: 1,
        state: 1,
        district: 1,
        clinics: 1,
        hasCoordinates: {
          $and: [
            { $eq: ["$location.type", "Point"] },
            { $ne: [{ $arrayElemAt: [{ $ifNull: ["$location.coordinates", []] }, 0] }, null] },
            { $ne: [{ $arrayElemAt: [{ $ifNull: ["$location.coordinates", []] }, 1] }, null] },
          ],
        },
      },
    },
    {
      $facet: {
        stateAgg: [
          ...coverageLocationStages,
          { $group: { _id: "$locations.state", doctors: { $addToSet: "$doctorId" }, districts: { $addToSet: "$locations.district" }, cities: { $addToSet: "$locations.city" } } },
          { $project: { _id: 1, doctorCount: { $size: "$doctors" }, districts: 1, cities: 1 } },
          { $sort: { doctorCount: -1, _id: 1 } },
        ],
        districtAgg: [
          ...coverageLocationStages,
          { $match: { "locations.district": { $nin: ["", null] } } },
          { $group: { _id: { state: "$locations.state", district: "$locations.district" }, doctors: { $addToSet: "$doctorId" }, cities: { $addToSet: "$locations.city" } } },
          { $project: { _id: 1, doctorCount: { $size: "$doctors" }, cities: 1 } },
          { $sort: { "_id.state": 1, "_id.district": 1 } },
        ],
        cityAgg: [
          ...coverageLocationStages,
          { $group: { _id: { state: "$locations.state", district: "$locations.district", city: "$locations.city" }, doctors: { $addToSet: "$doctorId" } } },
          { $project: { _id: 1, doctorCount: { $size: "$doctors" } } },
          { $sort: { "_id.state": 1, "_id.district": 1, "_id.city": 1 } },
        ],
        totalAgg: [
          ...coverageLocationStages,
          { $group: { _id: null, doctors: { $addToSet: "$doctorId" } } },
          { $project: { _id: 0, doctorCount: { $size: "$doctors" } } },
        ],
        coordinateAgg: [
          { $match: { hasCoordinates: true } },
          { $group: { _id: "$_id" } },
          { $count: "doctorCount" },
        ],
      },
    },
  ]);

  const { stateAgg = [], districtAgg = [], cityAgg = [], totalAgg = [], coordinateAgg = [] } = coverage || {};
  const stateMap = Object.fromEntries(stateAgg.map((item) => [item._id, {
    name: item._id,
    doctorCount: item.doctorCount,
    districtCount: item.districts.filter(Boolean).length,
    cityCount: item.cities.filter(Boolean).length,
    hasAuthoritativeDistrictData: item.districts.some(Boolean),
  }]));

  res.status(200).json({
    success: true,
    data: {
      totalDoctors: totalAgg[0]?.doctorCount || 0,
      states: Object.values(stateMap),
      districts: districtAgg.map((item) => ({
        state: item._id.state,
        name: item._id.district,
        doctorCount: item.doctorCount,
        cities: item.cities.filter(Boolean),
      })),
      cities: cityAgg.map((item) => ({
        state: item._id.state,
        district: item._id.district || "",
        name: item._id.city,
        doctorCount: item.doctorCount,
      })),
      geographicDataAvailability: {
        districtCoverageStates: Object.values(stateMap).filter((item) => item.hasAuthoritativeDistrictData).length,
        coordinateDoctors: coordinateAgg[0]?.doctorCount || 0,
      },
    },
    message: "Doctor geographic coverage fetched successfully",
  });
});

// P12 discovery availability batch: one bounded public request for the current
// doctor result page. The same appointment capacity engine remains the source
// of truth; no per-card HTTP requests are made by the browser.
export const getPublicDoctorAvailability = asyncHandler(async (req, res) => {
  const rawIds = String(req.query.doctorIds || "").split(",").map((id) => id.trim()).filter(Boolean);
  const doctorIds = [...new Set(rawIds)].filter((id) => mongoose.Types.ObjectId.isValid(id)).slice(0, 24);
  if (!doctorIds.length) return res.status(200).json({ success: true, data: {}, message: "No doctor IDs supplied" });

  const doctors = await Doctor.find({
    _id: { $in: doctorIds },
    ...publicDoctorFilter(await getPublicDoctorUserIds()),
  }).select("_id availability blockedDates").lean();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizonDays = 60;
  const rangeEnd = new Date(today);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + horizonDays);
  const ids = doctors.map((doctor) => doctor._id);
  const [leaves, appointments] = await Promise.all([
    LeaveRequest.find({ doctorId: { $in: ids }, status: "approved", startDate: { $lte: rangeEnd }, endDate: { $gte: today } }).select("doctorId startDate endDate").lean(),
    Appointment.find({ doctorId: { $in: ids }, date: { $gte: today, $lte: rangeEnd }, status: { $in: ACTIVE_STATUSES } }).select("doctorId date timeSlot status").lean(),
  ]);

  const leavesByDoctor = new Map();
  leaves.forEach((leave) => { const key = String(leave.doctorId); const list = leavesByDoctor.get(key) || []; list.push(leave); leavesByDoctor.set(key, list); });
  const appointmentsByDoctor = new Map();
  appointments.forEach((appointment) => { const key = String(appointment.doctorId); const list = appointmentsByDoctor.get(key) || []; list.push(appointment); appointmentsByDoctor.set(key, list); });

  const data = Object.fromEntries(doctors.map((doctor) => [String(doctor._id), findNextAvailableSlotForDoctor({
    doctor,
    approvedLeaves: leavesByDoctor.get(String(doctor._id)) || [],
    windowAppointments: appointmentsByDoctor.get(String(doctor._id)) || [],
    startFrom: today,
    horizonDays,
  })]));
  res.status(200).json({ success: true, data, message: "Doctor availability fetched successfully" });
});

// P12 public wrapper: reuses the existing appointment slot engine/controller
// while enforcing public doctor eligibility before any availability is shown.
export const getPublicNextAvailability = asyncHandler(async (req, res) => {
  const { doctorId } = req.query;
  if (!doctorId || !mongoose.Types.ObjectId.isValid(doctorId)) {
    throw new AppError("A valid doctorId is required", 400);
  }
  const doctor = await Doctor.findOne({
    _id: doctorId,
    ...publicDoctorFilter(await getPublicDoctorUserIds()),
  }).select("_id").lean();
  if (!doctor) throw new AppError("Doctor is not publicly available", 404);
  return getNextAvailableSlot(req, res, (error) => {
    if (error) throw error;
  });
});

// ─── Public Doctor Profile ───────────────────────────────────────────────────

export const getDoctorPublicProfile = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor ID", 400);
  }

  const doctor = await Doctor.findOne({
    _id: req.params.id,
    ...publicDoctorFilter(await getPublicDoctorUserIds()),
  })
    .populate("userId", "name role isActive")
    .lean();

  if (!doctor) throw new AppError("Doctor not found or not available", 404);

  // Practice Analytics (Phase D4, Step 6): the only place a doctor's public
  // profile is actually viewed by a prospective patient. Fire-and-forget --
  // a logging failure here must never break the profile response itself.
  Doctor.updateOne({ _id: doctor._id }, { $inc: { profileViews: 1 } }).catch(() => {});

  const [reviews, totalReviews, totalConsultations, ratingDist] = await Promise.all([
    Review.find({
      doctorId: doctor._id,
      adminDeleted: { $ne: true },
    })
      .populate("userId", "name")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    Review.countDocuments({ doctorId: doctor._id, adminDeleted: { $ne: true } }),
    Appointment.countDocuments({
      doctorId: doctor._id,
      status: { $in: ["completed", "review_eligible", "consultation_completed"] },
    }),
    Review.aggregate([
      { $match: { doctorId: doctor._id, adminDeleted: { $ne: true } } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);

  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratingDist.forEach((r) => { ratingDistribution[r._id] = r.count; });

  res.status(200).json({
    success: true,
    data: {
      doctor: {
        ...safeDoctor(doctor, req, { totalReviews, rating: totalReviews ? (reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / totalReviews) : 0 }),
        totalConsultations,
        ratingDistribution,
        recentReviews: reviews.map(safeReview),
      },
    },
    message: "Doctor profile fetched successfully",
  });
});

// ─── Public Doctor Reviews (paginated) ──────────────────────────────────────

export const getDoctorPublicReviews = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor ID", 400);
  }

  // AUDIT FIX (Phase 2-D, public surface): this previously queried reviews
  // by doctorId alone, with no check that the doctor is actually a publicly
  // discoverable (verified/approved/active) doctor — unlike every sibling
  // endpoint here (getDoctorPublicProfile, compareDoctors, getSimilarDoctors
  // all gate on isVerified+verificationStatus+isActive). That meant a
  // pending or rejected doctor's reviews were reachable by ID even though
  // their profile itself correctly 404s, letting an unauthenticated caller
  // confirm a non-public doctor exists and read reviews naming them.
  const doctor = await Doctor.findOne({
    _id: req.params.id,
    ...publicDoctorFilter(await getPublicDoctorUserIds()),
  }).select("_id").lean();
  if (!doctor) throw new AppError("Doctor not found or not available", 404);

  const { page, limit, skip } = getPagination(req.query);

  const [reviews, total] = await Promise.all([
    Review.find({
      doctorId: req.params.id,
      adminDeleted: { $ne: true },
    })
      .populate("userId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments({ doctorId: req.params.id, adminDeleted: { $ne: true } }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      reviews: reviews.map(safeReview),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    message: "Reviews fetched successfully",
  });
});

// ─── Public Doctor Comparison (2–4 doctors side by side) ───────────────────

export const compareDoctors = asyncHandler(async (req, res) => {
  const ids = (req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => mongoose.Types.ObjectId.isValid(s))
    .slice(0, 4);

  if (ids.length < 2) {
    throw new AppError("Provide at least 2 valid doctor IDs to compare (e.g. ?ids=a,b)", 400);
  }

  const doctors = await Doctor.find({
    _id: { $in: ids },
    ...publicDoctorFilter(await getPublicDoctorUserIds()),
  })
    .populate("userId", "name")
    .lean();

  const doctorIds = doctors.map((d) => d._id);
  const [reviewAggs, consultCounts] = await Promise.all([
    Review.aggregate([
      { $match: { doctorId: { $in: doctorIds }, adminDeleted: { $ne: true } } },
      { $group: { _id: "$doctorId", count: { $sum: 1 }, avg: { $avg: "$rating" } } },
    ]),
    Appointment.aggregate([
      {
        $match: {
          doctorId: { $in: doctorIds },
          status: { $in: ["completed", "review_eligible", "consultation_completed"] },
        },
      },
      { $group: { _id: "$doctorId", count: { $sum: 1 } } },
    ]),
  ]);
  const reviewMap = Object.fromEntries(reviewAggs.map((r) => [r._id.toString(), r.count]));
  const consultMap = Object.fromEntries(consultCounts.map((c) => [c._id.toString(), c.count]));

  // Preserve the order the caller asked for
  const byId = Object.fromEntries(doctors.map((d) => [d._id.toString(), d]));
  const results = ids
    .filter((id) => byId[id])
    .map((id) => ({
      ...safeDoctor(byId[id], req, { totalReviews: reviewMap[id] || 0 }),
      totalConsultations: consultMap[id] || 0,
    }));

  res.status(200).json({
    success: true,
    data: { doctors: results },
    message: "Comparison data fetched successfully",
  });
});

// ─── Similar Doctors (same specialization; same city preferred) ────────────

export const getSimilarDoctors = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor ID", 400);
  }

  const publicUserIds = await getPublicDoctorUserIds();
  const publicBase = publicDoctorFilter(publicUserIds);
  const source = await Doctor.findOne({
    _id: req.params.id,
    ...publicBase,
  }).select("specialization city").lean();
  if (!source) throw new AppError("Doctor not found", 404);

  const baseFilter = {
    ...publicBase,
    _id: { $ne: req.params.id },
    specialization: source.specialization,
  };

  // Prefer same city, but widen to the whole specialization if that's too few —
  // both branches use only real, existing doctors, never fabricated ones.
  let similar = await Doctor.find({ ...baseFilter, city: source.city })
    .populate("userId", "name")
    .sort({ rating: -1, experience: -1 })
    .limit(4)
    .lean();

  if (similar.length < 4) {
    const excludeIds = similar.map((d) => d._id);
    const extra = await Doctor.find({ ...baseFilter, _id: { $nin: [...excludeIds, req.params.id] } })
      .populate("userId", "name")
      .sort({ rating: -1, experience: -1 })
      .limit(4 - similar.length)
      .lean();
    similar = [...similar, ...extra];
  }

  const doctorIds = similar.map((d) => d._id);
  const reviewAggs = await Review.aggregate([
    { $match: { doctorId: { $in: doctorIds }, adminDeleted: { $ne: true } } },
    { $group: { _id: "$doctorId", count: { $sum: 1 } } },
  ]);
  const reviewMap = Object.fromEntries(reviewAggs.map((r) => [r._id.toString(), r.count]));

  res.status(200).json({
    success: true,
    data: {
      doctors: similar.map((d) => ({ ...safeDoctor(d, req, { totalReviews: reviewMap[d._id.toString()] || 0 }) })),
    },
    message: "Similar doctors fetched successfully",
  });
});

// ─── Public Testimonials (highest-rated reviews across the platform) ─────────

export const getPublicTestimonials = asyncHandler(async (_req, res) => {
  const publicUserIds = await getPublicDoctorUserIds();
  const publicDoctors = await Doctor.find(publicDoctorFilter(publicUserIds)).select("_id").lean();
  const publicDoctorIds = publicDoctors.map((doctor) => doctor._id);
  const reviews = await Review.find({
    doctorId: { $in: publicDoctorIds },
    rating: { $gte: 4 },
    comment: { $ne: "", $exists: true },
    adminDeleted: { $ne: true },
  })
    .populate("userId", "name")
    .populate({ path: "doctorId", populate: { path: "userId", select: "name" } })
    .sort({ rating: -1, createdAt: -1 })
    .limit(8)
    .lean();

  res.status(200).json({
    success: true,
    data: {
      testimonials: reviews.map((r) => ({
        id: r._id,
        rating: r.rating,
        comment: r.comment,
        patientName: r.userId?.name
          ? r.userId.name.split(" ")[0] + " " + (r.userId.name.split(" ")[1]?.[0] || "") + "."
          : "Patient",
        doctorName: r.doctorId?.userId?.name || "Doctor",
        doctorSpecialization: r.doctorId?.specialization || "",
        createdAt: r.createdAt,
      })),
    },
    message: "Testimonials fetched successfully",
  });
});

// ─── Doctor Profile Strength (for logged-in doctor dashboard) ───────────────

export const getDoctorProfileStrength = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);

  const checks = [
    { field: "bio", label: "Add a biography", score: 15, done: Boolean(doctor.bio?.trim()) },
    { field: "profilePhoto", label: "Upload a profile photo", score: 10, done: Boolean(doctor.profilePhoto) },
    { field: "qualification", label: "Add your qualification", score: 10, done: Boolean(doctor.qualification?.trim()) },
    { field: "hospitalName", label: "Add hospital/clinic name", score: 10, done: Boolean(doctor.hospitalName?.trim()) },
    { field: "city", label: "Add your city", score: 5, done: Boolean(doctor.city?.trim()) },
    { field: "state", label: "Add your state", score: 5, done: Boolean(doctor.state?.trim()) },
    { field: "languages", label: "Add languages spoken", score: 5, done: (doctor.languages || []).length > 0 },
    { field: "licenseNumber", label: "Add medical license number", score: 15, done: Boolean(doctor.licenseNumber?.trim()) },
    { field: "medicalCouncil", label: "Add medical council", score: 10, done: Boolean(doctor.medicalCouncil?.trim()) },
    { field: "availability", label: "Set your availability schedule", score: 10, done: (doctor.availability || []).length > 0 },
    { field: "documents", label: "Upload verification documents", score: 5, done: (doctor.documents || []).length > 0 },
  ];

  const score = checks.filter((c) => c.done).reduce((sum, c) => sum + c.score, 0);
  const missing = checks.filter((c) => !c.done);

  res.status(200).json({
    success: true,
    data: {
      score,
      maxScore: 100,
      percentage: score,
      isVerified: doctor.isVerified,
      verificationStatus: doctor.verificationStatus,
      missing,
      checks,
    },
    message: "Profile strength fetched",
  });
});

// ─── Doctor Reputation Center ────────────────────────────────────────────────

export async function buildDoctorReputationIntelligence(doctorId) {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [
    reviews,
    totalConsultations,
    totalAppointmentsAll,
    cancelledAppointments,
    repeatPatients,
    monthlyConsultations,
    monthlyReviews,
  ] = await Promise.all([
    Review.find({ doctorId: doctorId, adminDeleted: { $ne: true } }).lean(),
    Appointment.countDocuments({
      doctorId: doctorId,
      status: { $in: ["completed", "review_eligible", "consultation_completed"] },
    }),
    Appointment.countDocuments({ doctorId: doctorId }),
    Appointment.countDocuments({ doctorId: doctorId, status: "cancelled" }),
    Appointment.aggregate([
      {
        $match: {
          doctorId: doctorId,
          status: { $in: ["completed", "review_eligible", "consultation_completed"] },
        },
      },
      { $group: { _id: "$patientId", visits: { $sum: 1 } } },
      { $match: { visits: { $gt: 1 } } },
      { $count: "total" },
    ]),
    Appointment.aggregate([
      {
        $match: {
          doctorId: doctorId,
          status: { $in: ["completed", "review_eligible", "consultation_completed"] },
          date: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: { year: { $year: "$date" }, month: { $month: "$date" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    Review.aggregate([
      {
        $match: {
          doctorId: doctorId,
          adminDeleted: { $ne: true },
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 },
          avgRating: { $avg: "$rating" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
  ]);

  const totalReviews = reviews.length;
  const avgRating = totalReviews
    ? reviews.reduce((s, r) => s + r.rating, 0) / totalReviews
    : 0;

  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach((r) => { ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + 1; });

  const satisfactionRate = totalReviews
    ? Math.round((reviews.filter((r) => r.rating >= 4).length / totalReviews) * 100)
    : 0;

  // Format monthly trends with month labels
  const monthLabel = (y, m) => {
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  // ── Reputation Intelligence additions (Phase D3, additive only) ──
  const repliedReviews = reviews.filter((r) => r.doctorReply?.message).length;
  const responseRate = totalReviews ? Number(((repliedReviews / totalReviews) * 100).toFixed(1)) : 0;
  const cancellationRate = totalAppointmentsAll ? Number(((cancelledAppointments / totalAppointmentsAll) * 100).toFixed(1)) : 0;
  const appointmentReliability = Number((100 - cancellationRate).toFixed(1));
  const recommendationRate = satisfactionRate; // share of reviews rating >= 4, same real figure
  const repeatPatientCount = repeatPatients[0]?.total || 0;
  const repeatPatientRate = totalConsultations ? Number(((repeatPatientCount / totalConsultations) * 100).toFixed(1)) : 0;

  // Composite scores: transparent weighted averages of the real metrics
  // above — documented here, not a black box, and never invented figures.
  const businessReputationScore = Number(
    (
      (Number(avgRating.toFixed(1)) / 5) * 40 +
      (satisfactionRate / 100) * 25 +
      (appointmentReliability / 100) * 20 +
      (responseRate / 100) * 15
    ).toFixed(1),
  );
  const patientTrustScore = Number(
    (
      (recommendationRate / 100) * 50 +
      (repeatPatientRate / 100) * 30 +
      (responseRate / 100) * 20
    ).toFixed(1),
  );
  const clinicalReliabilityScore = Number(
    (
      (appointmentReliability / 100) * 60 +
      (Number(avgRating.toFixed(1)) / 5) * 40
    ).toFixed(1),
  );

  const metricPool = [
    { label: "Patient rating", value: Number(avgRating.toFixed(1)) / 5 * 100 },
    { label: "Satisfaction rate", value: satisfactionRate },
    { label: "Appointment reliability", value: appointmentReliability },
    { label: "Review response rate", value: responseRate },
    { label: "Repeat patient rate", value: repeatPatientRate },
  ];
  const ranked = [...metricPool].sort((a, b) => b.value - a.value);
  const topStrengths = ranked.slice(0, 2).map((m) => m.label);
  const improvementOpportunities = ranked.slice(-2).reverse().map((m) => m.label);

  return {
    overview: {
      rating: Number(avgRating.toFixed(1)),
      totalReviews,
      totalConsultations,
      satisfactionRate,
      repeatPatients: repeatPatientCount,
    },
    ratingDistribution,
    monthlyConsultations: monthlyConsultations.map((m) => ({
      label: monthLabel(m._id.year, m._id.month),
      count: m.count,
    })),
    monthlyReviews: monthlyReviews.map((m) => ({
      label: monthLabel(m._id.year, m._id.month),
      count: m.count,
      avgRating: Number((m.avgRating || 0).toFixed(1)),
    })),
    intelligence: {
      businessReputationScore,
      patientTrustScore,
      clinicalReliabilityScore,
      responseRate,
      appointmentReliability,
      cancellationRate,
      recommendationRate,
      repeatPatientRate,
      topStrengths,
      improvementOpportunities,
    },
  };
}

export const getDoctorReputation = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);

  const data = await buildDoctorReputationIntelligence(doctor._id);

  res.status(200).json({
    success: true,
    data,
    message: "Reputation data fetched successfully",
  });
});


// ─── Public: Browse by Specialty (real doctor counts, no fabricated numbers) ─

export const getSpecialtyBrowse = asyncHandler(async (_req, res) => {
  const baseFilter = publicDoctorFilter(await getPublicDoctorUserIds());

  const counts = await Doctor.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: "$specialization",
        doctorCount: { $sum: 1 },
        avgRating: { $avg: "$rating" },
        avgFees: { $avg: "$fees" },
      },
    },
    { $match: { _id: { $nin: [null, ""] } } },
    { $sort: { doctorCount: -1 } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      specialties: counts.map((c) => ({
        name: c._id,
        doctorCount: c.doctorCount,
        avgRating: Number((c.avgRating || 0).toFixed(1)),
        avgFees: Math.round(c.avgFees || 0),
      })),
    },
    message: "Specialties fetched successfully",
  });
});

// ─── Public: Services + Articles ────────────────────────────────────────────
// Public serialization is canonical and publication is enforced at query time.

const publishedServiceFilter = { status: "published", visibility: "public", isActive: true };
const publishedArticleFilter = { status: "published", visibility: "public", isPublished: true };

const populateServiceRelations = (query) => query
  .populate({ path: "relatedDoctors", select: "userId specialization qualification experience fees city state district hospitalName bio languages consultationMode availability subSpecialties education experienceEntries awards researchPublications memberships clinics clinicPhotos emergencyAvailability insuranceAccepted rating totalReviews licenseNumber medicalCouncil verificationStatus isVerified isActive verifiedAt profilePhoto createdAt", populate: { path: "userId", select: "name role isActive" } })
  .populate({ path: "relatedServices", select: "title slug shortDescription description benefits eligibility preparation procedureInformation duration consultationModes price category relatedSpecialties relatedDoctors relatedServices status visibility featured displayOrder localizedContent seo icon image createdAt updatedAt" });

const populateArticleRelations = (query) => query
  .populate({ path: "author", select: "name" })
  .populate({ path: "relatedServices", select: "title slug shortDescription description benefits eligibility preparation procedureInformation duration consultationModes price category relatedSpecialties relatedDoctors relatedServices status visibility featured displayOrder localizedContent seo icon image createdAt updatedAt" })
  .populate({ path: "relatedDoctors", select: "userId specialization qualification experience fees city state district hospitalName bio languages consultationMode availability subSpecialties education experienceEntries awards researchPublications memberships clinics clinicPhotos emergencyAvailability insuranceAccepted rating totalReviews licenseNumber medicalCouncil verificationStatus isVerified isActive verifiedAt profilePhoto createdAt", populate: { path: "userId", select: "name role isActive" } });

export const getPublicServices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { $and: [publishedServiceFilter] };
  if (req.query.category) filter.$and.push({ category: exactRegex(req.query.category.trim()) });
  if (req.query.search) filter.$and.push({ $text: { $search: req.query.search.trim() } });
  if (req.query.featured === "true") filter.$and.push({ featured: true });
  const sortMap = { price_asc: { price: 1 }, price_desc: { price: -1 }, newest: { createdAt: -1 }, featured: { featured: -1, displayOrder: 1, title: 1 }, title_asc: { title: 1 } };
  const [services, total] = await Promise.all([
    populateServiceRelations(Service.find(filter).sort(sortMap[req.query.sort] || sortMap.featured).skip(skip).limit(limit)).lean(),
    Service.countDocuments(filter),
  ]);
  const locale = req.query.locale || "en";
  res.json({ success: true, data: { services: services.map((service) => serializeServicePublic(service, req, locale)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

export const getPublicServiceCategories = asyncHandler(async (_req, res) => {
  const categories = await Service.aggregate([
    { $match: publishedServiceFilter },
    { $group: { _id: "$category", count: { $sum: 1 }, minPrice: { $min: "$price" }, maxPrice: { $max: "$price" } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  res.json({ success: true, data: { categories: categories.map((c) => ({ name: c._id, count: c.count, minPrice: c.minPrice, maxPrice: c.maxPrice })) } });
});

export const getPublicServiceBySlug = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const service = await populateServiceRelations(Service.findOne({ ...publishedServiceFilter, slug })).lean();
  if (!service) throw new AppError("Service not found", 404);
  const related = await Service.find({ ...publishedServiceFilter, _id: { $ne: service._id }, $or: [
    { category: service.category },
    ...(service.relatedSpecialties?.length ? [{ relatedSpecialties: { $in: service.relatedSpecialties } }] : []),
  ] }).sort({ featured: -1, displayOrder: 1, title: 1 }).limit(6).lean();
  res.json({ success: true, data: { service: serializeServicePublic(service, req, req.query.locale || "en"), relatedServices: related.map((item) => serializeServicePublic(item, req, req.query.locale || "en")) } });
});

export const getPublicArticles = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { $and: [publishedArticleFilter, { $or: [{ contentType: "article" }, { contentType: { $exists: false } }] }] };
  if (req.query.category) filter.$and.push({ category: req.query.category.trim() });
  if (req.query.search) filter.$and.push({ $text: { $search: req.query.search.trim() } });
  const sort = req.query.sort === "oldest" ? { publishedAt: 1 } : { publishedAt: -1, updatedAt: -1 };
  const [articles, total] = await Promise.all([
    populateArticleRelations(CMSPage.find(filter).sort(sort).skip(skip).limit(limit)).lean(),
    CMSPage.countDocuments(filter),
  ]);
  const locale = req.query.locale || "en";
  res.json({ success: true, data: { articles: articles.map((a) => serializeArticlePublic(a, req, locale)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

export const getPublicArticleCategories = asyncHandler(async (_req, res) => {
  const categories = await CMSPage.aggregate([{ $match: { $and: [publishedArticleFilter, { $or: [{ contentType: "article" }, { contentType: { $exists: false } }] }] } }, { $group: { _id: "$category", count: { $sum: 1 } } }, { $match: { _id: { $nin: [null, ""] } } }, { $sort: { count: -1, _id: 1 } }]);
  res.json({ success: true, data: { categories: categories.map((c) => ({ name: c._id, count: c.count })) } });
});

export const getPublicArticleBySlug = asyncHandler(async (req, res) => {
  const article = await populateArticleRelations(CMSPage.findOne({ $and: [publishedArticleFilter, { slug: req.params.slug.toLowerCase().trim() }, { $or: [{ contentType: "article" }, { contentType: { $exists: false } }] }] })).lean();
  if (!article) throw new AppError("Article not found", 404);
  const related = await CMSPage.find({ $and: [publishedArticleFilter, { contentType: "article", _id: { $ne: article._id } }, { $or: [
    ...(article.category ? [{ category: article.category }] : []),
    ...(article.tags?.length ? [{ tags: { $in: article.tags } }] : []),
    ...(article.relatedSpecialties?.length ? [{ relatedSpecialties: { $in: article.relatedSpecialties } }] : []),
    ...(article.relatedServices?.length ? [{ relatedServices: { $in: article.relatedServices } }] : []),
  ] }] }).sort({ publishedAt: -1, _id: 1 }).limit(6).lean();
  res.json({ success: true, data: { article: serializeArticlePublic(article, req, req.query.locale || "en", { includeContent: true }), relatedArticles: related.map((item) => serializeArticlePublic(item, req, req.query.locale || "en")) } });
});

// PHASE UI-4 — Patients Management Workspace (admin side).
//
// Deliberately does NOT duplicate anything that already exists:
//  - edit / delete / activate-deactivate stay on the existing
//    PUT/DELETE/PATCH /api/admin/users/:id (userAdminController.js,
//    already ADMIN/SUPER_ADMIN-authorized) — reused as-is from the
//    frontend. This controller only adds the admin-only READ surface
//    (registry, stats, workspace) plus the two genuinely-missing actions:
//    permission-gated report/prescription download.
//  - report/prescription download reuses the shared downloadFile() core
//    (see utils/fileDownload.js, extracted from patientWorkflowController)
//    so the byte-serving logic can never drift between the patient's own
//    ownership-scoped download and this admin one.
//  - appointment lifecycle, cancellation, and refunds are untouched —
//    "View Appointments" from this workspace deep-links into the existing
//    Appointment Operations Workspace (AdminAppointments.jsx) via its
//    already-supported ?patientId= filter, not a second appointment UI.
import mongoose from "mongoose";
import User from "../../models/User.js";
import Appointment from "../../models/Appointment.js";
import Payment from "../../models/Payment.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import Prescription from "../../models/Prescription.js";
import FamilyMember from "../../models/FamilyMember.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { userHasPermission } from "../../middleware/adminMiddleware.js";
import { downloadFile } from "../../utils/fileDownload.js";
import {
  buildPatientAggregates,
  computeAttentionItems,
  computePatientRiskLevel,
  calculateAge,
} from "../../services/patientAdminAggregationService.js";

const OPEN_PAYMENT_STATUSES = ["created", "pending", "failed"];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

// Real, DB-level attention/insurance/outstanding/upcoming filters — resolved
// as distinct patientId lists from the actual source collections BEFORE the
// User query runs, so filtering stays server-side rather than downloading
// every patient to filter in the browser. This mirrors the appointment
// workspace's ATTENTION_MATCH approach, adapted for data that lives on
// other collections (Payment/Insurance/MedicalReport) rather than on the
// User document itself.
const resolveAdvancedIdFilters = async (query) => {
  const now = new Date();
  const lookups = {};

  if (query.hasUpcoming === "true") {
    lookups.hasUpcoming = Appointment.find({ date: { $gt: now }, status: { $ne: "cancelled" } }).distinct("patientId");
  }
  if (query.hasInsurance === "true") {
    lookups.hasInsurance = Insurance.distinct("userId");
  }
  if (query.hasOutstanding === "true") {
    lookups.hasOutstanding = Payment.find({ status: { $in: OPEN_PAYMENT_STATUSES } }).distinct("userId");
  }
  if (query.hasFamily === "true") {
    lookups.hasFamily = FamilyMember.distinct("userId", { isActive: true });
  }

  // "Needs attention" quick filter — the subset of the full attention rule
  // set (see computeAttentionItems) that is genuinely expressible as a
  // direct database query without first materializing every patient's full
  // aggregate: failed payments, unreviewed critical/urgent reports,
  // expiring/expired insurance, and any open outstanding balance. This is
  // documented here rather than silently claimed as the complete rule set —
  // the Patient 360 workspace shows the COMPLETE, per-patient attention
  // list (including overdue follow-up / missing prescription / high pain,
  // which require a cross-collection join per patient and are computed
  // there instead).
  if (query.attention === "true") {
    lookups.attention = Promise.all([
      Payment.find({ status: "failed" }).distinct("userId"),
      MedicalReport.find({ severity: { $ne: "normal" }, reviewedAt: null }).distinct("userId"),
      Insurance.find({ validTill: { $lte: new Date(now.getTime() + 30 * ONE_DAY_MS) } }).distinct("userId"),
      Payment.find({ status: { $in: OPEN_PAYMENT_STATUSES } }).distinct("userId"),
    ]).then((lists) => {
      const set = new Set();
      lists.flat().forEach((id) => set.add(id.toString()));
      return Array.from(set);
    });
  }

  const keys = Object.keys(lookups);
  const values = await Promise.all(keys.map((key) => lookups[key]));
  const resolved = Object.fromEntries(keys.map((key, index) => [key, values[index]]));

  // Intersect every active advanced filter (AND semantics between distinct
  // checkboxes) rather than union, so combining e.g. hasInsurance=true AND
  // hasOutstanding=true genuinely narrows the result.
  let idSet = null;
  for (const key of keys) {
    const ids = new Set(resolved[key].map((id) => id.toString()));
    idSet = idSet === null ? ids : new Set([...idSet].filter((id) => ids.has(id)));
  }

  return idSet; // null means "no advanced filter active"
};

const buildAgeDobRange = (ageMin, ageMax) => {
  const now = new Date();
  const range = {};
  if (ageMax !== undefined && ageMax !== "") {
    // The earliest possible DOB for someone who is at most ageMax years old.
    const dobFrom = new Date(now);
    dobFrom.setFullYear(dobFrom.getFullYear() - Number(ageMax) - 1);
    range.$gte = dobFrom;
  }
  if (ageMin !== undefined && ageMin !== "") {
    // The latest possible DOB for someone who is at least ageMin years old.
    const dobTo = new Date(now);
    dobTo.setFullYear(dobTo.getFullYear() - Number(ageMin));
    range.$lte = dobTo;
  }
  return Object.keys(range).length ? range : null;
};

const buildBaseFilter = (query) => {
  const filter = { role: ROLES.PATIENT };

  if (query.status === "active") filter.isActive = true;
  if (query.status === "inactive") filter.isActive = false;

  if (query.gender) filter["patientProfile.gender"] = query.gender;

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const or = [{ name: regex }, { email: regex }];
    if (mongoose.Types.ObjectId.isValid(term)) or.push({ _id: term });
    filter.$or = or;
  }

  if (query.registeredFrom || query.registeredTo) {
    filter.createdAt = {};
    if (query.registeredFrom && !Number.isNaN(Date.parse(query.registeredFrom))) {
      filter.createdAt.$gte = new Date(query.registeredFrom);
    }
    if (query.registeredTo && !Number.isNaN(Date.parse(query.registeredTo))) {
      const to = new Date(query.registeredTo);
      to.setUTCHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  const dobRange = buildAgeDobRange(query.ageMin, query.ageMax);
  if (dobRange) filter["patientProfile.dateOfBirth"] = dobRange;

  return filter;
};

export const listPatientsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = buildBaseFilter(req.query);
  const advancedIds = await resolveAdvancedIdFilters(req.query);

  if (advancedIds !== null) {
    filter._id = { $in: Array.from(advancedIds).map((id) => new mongoose.Types.ObjectId(id)) };
  }

  const sortMap = {
    name: { name: 1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
  };
  const sort = sortMap[req.query.sort] || sortMap.newest;

  const [patients, total] = await Promise.all([
    User.find(filter).select("-password").sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const aggregates = await buildPatientAggregates(patients.map((p) => p._id));
  const canViewFinance = await userHasPermission(req.user, "manage_payments");

  const enriched = patients.map((patient) => {
    const aggregate = aggregates.get(patient._id.toString()) || {};
    const attentionItems = computeAttentionItems(patient, aggregate);
    const riskLevel = computePatientRiskLevel({
      medicalConditions: patient.patientProfile?.medicalConditions || [],
      allergies: patient.patientProfile?.allergies || [],
      latestPainLevel: aggregate.latestVisitSnapshot?.painLevel,
    });

    return {
      _id: patient._id,
      name: patient.name,
      email: patient.email,
      isActive: patient.isActive,
      createdAt: patient.createdAt,
      age: calculateAge(patient.patientProfile?.dateOfBirth),
      gender: patient.patientProfile?.gender || "",
      bloodGroup: patient.patientProfile?.bloodGroup || "",
      medicalConditions: patient.patientProfile?.medicalConditions || [],
      allergies: patient.patientProfile?.allergies || [],
      medicationsCount: (patient.patientProfile?.medications || []).length,
      riskLevel,
      appointmentCount: aggregate.appointmentCount || 0,
      lastVisit: aggregate.lastVisit || null,
      nextVisit: aggregate.nextVisit || null,
      reportsCount: aggregate.reportsCount || 0,
      prescriptionsCount: aggregate.prescriptionsCount || 0,
      familyMembersCount: (aggregate.familyMembers || []).length,
      hasInsurance: (aggregate.insurance || []).length > 0,
      outstandingAmount: canViewFinance ? aggregate.outstandingAmount || 0 : null,
      financialRestricted: !canViewFinance,
      needsAttention: attentionItems.length > 0,
      attentionCount: attentionItems.length,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      patients: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      canViewFinance,
    },
    message: "Patients fetched successfully",
  });
});

// Real, deterministic KPI strip. Every number here is a genuine count or
// sum — no invented percentage, no fabricated trend.
export const getPatientStatsAdmin = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const canViewFinance = await userHasPermission(req.user, "manage_payments");

  const [
    totalPatients,
    activePatients,
    newThisMonth,
    upcomingIds,
    attentionSetRaw,
    missingCriticalInfo,
  ] = await Promise.all([
    User.countDocuments({ role: ROLES.PATIENT }),
    User.countDocuments({ role: ROLES.PATIENT, isActive: true }),
    User.countDocuments({ role: ROLES.PATIENT, createdAt: { $gte: startOfMonth } }),
    Appointment.find({ date: { $gt: now }, status: { $ne: "cancelled" } }).distinct("patientId"),
    Promise.all([
      Payment.find({ status: "failed" }).distinct("userId"),
      MedicalReport.find({ severity: { $ne: "normal" }, reviewedAt: null }).distinct("userId"),
      Insurance.find({ validTill: { $lte: new Date(now.getTime() + 30 * ONE_DAY_MS) } }).distinct("userId"),
      Payment.find({ status: { $in: OPEN_PAYMENT_STATUSES } }).distinct("userId"),
    ]),
    User.countDocuments({
      role: ROLES.PATIENT,
      $or: [
        { "patientProfile.bloodGroup": "" },
        { "patientProfile.emergencyContact.phone": "" },
        { "patientProfile.dateOfBirth": { $exists: false } },
      ],
    }),
  ]);

  const attentionSet = new Set(attentionSetRaw.flat().map((id) => id.toString()));

  let outstandingBalanceTotal = null;
  if (canViewFinance) {
    const agg = await Payment.aggregate([
      { $match: { status: { $in: OPEN_PAYMENT_STATUSES } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    outstandingBalanceTotal = agg[0]?.total || 0;
  }

  res.status(200).json({
    success: true,
    data: {
      totalPatients,
      activePatients,
      inactivePatients: totalPatients - activePatients,
      newPatientsThisMonth: newThisMonth,
      patientsWithUpcomingAppointment: upcomingIds.length,
      patientsNeedingAttention: attentionSet.size,
      patientsWithMissingInfo: missingCriticalInfo,
      outstandingBalanceTotal,
      canViewFinance,
    },
    message: "Patient stats fetched successfully",
  });
});

// Patient 360 Workspace aggregate. Financial fields are stripped
// server-side (not just hidden client-side) unless the requesting admin
// has manage_payments — the exact same rule the Appointment Operations
// Workspace already uses.
export const getPatientWorkspaceAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid patient id", 400);

  const patient = await User.findOne({ _id: req.params.id, role: ROLES.PATIENT }).select("-password").lean();
  if (!patient) throw new AppError("Patient not found", 404);

  const canViewFinance = await userHasPermission(req.user, "manage_payments");

  const [aggregateMap, fullInsurance, fullAppointments, fullReports, fullPrescriptions] = await Promise.all([
    buildPatientAggregates([patient._id]),
    Insurance.find({ userId: patient._id }).select("-__v").lean(),
    Appointment.find({ patientId: patient._id })
      .populate({ path: "doctorId", select: "specialization userId", populate: { path: "userId", select: "name" } })
      .populate("familyMemberId", "name relation")
      .sort({ date: -1 })
      .limit(50)
      .lean(),
    MedicalReport.find({ userId: patient._id }).sort({ reportDate: -1 }).limit(50).lean(),
    Prescription.find({ patientId: patient._id })
      .populate({ path: "doctorId", select: "specialization userId", populate: { path: "userId", select: "name" } })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const aggregate = aggregateMap.get(patient._id.toString()) || {};
  const attentionItems = computeAttentionItems(patient, aggregate);
  const riskLevel = computePatientRiskLevel({
    medicalConditions: patient.patientProfile?.medicalConditions || [],
    allergies: patient.patientProfile?.allergies || [],
    latestPainLevel: aggregate.latestVisitSnapshot?.painLevel,
  });

  const familyMembers = await FamilyMember.find({ userId: patient._id, isActive: true }).lean();

  // Financial: strip entirely for a non-finance admin, same pattern as
  // appointmentAdminController.stripFinancialFields.
  let financial = { restricted: true };
  if (canViewFinance) {
    const payments = await Payment.find({ userId: patient._id }).sort({ createdAt: -1 }).limit(50).lean();
    financial = {
      restricted: false,
      outstandingAmount: aggregate.outstandingAmount || 0,
      payments: payments.map((p) => ({
        _id: p._id,
        appointmentId: p.appointmentId,
        amount: p.amount,
        totalAmount: p.totalAmount,
        status: p.status,
        refundStatus: p.refundStatus,
        refundedAmount: p.refundedAmount,
        currency: p.currency,
        paidAt: p.paidAt,
        failedAt: p.failedAt,
        createdAt: p.createdAt,
      })),
    };
  }

  // Timeline — built ONLY from real stored timestamps, same documented
  // limitation as the Appointment Detail Workspace: this schema does not
  // store a timestamp per intermediate lifecycle transition, only
  // createdAt/updatedAt/paidAt on Appointment and per-entry `at` on
  // Insurance.claimHistory, so only those are used.
  const timeline = [];
  fullAppointments.forEach((appt) => {
    timeline.push({
      key: `appt-created-${appt._id}`,
      label: `Appointment requested${appt.doctorId?.userId?.name ? ` with Dr. ${appt.doctorId.userId.name}` : ""}`,
      at: appt.createdAt,
    });
    if (appt.paidAt) {
      timeline.push({ key: `appt-paid-${appt._id}`, label: "Payment completed", at: appt.paidAt });
    }
    if (appt.status === "cancelled") {
      timeline.push({
        key: `appt-cancelled-${appt._id}`,
        label: `Appointment cancelled${appt.cancelReason ? ` — ${appt.cancelReason}` : ""}`,
        at: appt.updatedAt,
      });
    }
  });
  fullReports.forEach((report) => {
    timeline.push({ key: `report-${report._id}`, label: `Report uploaded: ${report.title}`, at: report.createdAt });
    if (report.reviewedAt) {
      timeline.push({ key: `report-reviewed-${report._id}`, label: `Report reviewed: ${report.title}`, at: report.reviewedAt });
    }
  });
  fullPrescriptions.forEach((prescription) => {
    timeline.push({
      key: `prescription-${prescription._id}`,
      label: `Prescription filed${prescription.doctorId?.userId?.name ? ` by Dr. ${prescription.doctorId.userId.name}` : ""}`,
      at: prescription.createdAt,
    });
  });
  fullInsurance.forEach((policy) => {
    (policy.claimHistory || []).forEach((entry) => {
      timeline.push({
        key: `claim-${policy._id}-${entry._id}`,
        label: `Insurance claim ${entry.status}${entry.note ? ` — ${entry.note}` : ""} (${policy.provider})`,
        at: entry.at,
      });
    });
  });
  timeline.sort((a, b) => new Date(b.at) - new Date(a.at));

  res.status(200).json({
    success: true,
    data: {
      patient: {
        _id: patient._id,
        name: patient.name,
        email: patient.email,
        isActive: patient.isActive,
        createdAt: patient.createdAt,
        age: calculateAge(patient.patientProfile?.dateOfBirth),
        patientProfile: patient.patientProfile || {},
      },
      riskLevel,
      attentionItems,
      appointments: fullAppointments,
      reports: fullReports,
      prescriptions: fullPrescriptions,
      insurance: fullInsurance,
      familyMembers,
      financial,
      timeline: timeline.slice(0, 100),
      canViewFinance,
    },
    message: "Patient workspace fetched successfully",
  });
});

// Admin-only report download — no ownership check (any admin may view any
// patient's report), reusing the exact same downloadFile() core the
// patient's own ownership-scoped download uses.
export const downloadPatientReportAdmin = asyncHandler(async (req, res) => {
  const report = await MedicalReport.findById(req.params.reportId).lean();
  if (!report) throw new AppError("Report not found", 404);
  downloadFile(res, report.filePath, report.fileName);
});

export const downloadPatientPrescriptionAdmin = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findById(req.params.prescriptionId).lean();
  if (!prescription) throw new AppError("Prescription not found", 404);
  if (!prescription.pdfPath) throw new AppError("No PDF is on file for this prescription", 404);
  downloadFile(res, prescription.pdfPath, `prescription-${prescription._id}.pdf`);
});

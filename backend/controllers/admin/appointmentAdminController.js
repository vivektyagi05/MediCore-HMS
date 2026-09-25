// PHASE UI-3 — Appointment Operations Workspace (admin side).
//
// Additive admin read/action surface over the existing Appointment domain.
// Deliberately does NOT duplicate anything that already exists:
//  - approve / reject / any lifecycle status transition stays on the
//    existing PUT /api/appointments/:id/status (appointmentController.js,
//    already ADMIN/SUPER_ADMIN-authorized) — reused as-is, one transition
//    validator (STATUS_TRANSITIONS) for the whole app.
//  - refund review/approve/reject/initiate stays on the existing
//    /api/refunds routes (refundController.js) — this controller only
//    shows refund STATE, it never mutates a refund.
//  - payment detail stays on the existing /api/payments routes — this
//    controller reads the Payment doc already linked via Appointment.paymentId.
//  - cancellation reuses the shared appointmentCancellationService.js core
//    (see that file's header) so the admin cancel path can never drift
//    from the patient cancel path's rules.
import { containsRegex } from "../../utils/regexSafe.js";
import mongoose from "mongoose";
import Appointment from "../../models/Appointment.js";
import Payment from "../../models/Payment.js";
import RefundRequest from "../../models/RefundRequest.js";
import Prescription from "../../models/Prescription.js";
import MedicalNote from "../../models/MedicalNote.js";
import User from "../../models/User.js";
import Doctor from "../../models/Doctor.js";
import {
  APPOINTMENT_STATUS,
  CANCELLABLE_STATUSES,
} from "../../constants/appointmentStatus.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { userHasPermission } from "../../middleware/adminMiddleware.js";
import { cancelAppointmentCore } from "../../services/appointmentCancellationService.js";
import { buildAttentionMatch, computeNeedsAttention } from "../../utils/appointmentAttention.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const startOfToday = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const endOfToday = () => {
  const d = startOfToday();
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

// Real, documented "needs attention" rule — computed from fields that
// actually exist (status/paymentStatus/date/createdAt), never a fabricated
// score or stored field. Three concrete, explainable conditions:
//   1. Still PENDING more than 24h after being requested (doctor hasn't
//      responded — the patient is waiting).
//   2. Payment has genuinely FAILED.
//   3. APPROVED but payment still PENDING with the appointment date within
//      the next 24h (paid slot may fall through before the visit).
export const ATTENTION_MATCH = buildAttentionMatch();

// Resolves a free-text search term against real patient/doctor names before
// filtering appointments, so the query stays server-side and index-backed
// rather than downloading the full appointment collection to filter in
// memory (the mission explicitly rules out the latter).
const resolveSearchFilter = async (term) => {
  const regex = containsRegex(term);
  const [matchingPatients, matchingDoctorUsers] = await Promise.all([
    User.find({ role: "patient", name: regex }).select("_id").lean(),
    User.find({ role: "doctor", name: regex }).select("_id").lean(),
  ]);
  const doctorUserIds = matchingDoctorUsers.map((u) => u._id);
  const matchingDoctors = doctorUserIds.length
    ? await Doctor.find({ userId: { $in: doctorUserIds } }).select("_id").lean()
    : [];

  return {
    $or: [
      { patientId: { $in: matchingPatients.map((p) => p._id) } },
      { doctorId: { $in: matchingDoctors.map((d) => d._id) } },
    ],
  };
};

const buildListFilter = async (query) => {
  const filter = {};

  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.consultationMode) filter.consultationMode = query.consultationMode;
  if (query.doctorId && mongoose.Types.ObjectId.isValid(query.doctorId)) {
    filter.doctorId = query.doctorId;
  }
  if (query.patientId && mongoose.Types.ObjectId.isValid(query.patientId)) {
    filter.patientId = query.patientId;
  }

  if (query.dateFrom || query.dateTo) {
    filter.date = {};
    if (query.dateFrom && !Number.isNaN(Date.parse(query.dateFrom))) {
      const from = new Date(query.dateFrom);
      from.setUTCHours(0, 0, 0, 0);
      filter.date.$gte = from;
    }
    if (query.dateTo && !Number.isNaN(Date.parse(query.dateTo))) {
      const to = new Date(query.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      filter.date.$lte = to;
    }
  } else if (query.quickDate === "today") {
    filter.date = { $gte: startOfToday(), $lte: endOfToday() };
  } else if (query.quickDate === "upcoming") {
    filter.date = { $gte: startOfToday() };
  } else if (query.quickDate === "past") {
    filter.date = { $lt: startOfToday() };
  }

  const conditions = [filter];

  if (query.attention === "true") {
    conditions.push(ATTENTION_MATCH);
  }

  if (query.search && query.search.trim()) {
    conditions.push(await resolveSearchFilter(query.search.trim()));
  }

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

// Strips fields a non-finance admin must never see. Applied to both the
// list (payment/refund summary columns) and the detail workspace.
export const stripFinancialFields = (appointment, canViewFinance) => {
  if (canViewFinance) return appointment;
  const rest = { ...appointment };
  delete rest.paymentId;
  delete rest.invoiceId;
  return {
    ...rest,
    financialRestricted: true,
  };
};

export const listAppointmentsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = await buildListFilter(req.query);
  const canViewFinance = await userHasPermission(req.user, "manage_payments");

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .populate("patientId", "name email role")
      .populate({
        path: "doctorId",
        select: "specialization fees rating userId consultationMode",
        populate: { path: "userId", select: "name email" },
      })
      .populate("paymentId", "status refundStatus refundedAmount amount totalAmount")
      .populate("invoiceId", "invoiceNumber")
      .sort({ date: -1, timeSlot: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(filter),
  ]);

  // Real clinical-state + attention flag per row, computed here (not
  // fabricated) so the queue can show them without N extra round-trips per
  // row. hasPrescription/hasNote are cheap existence checks batched below.
  const appointmentIds = appointments.map((a) => a._id);
  const [prescriptionIds, noteIds] = await Promise.all([
    Prescription.find({ appointmentId: { $in: appointmentIds } }).select("appointmentId followUpDate").lean(),
    MedicalNote.find({ appointmentId: { $in: appointmentIds } }).select("appointmentId").lean(),
  ]);
  const prescriptionByAppt = new Map(prescriptionIds.map((p) => [String(p.appointmentId), p]));
  const noteApptSet = new Set(noteIds.map((n) => String(n.appointmentId)));

  const now = Date.now();
  const enriched = appointments.map((appointment) => {
    const prescription = prescriptionByAppt.get(String(appointment._id));
    const needsAttention = computeNeedsAttention(appointment, now);

    return stripFinancialFields(
      {
        ...appointment,
        hasPrescription: Boolean(prescription),
        hasClinicalNote: noteApptSet.has(String(appointment._id)),
        followUpDate: prescription?.followUpDate || null,
        needsAttention,
      },
      canViewFinance,
    );
  });

  res.status(200).json({
    success: true,
    data: {
      appointments: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      canViewFinance,
    },
    message: "Appointments fetched successfully",
  });
});

// Real, server-computed dashboard counts. Every number here is a genuine
// aggregate over the Appointment/RefundRequest collections — nothing is
// estimated or hardcoded. "Revenue" is deliberately gated behind
// manage_payments and derived from Payment.totalAmount, never a per-visit
// flat-rate guess (the old page's "₹1500 x paid count" fake metric this
// replaces).
export const getAppointmentSummaryAdmin = asyncHandler(async (req, res) => {
  const canViewFinance = await userHasPermission(req.user, "manage_payments");

  const [
    total,
    today,
    upcoming,
    pending,
    approved,
    paymentPending,
    paymentCompleted,
    consultationStarted,
    consultationCompleted,
    completed,
    cancelled,
    reviewEligible,
    paymentFailed,
    needsAttention,
  ] = await Promise.all([
    Appointment.countDocuments({}),
    Appointment.countDocuments({ date: { $gte: startOfToday(), $lte: endOfToday() } }),
    Appointment.countDocuments({ date: { $gt: endOfToday() } }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.PENDING }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.APPROVED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.PAYMENT_PENDING }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.PAYMENT_COMPLETED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.CONSULTATION_STARTED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.CONSULTATION_COMPLETED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.COMPLETED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.CANCELLED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.REVIEW_ELIGIBLE }),
    Appointment.countDocuments({ paymentStatus: "failed" }),
    Appointment.countDocuments(ATTENTION_MATCH),
  ]);

  // Refund-pending count: RefundRequest has no direct appointment link, only
  // paymentId -> Payment -> appointmentId, so this is a real join, not a guess.
  const refundPendingAgg = await RefundRequest.aggregate([
    { $match: { status: "pending" } },
    { $lookup: { from: "payments", localField: "paymentId", foreignField: "_id", as: "payment" } },
    { $unwind: "$payment" },
    { $count: "count" },
  ]);
  const refundPending = refundPendingAgg[0]?.count || 0;

  let revenue = null;
  if (canViewFinance) {
    const revenueAgg = await Payment.aggregate([
      { $match: { status: "captured" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    revenue = revenueAgg[0]?.total || 0;
  }

  res.status(200).json({
    success: true,
    data: {
      total,
      today,
      upcoming,
      pending,
      approved,
      inProgress: paymentPending + paymentCompleted + consultationStarted,
      paymentPending,
      paymentCompleted,
      consultationStarted,
      consultationCompleted,
      completed,
      cancelled,
      reviewEligible,
      paymentFailed,
      refundPending,
      needsAttention,
      revenue,
      canViewFinance,
    },
    message: "Appointment summary fetched successfully",
  });
});

// Appointment Detail Workspace aggregate — composes the appointment with
// its real patient/doctor/payment/refund/clinical records. Financial
// fields are stripped server-side (not just hidden client-side) unless the
// requesting admin has manage_payments.
export const getAppointmentDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid appointment id", 400);

  const appointment = await Appointment.findById(req.params.id)
    .populate("patientId", "name email role patientProfile createdAt")
    .populate({
      path: "doctorId",
      select: "specialization fees rating userId consultationMode hospitalName city state verificationStatus isVerified",
      populate: { path: "userId", select: "name email" },
    })
    .populate("familyMemberId", "name relation age gender bloodGroup medicalConditions")
    .populate("insuranceId", "provider policyNumber policyHolder validTill coverageAmount claimStatus")
    .populate("reportIds", "title category reportDate fileName createdAt")
    .lean();

  if (!appointment) throw new AppError("Appointment not found", 404);

  const canViewFinance = await userHasPermission(req.user, "manage_payments");

  const [payment, prescription, medicalNote] = await Promise.all([
    Payment.findOne({ appointmentId: appointment._id }).lean(),
    Prescription.findOne({ appointmentId: appointment._id }).lean(),
    MedicalNote.findOne({ appointmentId: appointment._id }).lean(),
  ]);

  let refundRequest = null;
  if (payment) {
    refundRequest = await RefundRequest.findOne({ paymentId: payment._id }).lean();
  }

  // Timeline — built ONLY from real stored timestamps. This schema does not
  // track a separate timestamp per lifecycle transition (only createdAt /
  // updatedAt / paidAt on the Appointment itself), so intermediate
  // transitions (e.g. exact moment of approval) are genuinely not
  // reconstructable and are deliberately NOT fabricated here.
  const timeline = [
    { key: "created", label: "Appointment requested", at: appointment.createdAt },
  ];
  if (appointment.paidAt) {
    timeline.push({ key: "paid", label: "Payment completed", at: appointment.paidAt });
  }
  if (medicalNote) {
    timeline.push({ key: "note", label: "Clinical note filed", at: medicalNote.createdAt });
  }
  if (prescription) {
    timeline.push({ key: "prescription", label: "Prescription filed", at: prescription.createdAt });
  }
  for (const report of appointment.reportIds || []) {
    timeline.push({ key: `report-${report._id}`, label: `Report attached: ${report.title}`, at: report.createdAt });
  }
  if (refundRequest) {
    for (const entry of refundRequest.timeline || []) {
      timeline.push({ key: `refund-${entry._id}`, label: `Refund ${entry.status}${entry.note ? ` — ${entry.note}` : ""}`, at: entry.at });
    }
  }
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    timeline.push({
      key: "cancelled",
      label: `Cancelled${appointment.cancelReason ? ` — ${appointment.cancelReason}` : ""}`,
      at: appointment.updatedAt,
    });
  } else {
    timeline.push({ key: "current-status", label: `Current status: ${appointment.status}`, at: appointment.updatedAt });
  }
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  const financial = canViewFinance
    ? {
        payment: payment
          ? {
              _id: payment._id,
              amount: payment.amount,
              discountAmount: payment.discountAmount,
              taxAmount: payment.taxAmount,
              totalAmount: payment.totalAmount,
              currency: payment.currency,
              status: payment.status,
              refundStatus: payment.refundStatus,
              refundedAmount: payment.refundedAmount,
              paidAt: payment.paidAt,
              failedAt: payment.failedAt,
            }
          : null,
        refundRequest: refundRequest
          ? {
              _id: refundRequest._id,
              amount: refundRequest.amount,
              status: refundRequest.status,
              reason: refundRequest.reason,
            }
          : null,
        invoiceNumber: appointment.invoiceId?.invoiceNumber || null,
      }
    : { restricted: true };

  res.status(200).json({
    success: true,
    data: {
      appointment: {
        _id: appointment._id,
        patientId: appointment.patientId,
        familyMemberId: appointment.familyMemberId,
        doctorId: appointment.doctorId,
        date: appointment.date,
        timeSlot: appointment.timeSlot,
        status: appointment.status,
        paymentStatus: appointment.paymentStatus,
        consultationMode: appointment.consultationMode,
        reason: appointment.reason,
        symptoms: appointment.symptoms,
        symptomDuration: appointment.symptomDuration,
        painLevel: appointment.painLevel,
        notes: appointment.notes,
        cancelReason: appointment.cancelReason,
        existingConditions: appointment.existingConditions,
        currentMedications: appointment.currentMedications,
        allergies: appointment.allergies,
        emergencyContact: appointment.emergencyContact,
        insuranceId: appointment.insuranceId,
        reportIds: appointment.reportIds,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
      },
      financial,
      clinical: {
        prescription: prescription
          ? { diagnosis: prescription.diagnosis, medicines: prescription.medicines, followUpDate: prescription.followUpDate, status: prescription.status }
          : null,
        medicalNote: medicalNote
          ? { notes: medicalNote.notes, recommendations: medicalNote.recommendations, symptoms: medicalNote.symptoms }
          : null,
      },
      cancellable: CANCELLABLE_STATUSES.includes(appointment.status),
      timeline,
    },
    message: "Appointment detail fetched successfully",
  });
});

// Admin-side cancellation. Unlike the patient route, there's no ownership
// check (any admin may cancel any appointment) but the state-machine rules,
// auto-refund-request creation, and notifications are the exact same shared
// core the patient path uses — see appointmentCancellationService.js.
export const cancelAppointmentAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid appointment id", 400);
  if (!req.body.reason || !req.body.reason.trim()) {
    throw new AppError("A cancellation reason is required", 400);
  }

  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw new AppError("Appointment not found", 404);

  const { appointment: cancelledAppointment, refundRequestCreated } = await cancelAppointmentCore({
    appointment,
    reason: req.body.reason.trim(),
    cancelledBy: "admin",
    actorId: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: { appointment: cancelledAppointment, refundRequestCreated },
    message: refundRequestCreated
      ? "Appointment cancelled and a refund request was created automatically."
      : "Appointment cancelled successfully",
  });
});

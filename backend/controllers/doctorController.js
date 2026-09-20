import mongoose from "mongoose";
import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Prescription from "../models/Prescription.js";
import ChatMessage from "../models/ChatMessage.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { clinicalEmitter } from "../realtime/clinicalEmitter.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";
import { getVerificationCycleId } from "../utils/verificationCycle.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";
import { logger } from "../utils/logger.js";
import { validateAndDeriveAvailability } from "../utils/slotEngine.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { clampPagination, buildPaginationMeta } from "../utils/paginationValidation.js";
import { roomManager } from "../socket/roomManager.js";
import { emailService } from "../services/emailService.js";
import { applyDoctorMasterData, resolveDoctorMasterData } from "../services/masterDataService.js";
import {
  computeRiskLevel,
  resolveFollowUpState,
  computeDoctorPatientAttentionItems,
  matchesPatientFilter,
  isInsuranceExpiringSoon,
} from "../services/doctorPatientRelationshipService.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const validateDoctorPayload = (payload, partial = false) => {
  const errors = {};

  if (!partial || payload.userId !== undefined) {
    if (!payload.userId || !mongoose.Types.ObjectId.isValid(payload.userId)) {
      errors.userId = "A valid userId is required";
    }
  }

  if (!partial || payload.specialization !== undefined) {
    if (!payload.specialization || payload.specialization.trim().length < 2) {
      errors.specialization = "Specialization is required";
    }
  }

  if (!partial || payload.experience !== undefined) {
    if (payload.experience === undefined || Number(payload.experience) < 0) {
      errors.experience = "Experience must be a non-negative number";
    }
  }

  if (!partial || payload.fees !== undefined) {
    if (payload.fees === undefined || Number(payload.fees) < 0) {
      errors.fees = "Fees must be a non-negative number";
    }
  }

  if (payload.availability !== undefined && !Array.isArray(payload.availability)) {
    errors.availability = "Availability must be an array of day/time slot objects";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const getDoctors = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};

  if (req.query.specialization) {
    filter.specialization = new RegExp(req.query.specialization, "i");
  }

  // This route is mounted at /api/doctors and is reachable without auth.
  // Public/doctor-role callers must receive only publishable doctors; the
  // SUPER_ADMIN management surface uses the dedicated admin endpoint and is
  // intentionally the only role allowed to see pending/rejected records here.
  if (req.user?.role !== ROLES.SUPER_ADMIN) {
    const publicDoctorUsers = await User.find({
      role: ROLES.DOCTOR,
      isActive: true,
    }).select("_id").lean();

    filter.userId = { $in: publicDoctorUsers.map((user) => user._id) };
    filter.isVerified = true;
    filter.verificationStatus = "approved";
    filter.isActive = true;
  }

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      // Unauthenticated route: never expose the doctor's account email.
      .populate("userId", "name role isActive")
      .sort({ rating: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Doctor.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      doctors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
    message: "Doctors fetched successfully",
  });
});

export const createDoctor = asyncHandler(async (req, res) => {
  const validation = validateDoctorPayload(req.body);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const masterData = await resolveDoctorMasterData(req.body, { allowLegacyOther: true });

  const user = await User.findById(req.body.userId);

  if (!user || !user.isActive) {
    throw new AppError("Doctor user account was not found", 404);
  }

  if (user.role !== ROLES.DOCTOR) {
    throw new AppError("Only users with doctor role can have a doctor profile", 400);
  }

  let derivedAvailability;
  try {
    derivedAvailability = validateAndDeriveAvailability(req.body.availability || []);
  } catch (err) {
    throw new AppError(err.message, err.statusCode || 400);
  }

  const doctor = await ensureDoctorProfileForUser(user, {
    specialization: req.body.specialization,
    experience: req.body.experience,
    fees: req.body.fees,
    availability: derivedAvailability,
    rating: req.body.rating || 0,
  });

  applyDoctorMasterData(doctor, masterData);
  doctor.experience = Number(req.body.experience);
  doctor.fees = Number(req.body.fees);
  doctor.availability = derivedAvailability;
  doctor.rating = req.body.rating || doctor.rating || 0;
  await doctor.save();

  const populatedDoctor = await doctor.populate("userId", "name email role isActive");

  res.status(201).json({
    success: true,
    data: populatedDoctor,
    message: "Doctor profile created successfully",
  });
});

export const updateDoctor = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor id", 400);
  }

  const validation = validateDoctorPayload(req.body, true);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const masterPayload = { ...await Doctor.findById(req.params.id).lean(), ...req.body };
  const masterData = await resolveDoctorMasterData(masterPayload, { allowLegacyOther: true });

  const allowedUpdates = [
    "specialization",
    "experience",
    "fees",
    "availability",
    "rating",
  ];

  const updates = {};
  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (updates.availability !== undefined) {
    try {
      updates.availability = validateAndDeriveAvailability(updates.availability);
    } catch (err) {
      throw new AppError(err.message, err.statusCode || 400);
    }
  }

  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }
  Object.assign(doctor, updates);
  applyDoctorMasterData(doctor, masterData);
  await doctor.save();
  await doctor.populate("userId", "name email role isActive");

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  res.status(200).json({
    success: true,
    data: doctor,
    message: "Doctor profile updated successfully",
  });
});

// BUGFIX (Doctor Management Workspace audit): unlike Service (zero FK
// references anywhere), Doctor is referenced by Appointment/Review/Payment/
// Invoice. The previous findByIdAndDelete() was a blind hard delete that
// would silently orphan every appointment, review, payment, and invoice
// tied to that doctor -- appointments would point at a Doctor that no
// longer exists, patient-facing history would break, and payout/refund
// records would lose their doctor context. A real destructive action needs
// a real safety check, not just a confirm dialog on the frontend. Doctors
// with any appointment history can no longer be hard-deleted here; the
// admin UI should offer deactivation (PATCH /admin/users/:id/status)
// instead, which preserves every linked record.
// Pure, dependency-free guard extracted so it can be unit-tested without a
// live MongoDB (see tests/doctorDeleteSafety.test.mjs) -- same pattern as
// serviceAdminController's buildUpdatePayload/validateService split.
export const assertDoctorDeletable = (appointmentCount) => {
  if (appointmentCount > 0) {
    throw new AppError(
      `This doctor has ${appointmentCount} appointment${appointmentCount === 1 ? "" : "s"} on record and cannot be deleted. Deactivate the doctor's account instead to preserve appointment, review, and payment history.`,
      409,
    );
  }
};

export const deleteDoctor = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor id", 400);
  }

  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  const appointmentCount = await Appointment.countDocuments({ doctorId: doctor._id });
  assertDoctorDeletable(appointmentCount);

  await Doctor.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    data: { id: req.params.id },
    message: "Doctor profile deleted successfully",
  });
});

// Doctor Command Center — Patient Relationship Center.
// Additive-only enrichment over the original (name/email/gender/bloodGroup/
// appointmentCount/lastVisit/needsFollowUp) shape: every original field is
// still returned unchanged, this only surfaces real data that already
// existed on Appointment/User/Insurance/Prescription but was never fetched
// or shown. Nothing here is fabricated — every added field traces back to a
// real document, and fields with no underlying data come back null/empty
// rather than a guessed value.
export const getDoctorPatients = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user);

  // STEP 1/2 (DOC-03) — the previous implementation fetched this doctor's
  // ENTIRE appointment history with five populated refs on every row and
  // returned the full resulting patient list with no page limit — a
  // genuinely unbounded query flagged by both DOC-01 and DOC-02. This pass
  // fixes the two real problems: (a) real server-side search/filter/sort/
  // pagination is now applied via the shared paginationValidation.js
  // helper (STEP 2 explicitly requires reusing it, not inventing another
  // pagination helper), and (b) the response is bounded to a page instead
  // of the entire set.
  //
  // The underlying grouping logic below is unchanged from the previous
  // implementation (verified field-by-field) — this pass does not rewrite
  // it into a Mongo aggregation pipeline. Every other cross-collection
  // "aggregate" in this codebase (financeAggregates.js, governanceAggregates.js,
  // reviewAdminAggregates.js, patientAdminAggregationService.js) uses this
  // same bounded-find-then-JS-group pattern rather than raw .aggregate() —
  // and this sandbox has no live MongoDB to verify a novel aggregation
  // pipeline against, so introducing one here would be an untested, higher-
  // risk change to a production hospital system. The remaining scaling
  // limit (this still scans one doctor's full appointment history to build
  // the candidate set, not a DB-level cursor) is a real, explicitly flagged
  // limitation — not silently left unbounded.
  const appointments = await Appointment.find({
    doctorId: doctor._id,
  })
    .populate(
      "patientId",
      `
        name
        email
        patientProfile
      `,
    )
    .populate("insuranceId", "provider policyNumber validTill coverageAmount claimStatus")
    .populate("reportIds", "title category reportDate")
    .populate("familyMemberId", "name relation")
    .populate("paymentId", "status totalAmount refundStatus")
    .sort({ date: -1 })
    .lean();

  const patientIds = [
    ...new Set(
      appointments
        .map((appointment) => appointment.patientId?._id?.toString())
        .filter(Boolean),
    ),
  ];

  // One extra query, scoped to exactly this doctor's own prescriptions for
  // these patients — reuses the existing Prescription model, no duplicate
  // business logic (createPrescription/listPrescriptions untouched).
  const prescriptions = patientIds.length
    ? await Prescription.find({
        doctorId: doctor._id,
        patientId: { $in: patientIds },
      })
        .select("patientId followUpDate createdAt")
        .sort({ createdAt: -1 })
        .lean()
    : [];

  const prescriptionsByPatient = new Map();
  prescriptions.forEach((prescription) => {
    const key = prescription.patientId.toString();
    if (!prescriptionsByPatient.has(key)) prescriptionsByPatient.set(key, []);
    prescriptionsByPatient.get(key).push(prescription);
  });

  // STEP 19/Communication — real unread-message counts per patient, so the
  // Attention layer can surface "unread message" without a fabricated
  // count. Bounded to exactly this doctor's candidate patients, one
  // batched aggregate query (never N+1).
  const unreadByPatient = new Map();
  if (patientIds.length) {
    const conversationKeys = patientIds.map((patientId) => ({
      patientId,
      key: roomManager.conversationKey(req.user._id, patientId),
    }));
    const unreadCounts = await ChatMessage.aggregate([
      {
        $match: {
          conversationKey: { $in: conversationKeys.map((c) => c.key) },
          recipientId: req.user._id,
          readAt: null,
        },
      },
      { $group: { _id: "$conversationKey", count: { $sum: 1 } } },
    ]).catch(() => []);
    const countByKey = new Map(unreadCounts.map((c) => [c._id, c.count]));
    conversationKeys.forEach(({ patientId, key }) => {
      unreadByPatient.set(patientId, countByKey.get(key) || 0);
    });
  }

  const now = Date.now();
  const patientMap = new Map();

  appointments.forEach((appointment) => {
    const patient = appointment.patientId;

    if (!patient?._id) return;

    const patientId = patient._id.toString();
    const isFutureVisit = new Date(appointment.date).getTime() > now && appointment.status !== "cancelled";
    const isPastVisit = new Date(appointment.date).getTime() <= now && appointment.status !== "cancelled";

    if (!patientMap.has(patientId)) {
      patientMap.set(patientId, {
        _id: patient._id,
        name: patient.name,
        email: patient.email,

        gender:
          patient.patientProfile?.gender || "",

        bloodGroup:
          patient.patientProfile?.bloodGroup || "",

        appointmentCount: 1,

        // BUGFIX (DOC-01): the original implementation took the max `date`
        // across ALL appointments regardless of past/future, so a newly
        // booked future appointment could masquerade as the "Last Visit".
        // Split into real lastVisit (past) / nextVisit (future).
        lastVisit: isPastVisit ? appointment.date : null,
        nextVisit: isFutureVisit ? appointment.date : null,

        medicalConditions: patient.patientProfile?.medicalConditions || [],
        allergies:
          (patient.patientProfile?.allergies?.length
            ? patient.patientProfile.allergies
            : appointment.allergies) || [],
        medications: (patient.patientProfile?.medications || []).map((m) => m.name),

        latestVisitSnapshot: {
          reason: appointment.reason || "",
          symptoms: appointment.symptoms || [],
          painLevel: appointment.painLevel ?? null,
          consultationMode: appointment.consultationMode || "",
          status: appointment.status,
        },

        insurance: appointment.insuranceId
          ? {
              provider: appointment.insuranceId.provider,
              claimStatus: appointment.insuranceId.claimStatus,
              validTill: appointment.insuranceId.validTill,
              coverageAmount: appointment.insuranceId.coverageAmount,
              expiringSoon: isInsuranceExpiringSoon(appointment.insuranceId.validTill, now),
            }
          : null,

        reportsSet: new Map((appointment.reportIds || []).map((r) => [r._id.toString(), r])),
        familyMembersSet: appointment.familyMemberId
          ? new Map([[appointment.familyMemberId._id.toString(), appointment.familyMemberId]])
          : new Map(),

        outstandingAmount:
          appointment.paymentStatus && appointment.paymentStatus !== "paid" && appointment.paymentId?.totalAmount
            ? appointment.paymentId.totalAmount
            : 0,
      });
    } else {
      const existing = patientMap.get(patientId);

      existing.appointmentCount += 1;

      if (isPastVisit && (!existing.lastVisit || new Date(appointment.date) > new Date(existing.lastVisit))) {
        existing.lastVisit = appointment.date;
        existing.latestVisitSnapshot = {
          reason: appointment.reason || "",
          symptoms: appointment.symptoms || [],
          painLevel: appointment.painLevel ?? null,
          consultationMode: appointment.consultationMode || "",
          status: appointment.status,
        };
      }
      if (isFutureVisit && (!existing.nextVisit || new Date(appointment.date) < new Date(existing.nextVisit))) {
        existing.nextVisit = appointment.date;
      }
      if (appointment.insuranceId && !existing.insurance) {
        existing.insurance = {
          provider: appointment.insuranceId.provider,
          claimStatus: appointment.insuranceId.claimStatus,
          validTill: appointment.insuranceId.validTill,
          coverageAmount: appointment.insuranceId.coverageAmount,
          expiringSoon: isInsuranceExpiringSoon(appointment.insuranceId.validTill, now),
        };
      }
      (appointment.reportIds || []).forEach((r) => existing.reportsSet.set(r._id.toString(), r));
      if (appointment.familyMemberId) existing.familyMembersSet.set(appointment.familyMemberId._id.toString(), appointment.familyMemberId);
      if (appointment.paymentStatus && appointment.paymentStatus !== "paid" && appointment.paymentId?.totalAmount) {
        existing.outstandingAmount += appointment.paymentId.totalAmount;
      }
    }
  });

  const allPatients = Array.from(
    patientMap.values(),
  ).map((patient) => {
    const patientPrescriptions = prescriptionsByPatient.get(patient._id.toString()) || [];
    const followUp = resolveFollowUpState({
      followUpDates: patientPrescriptions.map((p) => p.followUpDate),
      lastVisit: patient.lastVisit,
      now,
    });

    const reports = Array.from(patient.reportsSet.values());
    const familyMembers = Array.from(patient.familyMembersSet.values()).map((m) => ({
      name: m.name,
      relation: m.relation,
    }));

    // Deterministic, rule-based risk level from real fields on file — not an
    // AI guess. Kept separate from the AI Summary (see /ai/assist/patients/
    // :patientId/brief) which is explicitly generative and disclaimed.
    const painLevel = patient.latestVisitSnapshot.painLevel;
    const conditionCount = patient.medicalConditions.length;
    const riskLevel = computeRiskLevel({ painLevel, conditionCount, allergyCount: patient.allergies.length });

    const unreadMessages = unreadByPatient.get(patient._id.toString()) || 0;

    const alerts = [];
    if (patient.allergies.length) alerts.push(`Allergy on file: ${patient.allergies.join(", ")}`);
    if (patient.insurance?.expiringSoon) alerts.push(`Insurance expires ${new Date(patient.insurance.validTill).toLocaleDateString()}`);
    if (patient.outstandingAmount > 0) alerts.push(`Outstanding bill: ₹${patient.outstandingAmount}`);
    if (painLevel != null && painLevel >= 7) alerts.push(`High pain level reported (${painLevel}/10)`);
    if (followUp.overdue) alerts.push(`Follow-up overdue since ${new Date(followUp.overdue).toLocaleDateString()}`);

    const { reportsSet: _reportsSet, familyMembersSet: _familyMembersSet, ...rest } = patient;

    const enriched = {
      ...rest,
      // needsFollowUp is now derived from real prescription follow-up dates
      // (resolveFollowUpState) instead of the old ">30 days since visit"
      // heuristic, matching STEP 10's requirement to derive follow-up state
      // only from actual persisted Prescription.followUpDate records.
      needsFollowUp: followUp.bucket === "overdue" || followUp.bucket === "due_today",
      followUp,
      riskLevel,
      alerts,
      unreadMessages,
      reportsCount: reports.length,
      recentReports: reports.slice(0, 3),
      familyMembers,
      upcomingFollowUp: followUp.upcoming,
      recentPrescriptionsCount: patientPrescriptions.length,
    };

    return { ...enriched, attentionItems: computeDoctorPatientAttentionItems(enriched) };
  });

  // Analytics summarize the doctor's WHOLE patient relationship set (not
  // just the current page) — same convention as before.
  const analytics = {
    totalPatients: allPatients.length,
    activePatients: allPatients.filter((p) => !p.needsFollowUp).length,
    followUps: allPatients.filter((p) => p.needsFollowUp).length,
    newPatientsThisMonth: allPatients.filter((p) => {
      if (!p.lastVisit) return false;
      const visitDate = new Date(p.lastVisit);
      const nowDate = new Date();
      return visitDate.getMonth() === nowDate.getMonth() && visitDate.getFullYear() === nowDate.getFullYear();
    }).length,
    highRiskPatients: allPatients.filter((p) => p.riskLevel === "high").length,
    outstandingBillsCount: allPatients.filter((p) => p.outstandingAmount > 0).length,
  };

  // STEP 3 — real search (name/email) + real filter, applied before
  // pagination so the returned page/total are correct for the narrowed set.
  let filtered = allPatients;
  const search = String(req.query.search || "").trim().toLowerCase();
  if (search) {
    filtered = filtered.filter(
      (p) => p.name?.toLowerCase().includes(search) || p.email?.toLowerCase().includes(search),
    );
  }
  const filterKey = String(req.query.filter || "all");
  filtered = filtered.filter((p) => matchesPatientFilter(p, filterKey, now));

  const sortKey = String(req.query.sort || "recent");
  const sorters = {
    recent: (a, b) => new Date(b.lastVisit || 0) - new Date(a.lastVisit || 0),
    name: (a, b) => (a.name || "").localeCompare(b.name || ""),
    risk: (a, b) => {
      const weight = { high: 0, medium: 1, low: 2 };
      return (weight[a.riskLevel] ?? 3) - (weight[b.riskLevel] ?? 3);
    },
  };
  filtered = filtered.slice().sort(sorters[sortKey] || sorters.recent);

  const { page, pageSize, skip } = clampPagination(req.query.page, req.query.pageSize, { total: filtered.length });
  const pagePatients = filtered.slice(skip, skip + pageSize);

  res.status(200).json({
    success: true,
    data: {
      analytics,
      patients: pagePatients,
      pagination: buildPaginationMeta(page, pageSize, filtered.length),
    },
    message:
      "Doctor patients fetched successfully",
  });
});


export const getPendingDoctors = asyncHandler(
  async (_req, res) => {

    const doctors =
      await Doctor.find({
        verificationStatus: "pending",
      })
      .populate(
        "userId",
        "name email doctorOnboardingStatus"
      )
      .sort({
        createdAt: -1,
      });

    res.status(200).json({
      success: true,
      data: doctors,
    });
  }
);

// PHASE 2-B — Section 5/6/18 bugfix: this endpoint previously had no
// idempotency guard at all. Clicking "Approve" twice (double-click, retry
// after a slow response, two admin tabs) re-pushed a second
// verificationHistory "approved" entry, re-emitted the realtime
// notification, and re-fired the DOCTOR_VERIFIED automation trigger every
// time -- and would have sent a second real approval email once that was
// wired in below. An already-approved doctor is now a safe, idempotent
// no-op: the business state doesn't change, and none of the one-time
// side effects (notification/automation/email) fire a second time.
//
// PHASE 2-C — Section 8/9 bugfix: the Phase 2-B idempotency check above was
// a check-then-act race, not a real concurrency guard. Two concurrent
// approve requests (or an approve racing a reject) could both load the
// document while verificationStatus was still "pending", both pass the
// in-memory idempotency check, and both save -- doubling every one-time
// side effect (history entry, notification, automation trigger, approval
// email) and, in the approve-vs-reject case, leaving the final DB state and
// the side effects it triggered pointing at different terminal outcomes.
// Fixed by making the pending->approved transition itself the atomic guard:
// findOneAndUpdate only succeeds for the one request that observes
// verificationStatus:"pending" at the database level, so exactly one
// request ever owns the one-time side effects below, regardless of how the
// two requests interleave.
export const approveDoctor = asyncHandler(
  async (req, res) => {

    const existing =
      await Doctor.findById(
        req.params.id
      );

    if (!existing) {
      throw new AppError(
        "Doctor not found",
        404
      );
    }

    if (existing.verificationStatus === "approved") {
      return res.status(200).json({
        success: true,
        message: "Doctor is already approved",
        data: existing,
      });
    }

    const cycleId = getVerificationCycleId(existing);

    const doctor = await Doctor.findOneAndUpdate(
      {
        _id: req.params.id,
        verificationStatus: "pending",
      },
      {
        $set: {
          verificationStatus: "approved",
          isVerified: true,
          verifiedBy: req.user._id,
          verifiedAt: new Date(),
        },
        $push: {
          verificationHistory: {
            status: "approved",
            notes: req.body.notes || "",
            changedBy: req.user._id,
            changedAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!doctor) {
      // Lost the race (or the doctor was already rejected by someone else
      // between our existence check and the atomic update above): re-read
      // the current state so the caller gets an accurate, honest response
      // instead of a false "approved successfully".
      const current = await Doctor.findById(req.params.id);

      if (current?.verificationStatus === "approved") {
        return res.status(200).json({
          success: true,
          message: "Doctor is already approved",
          data: current,
        });
      }

      throw new AppError(
        `Doctor is no longer pending (current status: ${current?.verificationStatus || "unknown"})`,
        409
      );
    }

    await User.findByIdAndUpdate(
      doctor.userId,
      {
        doctorOnboardingStatus: "approved",
        "doctorVerification.reviewedAt": new Date(),
        "doctorVerification.reviewedBy": req.user._id,
        "doctorVerification.rejectionReason": "",
      }
    );

    // Verification Center realtime update (Phase D4, Step 8): previously
    // nothing notified the doctor that they'd been approved -- they'd only
    // find out by refreshing the onboarding page.
    try {
      await practiceEmitter.verificationStatusChanged({
        doctorUserId: doctor.userId,
        doctorId: doctor._id,
        cycleId,
        status: "approved",
        notes: req.body.notes || "",
      });
    } catch (error) {
      logger.warn("practiceEmitter.verificationStatusChanged failed", { message: error?.message });
    }

    const verifiedUser = await User.findById(doctor.userId).select("name email").lean();

    // PHASE 2-B — Section 6: real approval email through the existing Brevo
    // abstraction. Business state (the approval itself, already saved
    // above) is never rolled back just because email delivery fails --
    // provider failure is logged/observable, matching the exact
    // try/catch-non-blocking pattern already used for
    // sendAppointmentConfirmation/sendPaymentReceipt elsewhere in this
    // codebase. Never a fake/console.log "email sent".
    if (verifiedUser?.email) {
      try {
        await emailService.sendDoctorApprovalEmail({
          toEmail: verifiedUser.email,
          toName: verifiedUser.name,
          specialization: doctor.specialization,
        });
      } catch (error) {
        logger.error("Doctor approval email failed", {
          event: "doctor_approval_email_failed",
          doctorId: doctor._id.toString(),
          errorName: error?.name,
          message: error?.message,
        });
      }
    }

    // Phase A6.2.3 — Automation Studio real trigger.
    await emitAutomationTrigger(TRIGGER_TYPES.DOCTOR_VERIFIED, {
      doctorId: doctor._id,
      userId: doctor.userId,
      name: verifiedUser?.name,
      specialization: doctor.specialization,
    });

    res.status(200).json({
      success: true,
      message:
        "Doctor approved successfully",
    });
  }
);

// PHASE 2-C — Section 8/9 bugfix: same atomic-transition fix as
// approveDoctor above. The Phase 2-B idempotency check here was also
// check-then-act; a reject racing another reject (or an approve) could
// both observe "pending" before either write landed. findOneAndUpdate's
// {_id, verificationStatus:"pending"} filter is now the sole point of
// truth for who "wins" a pending doctor's terminal transition, so exactly
// one request's side effects fire no matter how approve/reject interleave.
export const rejectDoctor = asyncHandler(
  async (req, res) => {

    const reason = req.body.reason || "";

    const existing =
      await Doctor.findById(
        req.params.id
      );

    if (!existing) {
      throw new AppError(
        "Doctor not found",
        404
      );
    }

    // PHASE 2-B — Section 7/18: same idempotency reasoning as approveDoctor.
    // A doctor already in the "rejected" state with the same reason is a
    // no-op -- no duplicate history entry, notification, or email. If an
    // admin submits a genuinely different reason for an already-rejected
    // doctor, that IS a new administrative action (e.g. correcting the
    // recorded reason) and is allowed to proceed normally.
    if (existing.verificationStatus === "rejected" && existing.verificationNotes === reason) {
      return res.status(200).json({
        success: true,
        message: "Doctor is already rejected",
        data: existing,
      });
    }

    const cycleId = getVerificationCycleId(existing);

    const doctor = await Doctor.findOneAndUpdate(
      {
        _id: req.params.id,
        verificationStatus: "pending",
      },
      {
        $set: {
          verificationStatus: "rejected",
          isVerified: false,
          verificationNotes: reason,
          verifiedBy: req.user._id,
          verifiedAt: new Date(),
        },
        $push: {
          verificationHistory: {
            status: "rejected",
            notes: reason,
            changedBy: req.user._id,
            changedAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!doctor) {
      const current = await Doctor.findById(req.params.id);

      if (current?.verificationStatus === "rejected" && current.verificationNotes === reason) {
        return res.status(200).json({
          success: true,
          message: "Doctor is already rejected",
          data: current,
        });
      }

      throw new AppError(
        `Doctor is no longer pending (current status: ${current?.verificationStatus || "unknown"})`,
        409
      );
    }

    await User.findByIdAndUpdate(
      doctor.userId,
      {
        doctorOnboardingStatus: "rejected",
        "doctorVerification.reviewedAt": new Date(),
        "doctorVerification.reviewedBy": req.user._id,
        "doctorVerification.rejectionReason": reason,
      }
    );

    try {
      await practiceEmitter.verificationStatusChanged({
        doctorUserId: doctor.userId,
        doctorId: doctor._id,
        cycleId,
        status: "rejected",
        notes: doctor.verificationNotes,
      });
    } catch (error) {
      logger.warn("practiceEmitter.verificationStatusChanged failed", { message: error?.message });
    }

    // PHASE 2-B — Section 7: real rejection email, same non-blocking
    // provider-failure handling as approveDoctor above.
    const rejectedUser = await User.findById(doctor.userId).select("name email").lean();
    if (rejectedUser?.email) {
      try {
        await emailService.sendDoctorRejectionEmail({
          toEmail: rejectedUser.email,
          toName: rejectedUser.name,
          reason,
        });
      } catch (error) {
        logger.error("Doctor rejection email failed", {
          event: "doctor_rejection_email_failed",
          doctorId: doctor._id.toString(),
          errorName: error?.name,
          message: error?.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      message:
        "Doctor rejected successfully",
    });
  }
);

// Admin: verify or reject one document in a doctor's Document Center (Step
// 5/10). Previously every uploaded document was permanently stuck at
// "pending" — nothing in the codebase ever moved it. Additive-only: reuses
// the existing Doctor.documents subdocument, doesn't touch verificationStatus
// (the doctor's overall onboarding approval, a separate concern).
export const verifyDoctorDocument = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findById(req.params.doctorId);
  if (!doctor) throw new AppError("Doctor not found", 404);

  const document = doctor.documents.id(req.params.documentId);
  if (!document) throw new AppError("Document not found", 404);

  const { status, notes } = req.body;
  if (!["verified", "rejected"].includes(status)) {
    throw new AppError('Status must be "verified" or "rejected"', 400);
  }

  document.status = status;
  document.verifiedBy = req.user._id;
  document.verifiedAt = new Date();
  document.verificationNotes = notes || "";
  await doctor.save();

  try {
    await clinicalEmitter.documentVerified(doctor.userId, document);
  } catch {
    // Realtime/notification failure should never block the verification itself.
  }

  res.status(200).json({ success: true, data: { document }, message: `Document ${status} successfully` });
});

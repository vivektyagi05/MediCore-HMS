import Appointment from "../../models/Appointment.js";
import Prescription from "../../models/Prescription.js";
import MedicalReport from "../../models/MedicalReport.js";
import NotificationDelivery from "../../models/NotificationDelivery.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { ensureDoctorProfileForUser } from "../../services/doctorProfileService.js";
import { APPOINTMENT_STATUS } from "../../constants/appointmentStatus.js";
import { computeReportAttentionItems } from "../../services/reportAttentionAggregates.js";
import { resolveScheduledFollowUps } from "../../services/doctorPatientRelationshipService.js";

const DONE_STATUSES = [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE, APPOINTMENT_STATUS.CANCELLED];

// Same deterministic, rule-based risk formula as doctorController.getDoctorPatients
// — kept in one place so "high risk" means the same thing everywhere in the app.
// Exported (Phase A5.3) so the admin Executive Action Center's platform-wide
// "High Risk Patients" card reuses this exact rule across all doctors,
// instead of a second, possibly-drifting copy of the classifier.
export function riskLevelFor(painLevel, conditionCount) {
  if ((painLevel != null && painLevel >= 7) || conditionCount >= 3) return "high";
  if ((painLevel != null && painLevel >= 4) || conditionCount >= 1) return "medium";
  return "low";
}

// "HH:MM-HH:MM" -> minutes since midnight for the slot start, so a slot's
// start time can be compared against "now" to flag a delayed consultation.
// Exported (Phase A5.3) for the same platform-wide reuse reason as above.
export function slotStartMinutes(timeSlot) {
  const match = /^(\d{1,2}):(\d{2})/.exec(timeSlot || "");
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Exported (Phase A5.1) so the admin Executive Dashboard's "critical/emergency
// today" signal uses this exact same rule-based classifier instead of a second,
// possibly-drifting copy of the pattern.
export const EMERGENCY_PATTERN = /emergency|severe|urgent|unbearable|chest pain|breathless|bleeding/i;

export async function buildDoctorCommandCenterData(doctor) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Dashboard Follow-up Queue (Phase DOC-01 finalization) needs to show Due
  // Today / Overdue / Upcoming as distinct buckets, so the window can no
  // longer stop at end-of-today — widened to a 14-day forward horizon.
  // Overdue/due-today items are unaffected (still <= endOfToday).
  const followUpWindowEnd = new Date(startOfToday);
  followUpWindowEnd.setDate(followUpWindowEnd.getDate() + 14);

  // PHASE P10 — the backward half of the Recently Completed window (brief
  // §20). Overdue/due-today/upcoming above only ever look forward; a
  // follow-up appointment that already happened needs a bounded backward
  // horizon too, or "recently completed" would mean "forever".
  const recentlyCompletedWindowStart = new Date(startOfToday);
  recentlyCompletedWindowStart.setDate(recentlyCompletedWindowStart.getDate() - 14);

  const [todaysAppointments, followUpsDue, activeInsuranceExpiring, unreadCritical, doctorReports, scheduledFollowUpAppointments, scheduledFollowUpTotalCount] = await Promise.all([
    Appointment.find({ doctorId: doctor._id, date: { $gte: startOfToday, $lt: endOfToday } })
      .populate("patientId", "name patientProfile.medicalConditions")
      .populate("paymentId", "status totalAmount")
      .populate("insuranceId", "provider validTill")
      .sort({ timeSlot: 1 })
      .lean(),

    // Phase DOC-07 final pass: a follow-up the doctor has already turned
    // into a real scheduled Appointment (see scheduleFollowUpAppointment)
    // is done, not pending — excluding it here means the queue only ever
    // shows follow-ups that still need real action, matching the new
    // "Schedule Follow-up" button's actual effect.
    Prescription.find({
      doctorId: doctor._id,
      status: "active",
      followUpDate: { $lte: followUpWindowEnd },
      followUpScheduledAppointmentId: { $exists: false },
    })
      .populate("patientId", "name")
      .select("patientId followUpDate diagnosis")
      .sort({ followUpDate: 1 })
      .lean(),

    Appointment.find({
      doctorId: doctor._id,
      insuranceId: { $ne: null },
    })
      .populate("insuranceId", "provider validTill")
      .populate("patientId", "name")
      .select("insuranceId patientId")
      .lean(),

    NotificationDelivery.countDocuments({
      recipientId: doctor.userId,
      readAt: null,
      severity: { $in: ["critical", "warning"] },
    }),

    MedicalReport.find({ doctorId: doctor._id, reviewedAt: null })
      .select("title category reportDate severity userId")
      .populate("userId", "name")
      .sort({ reportDate: -1 })
      .limit(20)
      .lean(),

    // PHASE P10 — the "Scheduled" / "Recently Completed" halves of the
    // Follow-up Queue that Phase DOC-07's final pass excluded outright once
    // a follow-up became a real Appointment (see the comment on the query
    // above).
    //
    // Queries Appointment directly (real, indexed `date` field —
    // doctorId+date+timeSlot is already a unique index on this collection)
    // rather than Prescription (which has no date field for the SCHEDULED
    // appointment, only for the original recommendation). Sorted by date
    // ascending and bounded so a truncation can only ever drop the
    // farthest-future/oldest — i.e. least relevant — items, never the
    // soonest-upcoming or most-recently-actioned ones. An earlier version
    // of this query fetched from Prescription with no sort at all before
    // `.limit(100)`, which could silently return an arbitrary 100 instead
    // of the most relevant ones — the exact "just cap it and call it
    // scalable" anti-pattern this project already warns against elsewhere.
    // Future (not-yet-occurred) follow-ups have no forward date bound —
    // unlike the "still needs scheduling" window above, an already-booked
    // follow-up two months out is real and done, not something that needs
    // a 14-day ceiling to stay meaningful. Only the completed/cancelled
    // side is bounded, to the same 14-day trailing window as the
    // "Recently Completed" bucket it feeds.
    Appointment.find({
      doctorId: doctor._id,
      appointmentType: "follow_up",
      $or: [
        { status: { $nin: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE, APPOINTMENT_STATUS.CANCELLED] } },
        {
          status: { $in: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE, APPOINTMENT_STATUS.CANCELLED] },
          date: { $gte: recentlyCompletedWindowStart },
        },
      ],
    })
      .select("date timeSlot status")
      .sort({ date: 1 })
      .limit(100)
      .lean(),

    // Same filter, uncapped count — the ONLY way to know whether the
    // capped query above actually dropped anything, so the dashboard can
    // say so instead of silently truncating (brief's scale-audit
    // requirement: "must never silently hide legitimate follow-ups
    // without the UI communicating the boundary").
    Appointment.countDocuments({
      doctorId: doctor._id,
      appointmentType: "follow_up",
      $or: [
        { status: { $nin: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE, APPOINTMENT_STATUS.CANCELLED] } },
        {
          status: { $in: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE, APPOINTMENT_STATUS.CANCELLED] },
          date: { $gte: recentlyCompletedWindowStart },
        },
      ],
    }),
  ]);

  // A cancelled follow-up appointment only belongs in this queue if its
  // Prescription link is STILL set (the defensive `cancelled_needs_action`
  // path — see resolveScheduledFollowUps — for the rare case where
  // cancelAppointmentCore's own unlink hasn't completed yet). If the link
  // was already cleared, that prescription is already correctly back in
  // the plain overdue/due_today/upcoming buckets above via
  // resolveFollowUpState — showing it again here too would double-count
  // the same recommendation in two buckets at once.
  const scheduledFollowUpLinkedPrescriptions = scheduledFollowUpAppointments.length
    ? await Prescription.find({ followUpScheduledAppointmentId: { $in: scheduledFollowUpAppointments.map((a) => a._id) } })
        .populate("patientId", "name")
        .select("patientId diagnosis followUpScheduledAppointmentId")
        .lean()
    : [];

  const queue = todaysAppointments.map((appointment) => {
    const conditionCount = appointment.patientId?.patientProfile?.medicalConditions?.length || 0;
    const risk = riskLevelFor(appointment.painLevel, conditionCount);
    const isEmergency =
      (appointment.painLevel != null && appointment.painLevel >= 8) ||
      EMERGENCY_PATTERN.test(`${appointment.reason || ""} ${(appointment.symptoms || []).join(" ")}`);
    const slotStart = slotStartMinutes(appointment.timeSlot);
    const isDelayed =
      slotStart != null &&
      slotStart < nowMinutes &&
      ![
        APPOINTMENT_STATUS.CONSULTATION_STARTED,
        APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
        APPOINTMENT_STATUS.COMPLETED,
        APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
        APPOINTMENT_STATUS.CANCELLED,
      ].includes(appointment.status);

    return {
      appointmentId: appointment._id,
      patientId: appointment.patientId?._id,
      patientName: appointment.patientId?.name || "Unknown",
      timeSlot: appointment.timeSlot,
      status: appointment.status,
      riskLevel: risk,
      isEmergency,
      isDelayed,
      outstanding: appointment.paymentStatus && appointment.paymentStatus !== "paid" ? appointment.paymentId?.totalAmount || 0 : 0,
    };
  });

  const currentConsultation = queue.filter((a) => a.status === APPOINTMENT_STATUS.CONSULTATION_STARTED);
  const upcoming = queue.filter(
    (a) =>
      [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.PAYMENT_COMPLETED].includes(a.status) &&
      !a.isDelayed,
  );
  const delayed = queue.filter((a) => a.isDelayed);
  const emergencyQueue = queue.filter((a) => a.isEmergency && !DONE_STATUSES.includes(a.status));
  const highRiskToday = queue.filter((a) => a.riskLevel === "high" && !DONE_STATUSES.includes(a.status));
  const recentlyCompleted = queue.filter((a) => [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REVIEW_ELIGIBLE].includes(a.status));
  const priorityQueue = [...emergencyQueue, ...highRiskToday.filter((a) => !a.isEmergency)];

  const outstandingBillsToday = queue.filter((a) => a.outstanding > 0);
  const todaysRevenue = todaysAppointments.reduce(
    (sum, a) => sum + (a.paymentStatus === "paid" && a.paymentId?.totalAmount ? a.paymentId.totalAmount : 0),
    0,
  );

  const completedCount = recentlyCompleted.length;
  const totalToday = queue.filter((a) => a.status !== APPOINTMENT_STATUS.CANCELLED).length;
  const completionPercent = totalToday ? Math.round((completedCount / totalToday) * 100) : 0;

  const pendingInsurance = activeInsuranceExpiring
    .filter((a) => a.insuranceId?.validTill && new Date(a.insuranceId.validTill).getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000)
    .map((a) => ({
      patientId: a.patientId?._id,
      patientName: a.patientId?.name || "Unknown",
      provider: a.insuranceId.provider,
      validTill: a.insuranceId.validTill,
    }));
  // Dedupe key intentionally excludes patientId (name+provider is the real
  // identity of "this insurance record") — adding patientId here is only so
  // the dashboard can link directly to the patient (Smart Box Rule), not a
  // change to what counts as a duplicate.
  const dedupedInsurance = Array.from(new Map(pendingInsurance.map((i) => [`${i.patientName}:${i.provider}`, i])).values());

  const followUpQueue = followUpsDue.map((f) => {
    const dueTime = new Date(f.followUpDate).getTime();
    // due_today / overdue / upcoming — the three buckets the Doctor
    // Dashboard Follow-up Queue distinguishes (Phase DOC-01 finalization).
    const bucket = dueTime < startOfToday.getTime() ? "overdue" : dueTime < endOfToday.getTime() ? "due_today" : "upcoming";
    return {
      prescriptionId: f._id,
      patientId: f.patientId?._id,
      patientName: f.patientId?.name || "Unknown",
      followUpDate: f.followUpDate,
      diagnosis: f.diagnosis,
      overdue: bucket === "overdue",
      bucket,
    };
  });

  // PHASE P10 — same queue, same shape, now also covering the "already
  // scheduled" and "recently completed" halves of the continuity loop
  // (brief §20's Overdue / Due Soon / Scheduled / Recently Completed).
  // Reuses the exact same pure classifier the Patient Profile uses (see
  // resolveScheduledFollowUps) so the two surfaces never disagree about
  // what "scheduled" or "completed" means for the same prescription.
  const appointmentsById = new Map(scheduledFollowUpAppointments.map((a) => [String(a._id), a]));
  const scheduledAndCompleted = resolveScheduledFollowUps(
    scheduledFollowUpLinkedPrescriptions.map((p) => ({ prescription: p, appointment: appointmentsById.get(String(p.followUpScheduledAppointmentId)) })),
    now,
  ).map((item) => {
    const source = scheduledFollowUpLinkedPrescriptions.find((p) => String(p._id) === String(item.prescriptionId));
    return {
      prescriptionId: item.prescriptionId,
      patientId: item.patientId,
      patientName: source?.patientId?.name || "Unknown",
      followUpDate: item.appointmentDate,
      diagnosis: item.diagnosis,
      overdue: false,
      bucket: item.bucket,
      appointmentId: item.appointmentId,
      appointmentTimeSlot: item.appointmentTimeSlot,
      appointmentStatus: item.appointmentStatus,
    };
  });

  followUpQueue.push(...scheduledAndCompleted);

  // PHASE P10 (scale audit) — true only if the bounded query above
  // actually dropped real, legitimate follow-ups; surfaced to the
  // frontend so the widget can say so ("+N more — view all in
  // Appointments") instead of silently truncating with no indication a
  // boundary was even hit.
  const followUpQueueTruncated = scheduledFollowUpTotalCount > scheduledFollowUpAppointments.length;

  return {
    generatedAt: now,
    queue: {
      current: currentConsultation,
      upcoming,
      delayed,
      priority: priorityQueue,
      emergency: emergencyQueue,
      recentlyCompleted,
    },
    highRiskPatientsToday: highRiskToday,
    followUpsDue: followUpQueue,
    // PHASE P10 (scale audit) — true only when the bounded scheduled/
    // completed follow-up query above actually dropped real items; the
    // frontend uses this to show "+N more" rather than silently truncating.
    followUpQueueTruncated,
    // PHASE P9 — Documents & Records: real attention classification (not
    // just a raw list) via the shared, pure computeReportAttentionItems, so
    // this exact set of items — same priority, same ordering — is what
    // the Dashboard's "Reports awaiting review" count/preview AND the
    // Documents page's full "Patient Reports Needing Review" panel both
    // render (both simply call this same getDoctorCommandCenter endpoint).
    // Never a second, possibly-drifting copy of this logic.
    pendingReports: computeReportAttentionItems(doctorReports),
    pendingInsuranceExpiring: dedupedInsurance,
    outstandingBillsToday,
    unreadCriticalNotifications: unreadCritical,
    practiceHealth: {
      todaysTarget: totalToday,
      todaysCompleted: completedCount,
      todaysCompletionPercent: completionPercent,
      todaysRevenue,
      productivityScore: completionPercent, // deterministic proxy: % of today's real queue completed so far
    },
  };
}

export const getDoctorCommandCenter = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user);
  const data = await buildDoctorCommandCenterData(doctor);
  res.status(200).json({ success: true, data, message: "Command center data fetched successfully" });
});

export const markReportReviewed = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user);
  const report = await MedicalReport.findOneAndUpdate(
    { _id: req.params.reportId, doctorId: doctor._id },
    { reviewedAt: new Date(), reviewedBy: req.user._id },
    { new: true },
  ).lean();
  if (!report) {
    throw new AppError("Report not found for this doctor", 404);
  }
  res.status(200).json({ success: true, data: { report }, message: "Report marked as reviewed" });
});

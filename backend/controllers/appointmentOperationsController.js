// Appointment operations: check-in / queue / no-show / resolution, the
// per-appointment allowed-actions contract, the doctor's "Today's Clinic"
// aggregates and the SUPER_ADMIN operational overview. Every figure below is
// computed from persisted data at request time — nothing is hardcoded and the
// frontend never computes authoritative aggregates itself.
import Appointment from "../models/Appointment.js";
import LeaveRequest from "../models/LeaveRequest.js";
import CronRunLog from "../models/CronRunLog.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ROLES } from "../constants/roles.js";
import { APPOINTMENT_STATUS as S, ACTIVE_STATUSES } from "../constants/appointmentStatus.js";
import { VISIT_STATE as V } from "../constants/appointmentVisitState.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";
import { getAppointmentRules } from "../services/hospitalSettingsService.js";
import { buildAllowedActions } from "../services/appointmentGuard.js";
import {
  checkIn, callPatient, markPatientNoShow, reportDoctorNoShow, resolveMissedAppointment,
  loadAppointmentForActor, buildQueue, computeDelayMinutes,
} from "../services/appointmentLifecycleService.js";
import { buildDayCapacity } from "../utils/capacityAggregates.js";
import { getDayOfWeek, findBlockedDate } from "./appointmentController.js";
import {
  hospitalToday, hospitalDateKey, resolveAppointmentInstant, resolveSlotDurationMinutes,
  classifyAppointmentTime, APPOINTMENT_TIME_STATE as T,
} from "../utils/hospitalTime.js";

const roleOf = (user) => (user.role === ROLES.SUPER_ADMIN ? "super_admin" : user.role === ROLES.DOCTOR ? "doctor" : "patient");
const actorOf = (req) => ({ _id: req.user._id, role: roleOf(req.user) });
const ok = (res, data, message) => res.status(200).json({ success: true, data, message });

// PATCH-like actions (POST for non-idempotent operational events) ---------------------------
export const checkInAppointment = asyncHandler(async (req, res) => {
  const appt = await checkIn({ appointmentId: req.params.id, actor: actorOf(req) });
  ok(res, { appointmentId: appt._id, status: appt.status, visit: appt.visit }, "Checked in");
});
export const callAppointmentPatient = asyncHandler(async (req, res) => {
  const appt = await callPatient({ appointmentId: req.params.id, actor: actorOf(req) });
  ok(res, { appointmentId: appt._id, status: appt.status, visit: appt.visit }, "Patient called");
});
export const markAppointmentPatientNoShow = asyncHandler(async (req, res) => {
  const appt = await markPatientNoShow({ appointmentId: req.params.id, actor: actorOf(req), note: req.body?.note });
  ok(res, { appointmentId: appt._id, status: appt.status, visit: appt.visit }, "Marked as patient no-show");
});
export const reportAppointmentDoctorNoShow = asyncHandler(async (req, res) => {
  const { appointment, refundRequestCreated } = await reportDoctorNoShow({ appointmentId: req.params.id, actor: actorOf(req) });
  ok(res, { appointmentId: appointment._id, status: appointment.status, refundRequestCreated }, "Doctor no-show recorded");
});
export const resolveAppointment = asyncHandler(async (req, res) => {
  const appt = await resolveMissedAppointment({
    appointmentId: req.params.id, actor: actorOf(req), outcome: req.body?.outcome, note: req.body?.note,
  });
  ok(res, { appointmentId: appt._id, status: appt.status, visit: appt.visit, resolution: appt.resolution }, "Appointment resolved");
});

// GET /:id/actions — what THIS actor may do right now (UI renders buttons from this) -------
export const getAppointmentActions = asyncHandler(async (req, res) => {
  const appt = await loadAppointmentForActor(req.params.id, actorOf(req));
  const rules = await getAppointmentRules();
  const verdicts = await buildAllowedActions({ appointment: appt, actorRole: roleOf(req.user), rules });
  const time = classifyAppointmentTime({ date: appt.date, timeSlot: appt.timeSlot, tz: rules.timezone, resolutionWindowDays: rules.resolutionWindowDays, fallbackMinutes: rules.defaultSlotMinutes });
  ok(res, {
    appointmentId: appt._id,
    status: appt.status,
    visitState: appt.visit?.state || V.NOT_ARRIVED,
    ...verdicts,
    scheduledStart: time.start,
    resolutionDeadline: time.resolutionDeadline,
    resolutionRequired: Boolean(appt.resolution?.flaggedAt) && !appt.resolution?.resolvedAt && appt.status !== S.CANCELLED,
    impact: appt.impact?.type ? { type: appt.impact.type, reason: appt.impact.reason } : null,
    cancellation: appt.cancellation?.reasonCode ? { source: appt.cancellation.source, reasonCode: appt.cancellation.reasonCode } : null,
    timezone: rules.timezone,
  }, "Allowed actions");
});

const COMPLETED_STATUSES = [S.CONSULTATION_COMPLETED, S.COMPLETED, S.REVIEW_ELIGIBLE];

// GET /doctor/today-clinic — authoritative operational dashboard for the signed-in doctor ---
export const getTodayClinic = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user);
  const rules = await getAppointmentRules();
  const tz = rules.timezone;
  const now = new Date();
  const date = hospitalToday(now, tz);

  const [appointments, activeLeave, needsResolution, impacted] = await Promise.all([
    Appointment.find({ doctorId: doctor._id, date }).populate("patientId", "name").select("timeSlot status paymentStatus consultationMode appointmentType patientId visit resolution date cancellation").limit(500).lean(),
    LeaveRequest.findOne({ doctorId: doctor._id, status: "approved", startDate: { $lte: date }, endDate: { $gte: date } }).lean(),
    Appointment.find({ doctorId: doctor._id, "resolution.flaggedAt": { $exists: true }, "resolution.resolvedAt": { $exists: false }, status: { $in: [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED, S.CONSULTATION_STARTED] } })
      .populate("patientId", "name").select("date timeSlot status consultationMode patientId resolution").sort({ date: 1 }).limit(50).lean(),
    Appointment.find({ doctorId: doctor._id, "impact.flaggedAt": { $exists: true }, status: { $in: [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED] }, date: { $gte: date } })
      .populate("patientId", "name").select("date timeSlot status patientId impact").sort({ date: 1 }).limit(50).lean(),
  ]);

  const live = appointments.filter((a) => a.status !== S.CANCELLED);
  const patientIds = [...new Set(live.map((a) => String(a.patientId?._id)))];
  // "New" = this patient has no completed consultation with this doctor before today.
  const returning = patientIds.length
    ? new Set((await Appointment.distinct("patientId", { doctorId: doctor._id, patientId: { $in: live.map((a) => a.patientId._id) }, status: { $in: COMPLETED_STATUSES }, date: { $lt: date } })).map(String))
    : new Set();
  const newPatients = patientIds.filter((id) => !returning.has(id)).length;

  const dayConfig = doctor.availability?.find((slot) => slot.dayOfWeek === getDayOfWeek(date)) || null;
  const blocked = findBlockedDate(doctor, date);
  const capacity = buildDayCapacity({
    dayConfig,
    appointments: appointments.map((a) => ({ timeSlot: a.timeSlot, status: a.status, appointmentId: a._id, patientName: a.patientId?.name || "Patient", consultationMode: a.consultationMode })),
    blockedReason: blocked?.reason || null,
    leaveReason: activeLeave?.reason || null,
    isPastDate: false,
  });

  const byMode = { online: 0, in_person: 0, home_visit: 0, unspecified: 0 };
  for (const a of live) byMode[a.consultationMode || "unspecified"] = (byMode[a.consultationMode || "unspecified"] || 0) + 1;

  const queue = buildQueue(appointments);
  const withWait = queue.map((a, i) => ({
    appointmentId: a._id,
    patientName: a.patientId?.name || "Patient",
    timeSlot: a.timeSlot,
    consultationMode: a.consultationMode || "",
    visitState: a.visit.state,
    position: i + 1,
    waitingMinutes: a.visit?.checkedInAt ? Math.max(0, Math.floor((now - new Date(a.visit.checkedInAt)) / 60000)) : null, // from persisted checkedInAt
  }));
  const current = appointments.find((a) => a.status === S.CONSULTATION_STARTED) || null;
  const upcoming = live
    .filter((a) => a.status === S.PAYMENT_COMPLETED && [V.NOT_ARRIVED, undefined].includes(a.visit?.state))
    .map((a) => ({ a, start: resolveAppointmentInstant(a.date, a.timeSlot, tz) }))
    .filter((x) => x.start && x.start >= now)
    .sort((x, y) => x.start - y.start);
  const nextPatient = withWait[0]
    ? { ...withWait[0], source: "queue" }
    : upcoming[0] ? { appointmentId: upcoming[0].a._id, patientName: upcoming[0].a.patientId?.name || "Patient", timeSlot: upcoming[0].a.timeSlot, consultationMode: upcoming[0].a.consultationMode || "", visitState: V.NOT_ARRIVED, source: "schedule" } : null;

  const currentDelay = current ? computeDelayMinutes({ date, timeSlot: current.timeSlot, consultationStartedAt: current.visit?.consultationStartedAt, tz }) : null;
  // Running late right now = the queue head's slot already started and nobody is in consultation.
  let runningLateMinutes = null;
  if (!current && withWait[0]) {
    const head = queue[0];
    const start = resolveAppointmentInstant(head.date, head.timeSlot, tz);
    if (start && now > start) runningLateMinutes = Math.floor((now - start) / 60000);
  }

  const sum = (arr) => arr.reduce((n, a) => n + resolveSlotDurationMinutes(a.timeSlot, rules.defaultSlotMinutes), 0);
  const counts = {
    total: live.length,
    newPatients,
    followUps: live.filter((a) => a.appointmentType === "follow_up").length,
    byMode,
    completed: live.filter((a) => COMPLETED_STATUSES.includes(a.status)).length,
    waiting: queue.length,
    inConsultation: appointments.filter((a) => a.status === S.CONSULTATION_STARTED).length,
    missed: appointments.filter((a) => a.visit?.state === V.MISSED && a.status !== S.CANCELLED).length,
    noShow: appointments.filter((a) => [V.NO_SHOW_PATIENT, V.NO_SHOW_DOCTOR].includes(a.visit?.state)).length,
    cancelled: appointments.length - live.length,
    clinicalMinutesBooked: sum(live),
  };

  const alerts = [];
  if (impacted.length) alerts.push({ code: "CALENDAR_IMPACT", count: impacted.length });
  if (needsResolution.length) alerts.push({ code: "NEEDS_RESOLUTION", count: needsResolution.length });
  if (activeLeave) alerts.push({ code: "ON_LEAVE_WITH_APPOINTMENTS", count: live.length, only: live.length > 0 });
  if (capacity.conflicts?.outsideCurrentHours?.length) alerts.push({ code: "OUTSIDE_SCHEDULE", count: capacity.conflicts.outsideCurrentHours.length });
  if (capacity.conflicts?.doubleBookedSlots?.length) alerts.push({ code: "DOUBLE_BOOKED", count: capacity.conflicts.doubleBookedSlots.length });
  if (runningLateMinutes !== null && runningLateMinutes >= rules.delayNotifyThresholdMinutes) alerts.push({ code: "RUNNING_LATE", minutes: runningLateMinutes });
  if (!activeLeave && !alerts.some((x) => x.code === "ON_LEAVE_WITH_APPOINTMENTS")) { /* no leave conflict */ }
  const leaveConflict = Boolean(activeLeave) && live.length > 0;

  ok(res, {
    date: hospitalDateKey(now, tz),
    timezone: tz,
    serverTime: now.toISOString(),
    counts,
    capacity: capacity.capacity,
    remainingCapacity: { slots: capacity.capacity.available, minutes: capacity.capacity.availableMinutes },
    utilization: { slotsPercent: capacity.capacity.utilizationPercent, minutesPercent: capacity.capacity.utilizationMinutesPercent },
    nextPatient,
    queue: withWait,
    currentConsultation: current ? { appointmentId: current._id, patientName: current.patientId?.name || "Patient", timeSlot: current.timeSlot, startedAt: current.visit?.consultationStartedAt || null, delayMinutes: currentDelay } : null,
    delay: { currentConsultationDelayMinutes: currentDelay, runningLateMinutes },
    conflicts: { schedule: capacity.conflicts, leave: leaveConflict ? { reason: activeLeave.reason || "", appointmentCount: live.length } : null },
    needsResolution: needsResolution.map((a) => ({ appointmentId: a._id, date: a.date, timeSlot: a.timeSlot, patientName: a.patientId?.name || "Patient", status: a.status, flaggedAt: a.resolution?.flaggedAt })),
    impactedAppointments: impacted.map((a) => ({ appointmentId: a._id, date: a.date, timeSlot: a.timeSlot, patientName: a.patientId?.name || "Patient", type: a.impact?.type, reason: a.impact?.reason })),
    alerts,
  }, "Today's clinic");
});

// GET /admin/operations — SUPER_ADMIN visibility into lifecycle health ----------------------
export const getAppointmentOperationsOverview = asyncHandler(async (req, res) => {
  const rules = await getAppointmentRules();
  const now = new Date();
  const unresolved = { "resolution.flaggedAt": { $exists: true }, "resolution.resolvedAt": { $exists: false }, status: { $in: [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED, S.CONSULTATION_STARTED] } };
  const [needsResolution, staleStarted, systemExpired7d, noShows7d, doubleBooked, lastRuns] = await Promise.all([
    Appointment.countDocuments(unresolved),
    Appointment.countDocuments({ status: S.CONSULTATION_STARTED, "resolution.flaggedAt": { $exists: true } }),
    Appointment.countDocuments({ "cancellation.source": "system", "cancellation.cancelledAt": { $gte: new Date(now.getTime() - 7 * 86400000) } }),
    Appointment.countDocuments({ "visit.noShowAt": { $gte: new Date(now.getTime() - 7 * 86400000) } }),
    Appointment.aggregate([
      { $match: { status: { $in: ACTIVE_STATUSES }, date: { $gte: hospitalToday(now, rules.timezone) } } },
      { $group: { _id: { d: "$doctorId", date: "$date", s: "$timeSlot" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } }, { $limit: 50 }, { $count: "conflicts" },
    ]),
    CronRunLog.find({ jobName: { $in: ["appointmentLifecycleSweep", "expirePaymentWindows", "automation:appointmentReminder"] } }).sort({ startedAt: -1 }).limit(10).lean(),
  ]);
  const recentUnresolved = await Appointment.find(unresolved).sort({ date: 1 }).limit(25).select("date timeSlot status doctorId resolution").lean();
  ok(res, {
    serverTime: now.toISOString(),
    timezone: rules.timezone,
    rules: { resolutionWindowDays: rules.resolutionWindowDays, checkInEarlyWindowMinutes: rules.checkInEarlyWindowMinutes, noShowGraceMinutes: rules.noShowGraceMinutes },
    totals: { needsResolution, staleStartedConsultations: staleStarted, systemCancelledLast7Days: systemExpired7d, noShowsLast7Days: noShows7d, doubleBookedSlots: doubleBooked[0]?.conflicts || 0 },
    recentUnresolved,
    schedulerRuns: lastRuns,
  }, "Appointment operations overview");
});

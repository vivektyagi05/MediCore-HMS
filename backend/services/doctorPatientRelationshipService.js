// ─────────────────────────────────────────────────────────────────────────
// PHASE DOC-03 — Doctor Patient Relationship Center.
//
// Deliberately dependency-free (no model imports, no DB) so risk/follow-up/
// attention/filter logic can be regression-tested in isolation — same
// pattern as doctorInboxAggregates.js / paginationValidation.js /
// patientAdminAggregationService.js.
//
// This is NOT a duplicate of patientAdminAggregationService.js. That module
// computes a platform-wide picture across every doctor a patient has ever
// seen. This module is intentionally doctor-scoped: every value here is
// derived only from appointments/prescriptions THIS doctor actually has
// with the patient, matching getDoctorPatients' existing query scope. The
// two modules share the same attention-item SHAPE (key/severity/what/why/
// source/action) and the same deterministic-not-fabricated philosophy, but
// are computed from different underlying data on purpose (see doctorController
// header comment for the full rationale).
// ─────────────────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NO_RECENT_VISIT_DAYS = 90;
const RECENT_VISIT_DAYS = 30;
const INSURANCE_EXPIRING_SOON_DAYS = 30;

// Deterministic, rule-based risk level from real fields on file — never an
// AI guess. Extracted verbatim from the pre-existing inline logic in
// getDoctorPatients (no behavior change), so it can be unit-tested and
// reused by the Patient Relationship Center profile without duplicating it.
export function computeRiskLevel({ painLevel, conditionCount = 0, allergyCount = 0 }) {
  if ((painLevel != null && painLevel >= 7) || conditionCount >= 3) return "high";
  if ((painLevel != null && painLevel >= 4) || conditionCount >= 1 || allergyCount > 0) return "medium";
  return "low";
}

// "Overdue follow-up": a prescribed follow-up date came due, but the
// patient's last real visit with this doctor (if any) predates it — i.e.
// they never came back for it. Mirrors the admin-side overdueFollowUp
// philosophy (patientAdminAggregationService.js) but against this doctor's
// own lastVisit, not a platform-wide one.
export function resolveFollowUpState({ followUpDates = [], lastVisit, now = Date.now() }) {
  const validDates = (followUpDates || []).filter(Boolean);
  const upcoming = validDates
    .filter((d) => new Date(d).getTime() > now)
    .sort((a, b) => new Date(a) - new Date(b))[0] || null;

  const pastDue = validDates
    .filter((d) => new Date(d).getTime() <= now)
    .sort((a, b) => new Date(b) - new Date(a));

  const overdue =
    pastDue[0] && (!lastVisit || new Date(lastVisit).getTime() < new Date(pastDue[0]).getTime())
      ? pastDue[0]
      : null;

  let bucket = null;
  if (overdue) bucket = "overdue";
  else if (upcoming) {
    const daysUntil = Math.ceil((new Date(upcoming).getTime() - now) / ONE_DAY_MS);
    bucket = daysUntil <= 0 ? "due_today" : "upcoming";
  }

  return { upcoming, overdue, bucket };
}

// PHASE P10 — Follow-up / Continuity.
//
// resolveFollowUpState above deliberately only tracks UNSCHEDULED follow-up
// recommendations (every caller filters out prescriptions that already have
// a followUpScheduledAppointmentId before passing dates in). That's correct
// for what it does, but it means once a follow-up is turned into a real
// Appointment, nothing in the app tracked it any further — it simply
// disappeared from the Follow-up Queue, the Patient Profile's follow-up
// card, and every attention list until it silently completed or was
// cancelled with no trace. That silent disappearance is exactly the
// continuity break this phase closes.
//
// Pure and DB-free by the same convention as resolveFollowUpState — the
// caller fetches the prescription+appointment pairs however its own query
// shape already works (dashboard vs. patient profile query differently) and
// hands them in already paired.
export function resolveScheduledFollowUps(pairs = [], _now = Date.now()) {
  const items = [];
  for (const { prescription, appointment } of pairs) {
    if (!prescription || !appointment) continue; // stale/deleted link — nothing real to show
    let bucket;
    if (appointment.status === "cancelled") {
      // Defensive only. A correctly functioning cancellation flow clears
      // Prescription.followUpScheduledAppointmentId the moment the linked
      // appointment is cancelled (see appointmentCancellationService.js),
      // which puts the prescription straight back into
      // resolveFollowUpState's normal overdue/due_today/upcoming buckets —
      // so this case should only ever surface for data written before that
      // fix existed, never for anything scheduled going forward.
      bucket = "cancelled_needs_action";
    } else if (appointment.status === "completed" || appointment.status === "review_eligible") {
      bucket = "completed";
    } else {
      bucket = "scheduled";
    }
    items.push({
      prescriptionId: prescription._id,
      patientId: prescription.patientId,
      diagnosis: prescription.diagnosis,
      appointmentId: appointment._id,
      appointmentDate: appointment.date,
      appointmentTimeSlot: appointment.timeSlot,
      appointmentStatus: appointment.status,
      bucket,
    });
  }
  return items;
}

// PHASE P10 — the atomic "claim" step scheduleFollowUpAppointment uses to
// guarantee at most one active follow-up appointment per prescription even
// under concurrent requests. Extracted into its own function — rather than
// left inline in the controller — specifically so its concurrency
// correctness can be exercised in a test without a live MongoDB (see
// followUpSchedulingConcurrency.test.mjs, which races two calls against an
// in-memory fake that deliberately interleaves the read and write halves of
// the update, the same way two real concurrent Mongo requests would).
//
// `prescriptionModel` is dependency-injected: the real code path passes the
// actual Mongoose Prescription model — a single-document findOneAndUpdate
// is atomic in MongoDB itself regardless of deployment topology, so no
// in-process locking is needed there — while a test can substitute a fake
// that models that same atomicity contract without a database. The
// filter's precondition ($or against "no active link") is what makes this
// safe: whichever concurrent caller's write reaches Mongo first is the only
// one whose filter still matches by the time it runs; the other's
// findOneAndUpdate simply finds nothing to update and returns null.
export async function claimFollowUpSlot(prescriptionModel, { prescriptionId, doctorId, patientId, appointmentId }) {
  return prescriptionModel.findOneAndUpdate(
    {
      _id: prescriptionId,
      doctorId,
      patientId,
      $or: [{ followUpScheduledAppointmentId: { $exists: false } }, { followUpScheduledAppointmentId: null }],
    },
    { $set: { followUpScheduledAppointmentId: appointmentId }, $unset: { followUpCancelledAt: "" } },
    { new: false },
  );
}

// Every item states WHY/WHAT/WHEN/ACTION-hint from real, already-computed
// per-patient fields — nothing here invents a reason the caller's data
// doesn't already contain. `action` is a route hint the frontend resolves
// against real pages (Clinical Workspace / Chat / Documents) — never a
// fabricated destination.
export function computeDoctorPatientAttentionItems(patient) {
  const items = [];

  // PHASE P10 — a follow-up that was scheduled and then cancelled needs the
  // doctor's attention again (continuity action required), same severity
  // tier as an overdue unscheduled one. Additive: callers that don't pass
  // scheduledFollowUp (every pre-P10 call site) never trigger this branch,
  // and it deliberately takes priority over the plain "overdue" wording
  // below since it's the more specific, more actionable fact.
  const cancelledFollowUp = (patient.scheduledFollowUps || []).find((f) => f.bucket === "cancelled_needs_action");
  if (cancelledFollowUp) {
    items.push({
      key: "followup-cancelled",
      severity: "critical",
      what: "Scheduled follow-up was cancelled.",
      why: "This follow-up appointment was cancelled — the recommendation still needs a plan.",
      action: "followup",
    });
  } else if (patient.followUp?.overdue) {
    items.push({
      key: "followup-overdue",
      severity: "critical",
      what: "Follow-up overdue.",
      why: `Follow-up was recommended for ${new Date(patient.followUp.overdue).toLocaleDateString()} and no later visit is on file.`,
      action: "followup",
    });
  } else if (patient.followUp?.bucket === "due_today") {
    items.push({
      key: "followup-due-today",
      severity: "warning",
      what: "Follow-up due today.",
      why: `Follow-up recommended for ${new Date(patient.followUp.upcoming).toLocaleDateString()}.`,
      action: "followup",
    });
  } else if (patient.followUp?.bucket === "upcoming") {
    items.push({
      key: "followup-upcoming",
      severity: "info",
      what: "Follow-up upcoming.",
      why: `Follow-up recommended for ${new Date(patient.followUp.upcoming).toLocaleDateString()}.`,
      action: "followup",
    });
  }

  if (patient.nextVisit) {
    items.push({
      key: "appointment-upcoming",
      severity: "info",
      what: "Upcoming appointment scheduled.",
      why: `Scheduled for ${new Date(patient.nextVisit).toLocaleString()}.`,
      action: "appointments",
    });
  }

  if (patient.allergies?.length) {
    items.push({
      key: "allergy-on-file",
      severity: "info",
      what: `Allergy on file: ${patient.allergies.join(", ")}.`,
      why: "Confirm before any new prescription or procedure.",
      action: "profile",
    });
  }

  // PHASE P6 — real, persisted reviewed state (MedicalReport.reviewedAt),
  // never a time-based guess. Additive: callers that don't pass
  // unreviewedReports simply never trigger this item.
  if (patient.unreviewedReports > 0) {
    items.push({
      key: "unreviewed-report",
      severity: "warning",
      what: `${patient.unreviewedReports} report${patient.unreviewedReports > 1 ? "s" : ""} awaiting review.`,
      why: "New lab/radiology report(s) uploaded and not yet marked reviewed.",
      action: "report",
    });
  }

  if (patient.insurance?.expiringSoon) {
    items.push({
      key: "insurance-expiring",
      severity: "warning",
      what: "Insurance expiring soon.",
      why: `Policy expires ${new Date(patient.insurance.validTill).toLocaleDateString()}.`,
      action: "profile",
    });
  }

  if (patient.outstandingAmount > 0) {
    items.push({
      key: "outstanding-bill",
      severity: "warning",
      what: `Outstanding bill of \u20b9${patient.outstandingAmount}.`,
      why: "Unpaid balance recorded on a past appointment.",
      action: "appointments",
    });
  }

  if (patient.unreadMessages > 0) {
    items.push({
      key: "unread-messages",
      severity: "action_required",
      what: `${patient.unreadMessages} unread message${patient.unreadMessages > 1 ? "s" : ""}.`,
      why: "Patient sent a message that hasn't been read yet.",
      action: "chat",
    });
  }

  return items;
}

export function isInsuranceExpiringSoon(validTill, now = Date.now()) {
  if (!validTill) return false;
  const ms = new Date(validTill).getTime() - now;
  return ms > 0 && ms < INSURANCE_EXPIRING_SOON_DAYS * ONE_DAY_MS;
}

// PHASE P6 (gap-closure) — "Open Clinical Actions". Distinct from
// computeDoctorPatientAttentionItems above: attention items answer WHY
// something matters (severity/context); this answers WHAT the doctor must
// concretely DO next, WHEN, and WHERE that action lives — a real queue,
// not a duplicate of the attention list. Built only from fields the caller
// already fetched (followUp, the patient's reports) — zero new queries,
// zero invented actions. `dueBucket` drives the status pill
// (OVERDUE/DUE_TODAY/UPCOMING) using the exact same bucket logic
// resolveFollowUpState already computes, so the two panels never disagree.
export function buildOpenClinicalActions({ followUp, reports = [], consultationAwaitingCompletion = [], scheduledFollowUps = [] } = {}) {
  const actions = [];

  // PHASE P10 — mirrors the critical attention item above: a cancelled
  // scheduled follow-up is the doctor's single most concrete next action,
  // so it takes the same precedence over the plain overdue/due/upcoming
  // wording (which resolveFollowUpState won't even produce for this
  // prescription once it's linked — see that function's header comment).
  const cancelledFollowUp = scheduledFollowUps.find((f) => f.bucket === "cancelled_needs_action");
  if (cancelledFollowUp) {
    actions.push({
      key: `action-followup-cancelled-${cancelledFollowUp.appointmentId}`,
      what: "Reschedule the cancelled follow-up.",
      why: "The scheduled follow-up appointment was cancelled — the original recommendation is still open.",
      when: "Now",
      status: "OVERDUE",
      action: "followup",
    });
  } else if (followUp?.overdue) {
    actions.push({
      key: "action-followup-overdue",
      what: "Schedule the overdue follow-up.",
      why: "The recommended follow-up date has passed with no later visit on file.",
      when: new Date(followUp.overdue).toLocaleDateString(),
      status: "OVERDUE",
      action: "followup",
    });
  } else if (followUp?.bucket === "due_today") {
    actions.push({
      key: "action-followup-due-today",
      what: "Schedule today's follow-up.",
      why: "Follow-up was recommended for today.",
      when: "Today",
      status: "DUE_TODAY",
      action: "followup",
    });
  } else if (followUp?.bucket === "upcoming") {
    actions.push({
      key: "action-followup-upcoming",
      what: "Schedule the upcoming follow-up.",
      why: "A follow-up date is coming up.",
      when: new Date(followUp.upcoming).toLocaleDateString(),
      status: "UPCOMING",
      action: "followup",
    });
  }

  // PHASE P10 — a follow-up that's already been scheduled is no longer an
  // action the doctor needs to take, but it should still be visible here
  // (closing the "doctor has to manually search old consultation context"
  // gap) rather than dropping out of view entirely between scheduling and
  // completion.
  for (const scheduled of scheduledFollowUps.filter((f) => f.bucket === "scheduled")) {
    actions.push({
      key: `action-followup-scheduled-${scheduled.appointmentId}`,
      what: "Follow-up appointment scheduled.",
      why: "Already booked — no further scheduling action needed.",
      when: new Date(scheduled.appointmentDate).toLocaleDateString(),
      status: "SCHEDULED",
      action: "appointments",
      appointmentId: scheduled.appointmentId,
    });
  }

  for (const report of reports.filter((r) => !r.reviewedAt)) {
    actions.push({
      key: `action-report-${report._id}`,
      what: `Review report: ${report.title}`,
      why: "New report uploaded and not yet marked reviewed.",
      when: report.reportDate ? new Date(report.reportDate).toLocaleDateString() : "Recently uploaded",
      status: "DUE_TODAY",
      action: "report",
      reportId: report._id,
    });
  }

  for (const appointment of consultationAwaitingCompletion) {
    actions.push({
      key: `action-complete-${appointment._id}`,
      what: "Complete this consultation.",
      why: "Documentation is on file but the consultation hasn't been marked complete.",
      when: appointment.date ? new Date(appointment.date).toLocaleDateString() : "Pending",
      status: "DUE_TODAY",
      action: "clinical",
      appointmentId: appointment._id,
    });
  }

  return actions;
}

// STEP 3 — patient-list attention filters. Every predicate is derived only
// from fields the caller already computed (lastVisit/nextVisit/followUp) —
// no invented status.
export const PATIENT_LIST_FILTERS = Object.freeze([
  "all",
  "recent",
  "followup_due",
  "upcoming_appointment",
  "no_recent_visit",
  "active",
  "high_risk",
]);

export function matchesPatientFilter(patient, filter, now = Date.now()) {
  const daysSinceVisit = patient.lastVisit
    ? Math.floor((now - new Date(patient.lastVisit).getTime()) / ONE_DAY_MS)
    : null;

  switch (filter) {
    case "recent":
      return daysSinceVisit != null && daysSinceVisit <= RECENT_VISIT_DAYS;
    case "followup_due":
      return Boolean(patient.followUp?.overdue) || patient.followUp?.bucket === "due_today" || patient.followUp?.bucket === "upcoming";
    case "upcoming_appointment":
      return Boolean(patient.nextVisit);
    case "no_recent_visit":
      return daysSinceVisit == null || daysSinceVisit > NO_RECENT_VISIT_DAYS;
    case "active":
      return Boolean(patient.nextVisit) || (daysSinceVisit != null && daysSinceVisit <= NO_RECENT_VISIT_DAYS);
    case "high_risk":
      return patient.riskLevel === "high";
    case "all":
    default:
      return true;
  }
}

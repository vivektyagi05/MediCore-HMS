// PHASE UI-4 — Patients Management Workspace.
//
// Admin-side patient aggregation core. This is a DIFFERENT query shape from
// doctorController.getDoctorPatients on purpose, not a duplicate of it:
// the doctor version is intentionally scoped to "appointments this doctor
// personally had with this patient" and reads insurance/reports/family via
// the refs embedded on THOSE appointments. The admin registry/workspace
// needs a patient's full platform-wide picture across every doctor, so it
// queries the primary collections (MedicalReport, Insurance, FamilyMember,
// Payment) directly rather than only what happens to be attached to one
// doctor's appointments. Both share the same deterministic risk/attention
// philosophy (documented inline) so the two views never contradict each
// other in spirit, but the underlying query is genuinely different data.
//
// Every value produced here traces to a real stored field. Nothing is
// fabricated, no percentage is invented, and no diagnosis is inferred.
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Prescription from "../models/Prescription.js";
import MedicalReport from "../models/MedicalReport.js";
import Payment from "../models/Payment.js";
import Insurance from "../models/Insurance.js";
import FamilyMember from "../models/FamilyMember.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_PAYMENT_STATUSES = ["created", "pending", "failed"];
const COMPLETED_APPOINTMENT_STATUSES = ["completed", "review_eligible", "consultation_completed"];

export const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
};

// Deterministic, rule-based — never an AI guess. Mirrors the philosophy of
// the doctor-side risk rule (pain level / condition count / allergy
// presence) so the two don't contradict, but is recomputed here from the
// admin-scoped aggregate below rather than shared code, since the doctor
// version is tightly coupled to that controller's own appointment-populate
// shape.
export const computePatientRiskLevel = ({ medicalConditions = [], allergies = [], latestPainLevel }) => {
  const conditionCount = medicalConditions.length;
  if ((latestPainLevel != null && latestPainLevel >= 7) || conditionCount >= 3) return "high";
  if ((latestPainLevel != null && latestPainLevel >= 4) || conditionCount >= 1 || allergies.length > 0) return "medium";
  return "low";
};

// Builds the real per-patient operational aggregate for a batch of
// patientIds in a fixed number of queries (no N+1), regardless of batch
// size. Used by both the registry list (lighter per-row use) and the
// Patient 360 workspace (fuller single-patient use).
export const buildPatientAggregates = async (patientIds) => {
  const ids = patientIds.map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));
  const now = Date.now();

  const [appointments, prescriptions, reports, payments, insurancePolicies, familyMembers] = await Promise.all([
    Appointment.find({ patientId: { $in: ids } })
      .populate({
        path: "doctorId",
        select: "specialization userId",
        populate: { path: "userId", select: "name" },
      })
      .select("patientId doctorId date status reason painLevel consultationMode createdAt")
      .sort({ date: -1 })
      .lean(),
    Prescription.find({ patientId: { $in: ids } })
      .select("patientId doctorId appointmentId followUpDate createdAt status")
      .lean(),
    MedicalReport.find({ userId: { $in: ids } })
      .select("userId title category reportDate severity reviewedAt createdAt")
      .lean(),
    Payment.find({ userId: { $in: ids } })
      .select("userId status totalAmount refundStatus refundedAmount createdAt appointmentId")
      .lean(),
    Insurance.find({ userId: { $in: ids } })
      .select("userId provider policyNumber validTill coverageAmount claimStatus")
      .lean(),
    FamilyMember.find({ userId: { $in: ids }, isActive: true }).select("userId name relation").lean(),
  ]);

  const buckets = new Map(ids.map((id) => [id.toString(), { appointments: [], prescriptions: [], reports: [], payments: [], insurance: [], family: [] }]));
  const push = (map, key, list, item) => map.get(key)?.[list].push(item);

  appointments.forEach((a) => push(buckets, a.patientId.toString(), "appointments", a));
  prescriptions.forEach((p) => push(buckets, p.patientId.toString(), "prescriptions", p));
  reports.forEach((r) => push(buckets, r.userId.toString(), "reports", r));
  payments.forEach((p) => push(buckets, p.userId.toString(), "payments", p));
  insurancePolicies.forEach((i) => push(buckets, i.userId.toString(), "insurance", i));
  familyMembers.forEach((f) => push(buckets, f.userId.toString(), "family", f));

  const result = new Map();

  for (const [patientId, bucket] of buckets.entries()) {
    const nonCancelled = bucket.appointments.filter((a) => a.status !== "cancelled");
    const pastAppointments = nonCancelled.filter((a) => new Date(a.date).getTime() <= now);
    const futureAppointments = nonCancelled.filter((a) => new Date(a.date).getTime() > now);
    const lastAppointment = pastAppointments[0] || null; // already sorted desc by date
    const nextAppointment = futureAppointments.slice().sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;

    const outstandingAmount = bucket.payments
      .filter((p) => OPEN_PAYMENT_STATUSES.includes(p.status))
      .reduce((sum, p) => sum + (p.totalAmount || 0), 0);
    const hasFailedPayment = bucket.payments.some((p) => p.status === "failed");

    const followUpDates = bucket.prescriptions.map((p) => p.followUpDate).filter(Boolean);
    const upcomingFollowUp = followUpDates
      .filter((d) => new Date(d).getTime() > now)
      .sort((a, b) => new Date(a) - new Date(b))[0] || null;
    const pastDueFollowUps = followUpDates.filter((d) => new Date(d).getTime() <= now).sort((a, b) => new Date(b) - new Date(a));
    // "Overdue follow-up": a follow-up date came due, but the patient's last
    // real visit (if any) predates it — i.e. they never came back for it.
    const overdueFollowUp =
      pastDueFollowUps[0] && (!lastAppointment || new Date(lastAppointment.date).getTime() < new Date(pastDueFollowUps[0]).getTime())
        ? pastDueFollowUps[0]
        : null;

    const criticalUnreviewedReports = bucket.reports.filter((r) => r.severity !== "normal" && !r.reviewedAt);

    const expiringInsurance = bucket.insurance.filter(
      (i) => i.validTill && new Date(i.validTill).getTime() > now && new Date(i.validTill).getTime() - now < 30 * ONE_DAY_MS,
    );
    const expiredInsurance = bucket.insurance.filter((i) => i.validTill && new Date(i.validTill).getTime() <= now);

    // "Missing prescription after completed consultation": the patient's
    // most recent appointment reached a completed-family status but has no
    // prescription filed against that exact appointmentId.
    const missingPrescriptionAfterCompletion =
      lastAppointment &&
      COMPLETED_APPOINTMENT_STATUSES.includes(lastAppointment.status) &&
      !bucket.prescriptions.some((p) => String(p.appointmentId) === String(lastAppointment._id));

    result.set(patientId, {
      appointmentCount: nonCancelled.length,
      lastVisit: lastAppointment?.date || null,
      nextVisit: nextAppointment?.date || null,
      latestVisitSnapshot: lastAppointment
        ? {
            appointmentId: lastAppointment._id,
            reason: lastAppointment.reason || "",
            painLevel: lastAppointment.painLevel ?? null,
            status: lastAppointment.status,
            doctorName: lastAppointment.doctorId?.userId?.name || null,
            specialization: lastAppointment.doctorId?.specialization || null,
          }
        : null,
      nextAppointmentDoctor: nextAppointment?.doctorId?.userId?.name || null,
      recentAppointments: bucket.appointments.slice(0, 10),
      reportsCount: bucket.reports.length,
      recentReports: bucket.reports
        .slice()
        .sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate))
        .slice(0, 10),
      criticalUnreviewedReports,
      prescriptionsCount: bucket.prescriptions.length,
      recentPrescriptions: bucket.prescriptions
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10),
      upcomingFollowUp,
      overdueFollowUp,
      missingPrescriptionAfterCompletion,
      outstandingAmount,
      hasFailedPayment,
      payments: bucket.payments,
      insurance: bucket.insurance,
      expiringInsurance,
      expiredInsurance,
      familyMembers: bucket.family,
    });
  }

  return result;
};

// Turns one patient's (User + aggregate) pair into a real, explainable
// attention list. Every item states what happened, why it matters, its
// data source, a severity, and (where applicable) a suggested next action —
// never a diagnosis, never a fabricated score.
export const computeAttentionItems = (user, aggregate) => {
  const items = [];
  const profile = user.patientProfile || {};

  if ((profile.allergies || []).length) {
    items.push({
      key: "allergy-on-file",
      severity: "info",
      what: `Allergy on file: ${profile.allergies.join(", ")}.`,
      why: "Care staff should confirm this before any new prescription or procedure.",
      source: "Patient health profile",
    });
  }

  aggregate.criticalUnreviewedReports.forEach((report) => {
    items.push({
      key: `report-unreviewed-${report._id}`,
      severity: report.severity === "critical" ? "critical" : "warning",
      what: `${report.severity === "critical" ? "Critical" : "Urgent"} report awaiting review: "${report.title}".`,
      why: "Uploaded with a clinical urgency flag and has not yet been marked reviewed by a doctor.",
      source: `Medical report · ${new Date(report.reportDate).toLocaleDateString()}`,
      action: "Escalate to the assigned or an available doctor for review.",
    });
  });

  if (aggregate.hasFailedPayment) {
    items.push({
      key: "payment-failed",
      severity: "warning",
      what: "A payment attempt has failed.",
      why: "The linked appointment or service may be at risk until this is resolved.",
      source: "Payment records",
      action: "Follow up with the patient or retry payment collection.",
    });
  }

  if (aggregate.outstandingAmount > 0) {
    items.push({
      key: "outstanding-balance",
      severity: "warning",
      what: `Outstanding balance of ₹${aggregate.outstandingAmount}.`,
      why: "Unpaid amount across pending/failed payments on file.",
      source: "Payment records",
    });
  }

  aggregate.expiringInsurance.forEach((policy) => {
    items.push({
      key: `insurance-expiring-${policy._id}`,
      severity: "info",
      what: `Insurance with ${policy.provider} expires ${new Date(policy.validTill).toLocaleDateString()}.`,
      why: "Coverage will lapse soon if not renewed.",
      source: "Insurance records",
    });
  });

  aggregate.expiredInsurance.forEach((policy) => {
    items.push({
      key: `insurance-expired-${policy._id}`,
      severity: "warning",
      what: `Insurance with ${policy.provider} has expired.`,
      why: "Claims may no longer be honored under this policy.",
      source: "Insurance records",
    });
  });

  if (aggregate.latestVisitSnapshot?.painLevel != null && aggregate.latestVisitSnapshot.painLevel >= 7) {
    items.push({
      key: "high-pain-level",
      severity: "critical",
      what: `High pain level reported at the last visit (${aggregate.latestVisitSnapshot.painLevel}/10).`,
      why: "May indicate an unresolved or worsening condition.",
      source: "Latest appointment intake",
    });
  }

  if (aggregate.overdueFollowUp) {
    items.push({
      key: "overdue-follow-up",
      severity: "warning",
      what: `A follow-up was due ${new Date(aggregate.overdueFollowUp).toLocaleDateString()} and no later visit is on record.`,
      why: "The patient may not have returned for a doctor-scheduled follow-up.",
      source: "Prescription records",
      action: "Reach out to confirm whether the follow-up is still needed.",
    });
  }

  if (aggregate.missingPrescriptionAfterCompletion) {
    items.push({
      key: "missing-prescription",
      severity: "info",
      what: "The most recent completed consultation has no prescription on file.",
      why: "May mean no medication was needed, or that filing is still pending.",
      source: "Appointment & prescription records",
    });
  }

  const missingFields = [];
  if (!profile.bloodGroup) missingFields.push("blood group");
  if (!profile.emergencyContact?.phone) missingFields.push("emergency contact");
  if (!profile.dateOfBirth) missingFields.push("date of birth");
  if (missingFields.length) {
    items.push({
      key: "incomplete-profile",
      severity: "info",
      what: `Health profile missing: ${missingFields.join(", ")}.`,
      why: "Incomplete records can slow down care in an emergency.",
      source: "Patient health profile",
    });
  }

  if (aggregate.nextVisit) {
    items.push({
      key: "upcoming-appointment",
      severity: "info",
      what: `Upcoming appointment on ${new Date(aggregate.nextVisit).toLocaleDateString()}${aggregate.nextAppointmentDoctor ? ` with Dr. ${aggregate.nextAppointmentDoctor}` : ""}.`,
      why: "Scheduled and confirmed on the calendar.",
      source: "Appointment records",
    });
  }

  return items;
};

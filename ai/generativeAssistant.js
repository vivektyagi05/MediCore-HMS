import AIDraft from "../models/AIDraft.js";
import Appointment from "../models/Appointment.js";
import Certificate from "../models/Certificate.js";
import Doctor from "../models/Doctor.js";
import LeaveRequest from "../models/LeaveRequest.js";
import FamilyMember from "../models/FamilyMember.js";
import Insurance from "../models/Insurance.js";
import Invoice from "../models/Invoice.js";
import MedicalNote from "../models/MedicalNote.js";
import MedicalReport from "../models/MedicalReport.js";
import Payment from "../models/Payment.js";
import Prescription from "../models/Prescription.js";
import RefundRequest from "../models/RefundRequest.js";
import Review from "../models/Review.js";
import User from "../models/User.js";
import { buildInsuranceUtilization } from "../controllers/patient/patientWorkflowController.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ACTIVE_STATUSES } from "../constants/appointmentStatus.js";
import { DISCLAIMERS } from "./promptLibrary.js";
import { generateText } from "./providers/textGenerationProvider.js";
import { resolveFollowUpState, computeDoctorPatientAttentionItems } from "../services/doctorPatientRelationshipService.js";
import { buildSinceLastVisitComparison, buildMedicationReconciliation } from "../services/clinicalComparisonService.js";

const fmtDate = (value) => (value ? new Date(value).toLocaleDateString() : "not on file");

// PHASE P6 (gap-closure) — AI Clinical Copilot. Deterministic, grounded
// Q&A: every question routes to a fixed resolver over data already fetched
// for THIS patient/doctor pair — never a free-form LLM call, never a
// fabricated fact. A free-text question that doesn't match a known intent
// returns an explicit "don't have this" rather than a guess (§13/§15 of
// the gap-closure brief: safe intent resolution, not a blind LLM bolt-on).
export const COPILOT_QUICK_QUESTIONS = [
  { key: "what_changed", label: "What changed?" },
  { key: "summary", label: "Summarize history" },
  { key: "medications", label: "Medication changes?" },
  { key: "current_medicines", label: "Current medicines?" },
  { key: "pending_actions", label: "Pending actions?" },
  { key: "reports", label: "Recent reports?" },
  { key: "follow_up", label: "Follow-up status?" },
  { key: "previous_visit", label: "Previous visit?" },
  { key: "recent_events", label: "Recent clinical events?" },
];

// Wider, still-deterministic synonym coverage per intent (§13) — every
// pattern maps to exactly one of the fixed resolvers above; nothing here
// generates free text, it only decides WHICH real-data resolver answers.
const INTENT_PATTERNS = [
  { key: "what_changed", pattern: /what changed|since (the )?last|any changes?|different (from|since)/ },
  { key: "current_medicines", pattern: /current med(icine|ication)s?|currently taking|what.*taking\b|active prescription/ },
  { key: "medications", pattern: /medic|dosage|dose chang|drug chang|prescription chang/ },
  { key: "follow_up", pattern: /follow[\s-]?up|next visit due|when.*(come back|return)/ },
  { key: "previous_visit", pattern: /previous visit|last visit|last appointment|when.*(last (seen|visited))/ },
  { key: "recent_events", pattern: /recent (clinical )?events?|what happened (recently|lately)|timeline/ },
  { key: "reports", pattern: /report|lab|radiology|result|scan/ },
  { key: "pending_actions", pattern: /pending|action|todo|attention|need(s)? (to|attention)/ },
  { key: "summary", pattern: /summar|history|overview|background/ },
];

export function resolveCopilotQuestionKey(question) {
  const q = (question || "").trim().toLowerCase();
  if (COPILOT_QUICK_QUESTIONS.some((item) => item.key === q)) return q;
  for (const { key, pattern } of INTENT_PATTERNS) {
    if (pattern.test(q)) return key;
  }
  return null;
}

// Evidence is actionable (§14): every entry carries type + date + a short,
// real description, plus a `route` the frontend can navigate to when one
// genuinely exists — never a fabricated deep link.
const evidenceFor = {
  appointment: (a) => a && { type: "appointment", id: a._id, date: a.date, description: a.date ? `Appointment on ${fmtDate(a.date)}` : "Appointment", route: `/doctor/appointments?patientId=${a.patientId || ""}` },
  prescription: (p, patientId) => p && { type: "prescription", id: p.currentPrescriptionId || p._id, date: p.currentDate || p.createdAt, description: `Prescription (${fmtDate(p.currentDate || p.createdAt)})`, route: `/doctor/clinical?patientId=${patientId}&tab=prescriptions` },
  report: (r, patientId) => r && { type: "report", id: r._id, date: r.reportDate, description: `${r.title} (${r.category || "report"}, ${fmtDate(r.reportDate)})`, route: `/doctor/clinical?patientId=${patientId}&tab=overview` },
  patient: (patientId) => ({ type: "patient", id: patientId, date: null, description: "Patient record", route: `/doctor/patients/${patientId}` }),
};

function buildCopilotAnswer(key, ctx) {
  switch (key) {
    case "what_changed": {
      if (!ctx.sinceLastVisit.available) return { answer: ctx.sinceLastVisit.reason, evidence: [] };
      const changed = ctx.sinceLastVisit.rows.filter((row) => row.status !== "UNCHANGED");
      const range = `${fmtDate(ctx.sinceLastVisit.previousVisitDate)} \u2192 ${fmtDate(ctx.sinceLastVisit.currentVisitDate)}`;
      const answer = changed.length
        ? `Since the last visit (${range}): ${changed.map((r) => `${r.label} went from ${r.previous} to ${r.current}`).join("; ")}.`
        : `No recorded changes since the last visit (${range}).`;
      return {
        answer,
        evidence: [
          evidenceFor.appointment({ _id: ctx.currentAppointmentId, date: ctx.sinceLastVisit.currentVisitDate, patientId: ctx.patientId }),
          evidenceFor.appointment({ _id: ctx.previousAppointmentId, date: ctx.sinceLastVisit.previousVisitDate, patientId: ctx.patientId }),
        ].filter(Boolean),
      };
    }
    case "summary": {
      const answer = `${ctx.patientName} has ${ctx.appointmentCount} recorded appointment(s) with you, last on ${fmtDate(ctx.lastVisit)}. ${ctx.prescriptionCount} prescription(s) and ${ctx.noteCount} clinical note(s) on file.`;
      return { answer, evidence: [evidenceFor.patient(ctx.patientId)] };
    }
    case "current_medicines": {
      const current = ctx.prescriptions[0];
      if (!current?.medicines?.length) return { answer: "No active prescription with medicines on file for this patient.", evidence: [] };
      const answer = current.medicines.map((m) => `${m.name} \u2014 ${[m.dosage, m.frequency].filter(Boolean).join(" ")}`).join("; ") + ".";
      return { answer, evidence: [evidenceFor.prescription(current, ctx.patientId)] };
    }
    case "medications": {
      if (!ctx.medicationReconciliation) return { answer: "Not enough prescription history to compare medication changes yet.", evidence: [] };
      const changed = ctx.medicationReconciliation.rows.filter((row) => row.status !== "CONTINUED");
      const answer = changed.length
        ? changed
            .map((row) => `${row.name}: ${row.status.replace("_", " ").toLowerCase()}${row.previous ? ` (was ${row.previous})` : ""}${row.current ? `, now ${row.current}` : ""}`)
            .join("; ") + "."
        : "No medication changes between the last two prescriptions.";
      return {
        answer,
        evidence: [
          evidenceFor.prescription({ currentPrescriptionId: ctx.medicationReconciliation.currentPrescriptionId, currentDate: ctx.medicationReconciliation.currentDate }, ctx.patientId),
          evidenceFor.prescription({ currentPrescriptionId: ctx.medicationReconciliation.previousPrescriptionId, currentDate: ctx.medicationReconciliation.previousDate }, ctx.patientId),
        ],
      };
    }
    case "pending_actions": {
      const answer = ctx.attentionItems.length
        ? ctx.attentionItems.map((item) => `${item.what} ${item.why}`).join(" ")
        : "No pending clinical actions for this patient right now.";
      return { answer, evidence: [evidenceFor.patient(ctx.patientId)] };
    }
    case "reports": {
      const recent = ctx.reports.slice(0, 5);
      const answer = recent.length
        ? recent.map((r) => `${r.title} (${r.category}, ${fmtDate(r.reportDate)})${r.reviewedAt ? " \u2014 reviewed" : " \u2014 not yet reviewed"}`).join("; ") + "."
        : "No reports on file for this patient.";
      return { answer, evidence: recent.map((r) => evidenceFor.report(r, ctx.patientId)) };
    }
    case "follow_up": {
      if (ctx.followUp?.overdue) {
        return {
          answer: `Follow-up is overdue \u2014 it was recommended for ${fmtDate(ctx.followUp.overdue)} and no later visit is on file.`,
          evidence: [evidenceFor.patient(ctx.patientId)],
        };
      }
      if (ctx.followUp?.upcoming) {
        return { answer: `Follow-up recommended for ${fmtDate(ctx.followUp.upcoming)}.`, evidence: [evidenceFor.patient(ctx.patientId)] };
      }
      return { answer: "No follow-up currently recommended for this patient.", evidence: [] };
    }
    case "previous_visit": {
      if (!ctx.sinceLastVisit.available) return { answer: ctx.sinceLastVisit.reason, evidence: [] };
      return {
        answer: `The previous visit on file was ${fmtDate(ctx.sinceLastVisit.previousVisitDate)}, before the most recent visit on ${fmtDate(ctx.sinceLastVisit.currentVisitDate)}.`,
        evidence: [evidenceFor.appointment({ _id: ctx.previousAppointmentId, date: ctx.sinceLastVisit.previousVisitDate, patientId: ctx.patientId })].filter(Boolean),
      };
    }
    case "recent_events": {
      const recent = ctx.reports.slice(0, 3);
      const parts = [];
      if (ctx.lastVisit) parts.push(`last visit on ${fmtDate(ctx.lastVisit)}`);
      if (recent.length) parts.push(`${recent.length} recent report(s): ${recent.map((r) => r.title).join(", ")}`);
      if (ctx.medicationReconciliation?.rows.some((r) => r.status !== "CONTINUED")) parts.push("medication changes on the latest prescription");
      const answer = parts.length ? `Recent clinical activity: ${parts.join("; ")}.` : "No recent clinical events on file for this patient.";
      return { answer, evidence: recent.map((r) => evidenceFor.report(r, ctx.patientId)) };
    }
    default:
      return { answer: "I don't have this information in the available MediCore records.", evidence: [] };
  }
}

async function saveDraft({ promptKey, scope, createdBy, targetUserId, relatedEntity, content, generatedBy }) {
  return AIDraft.create({ promptKey, scope, createdBy, targetUserId, relatedEntity, content, generatedBy });
}

function respond({ content, generatedBy, disclaimer, draftId }) {
  return { content, generatedBy, disclaimer, draftId, isDraft: true };
}

export const generativeAssistant = {
  // ---------------------------------------------------------------- doctor
  async draftConsultationSummary({ appointmentId, doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const appointment = await Appointment.findOne({ _id: appointmentId, doctorId: doctor._id })
      .populate("patientId", "name")
      .lean();
    if (!appointment) throw new AppError("Appointment not found for this doctor", 404);

    const note = await MedicalNote.findOne({ appointmentId }).sort({ createdAt: -1 }).lean();

    const context = {
      patientName: appointment.patientId?.name,
      reason: appointment.reason,
      symptoms: appointment.symptoms,
      painLevel: appointment.painLevel,
      doctorNotes: note?.notes || "",
      recommendations: note?.recommendations || "",
      outcomeStatus: appointment.status,
    };

    const { content, generatedBy } = await generateText({ promptKey: "consultationSummary", context });
    const draft = await saveDraft({
      promptKey: "consultationSummary",
      scope: "doctor",
      createdBy: doctorUserId,
      targetUserId: appointment.patientId?._id,
      relatedEntity: { model: "Appointment", id: appointment._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft, draftId: draft._id });
  },

  async draftClinicalNote({ appointmentId, doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const appointment = await Appointment.findOne({ _id: appointmentId, doctorId: doctor._id })
      .populate("insuranceId", "provider")
      .lean();
    if (!appointment) throw new AppError("Appointment not found for this doctor", 404);

    const context = {
      reason: appointment.reason,
      symptoms: appointment.symptoms,
      painLevel: appointment.painLevel,
      allergies: appointment.allergies,
      medications: appointment.medications,
      insuranceProvider: appointment.insuranceId?.provider,
      reportCount: (appointment.reportIds || []).length,
    };

    const { content, generatedBy } = await generateText({ promptKey: "clinicalNoteDraft", context });
    const draft = await saveDraft({
      promptKey: "clinicalNoteDraft",
      scope: "doctor",
      createdBy: doctorUserId,
      targetUserId: appointment.patientId,
      relatedEntity: { model: "Appointment", id: appointment._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft, draftId: draft._id });
  },

  async patientClinicalBrief({ patientId, doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const appointments = await Appointment.find({ doctorId: doctor._id, patientId })
      .populate("insuranceId", "provider")
      .sort({ date: -1 })
      .lean();
    if (!appointments.length) throw new AppError("No visit history found for this patient with you", 404);

    const patientUser = await User.findById(patientId).select("name patientProfile").lean();

    const now = Date.now();
    const pastVisits = appointments.filter((a) => new Date(a.date).getTime() <= now && a.status !== "cancelled");
    const futureVisits = appointments.filter((a) => new Date(a.date).getTime() > now && a.status !== "cancelled");
    const lastVisit = pastVisits[0]?.date || null;
    const nextVisit = futureVisits.sort((a, b) => new Date(a.date) - new Date(b.date))[0]?.date || null;
    const insuranceProvider = appointments.find((a) => a.insuranceId)?.insuranceId?.provider || null;
    const outstandingAmount = appointments
      .filter((a) => a.paymentStatus && a.paymentStatus !== "paid")
      .length; // count only — exact ₹ amount would need a Payment populate not already loaded here

    const prescriptions = await Prescription.find({ doctorId: doctor._id, patientId })
      .select("followUpDate")
      .lean();
    const upcomingFollowUp = prescriptions
      .map((p) => p.followUpDate)
      .filter((d) => d && new Date(d).getTime() > now)
      .sort((a, b) => new Date(a) - new Date(b))[0] || null;

    const context = {
      patientName: patientUser?.name,
      appointmentCount: appointments.length,
      lastVisit,
      nextVisit,
      medicalConditions: patientUser?.patientProfile?.medicalConditions || [],
      allergies: patientUser?.patientProfile?.allergies?.length
        ? patientUser.patientProfile.allergies
        : appointments[0]?.allergies || [],
      medications: (patientUser?.patientProfile?.medications || []).map((m) => m.name),
      recentPrescriptionsCount: prescriptions.length,
      upcomingFollowUp,
      insuranceProvider,
      outstandingAmount: outstandingAmount > 0 ? outstandingAmount : 0,
    };

    const { content, generatedBy } = await generateText({ promptKey: "patientClinicalBrief", context });
    const draft = await saveDraft({
      promptKey: "patientClinicalBrief",
      scope: "doctor",
      createdBy: doctorUserId,
      targetUserId: patientId,
      relatedEntity: { model: "User", id: patientId },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft, draftId: draft._id });
  },

  // PHASE P6 — AI Clinical Copilot. Read-only grounded Q&A, not a draft:
  // nothing here is ever inserted into a clinical record, so it
  // deliberately skips the generateText/saveDraft draft-review pipeline
  // (§17 only applies to content that could become part of documentation).
  // Ownership: same doctor-treated-this-patient guard as every other
  // patient-scoped doctor endpoint (ensureDoctorTreatedPatient equivalent).
  async clinicalCopilotAnswer({ patientId, doctorUserId, question }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const treated = await Appointment.exists({ doctorId: doctor._id, patientId });
    if (!treated) throw new AppError("You can only ask about a patient you have an appointment history with", 403);

    const [patientUser, appointments, prescriptions, notes, reports, certificates] = await Promise.all([
      User.findById(patientId).select("name patientProfile").lean(),
      Appointment.find({ doctorId: doctor._id, patientId }).sort({ date: -1 }).limit(50).lean(),
      Prescription.find({ doctorId: doctor._id, patientId }).sort({ createdAt: -1 }).limit(20).lean(),
      MedicalNote.find({ doctorId: doctor._id, patientId }).sort({ createdAt: -1 }).limit(20).lean(),
      MedicalReport.find({ userId: patientId }).sort({ reportDate: -1 }).limit(20).lean(),
      Certificate.find({ doctorId: doctor._id, patientId, status: "issued" }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    if (!patientUser) throw new AppError("Patient not found", 404);

    const now = Date.now();
    const nonCancelled = appointments.filter((a) => a.status !== "cancelled").sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastVisit = nonCancelled.find((a) => new Date(a.date).getTime() <= now)?.date || null;
    const followUp = resolveFollowUpState({
      followUpDates: prescriptions.filter((p) => !p.followUpScheduledAppointmentId).map((p) => p.followUpDate),
      lastVisit,
      now,
    });
    const allergies = [...new Set([...(patientUser.patientProfile?.allergies || []), ...appointments.flatMap((a) => a.allergies || [])])];
    const unreviewedReports = reports.filter((r) => !r.reviewedAt).length;
    const attentionItems = computeDoctorPatientAttentionItems({
      followUp,
      nextVisit: nonCancelled.find((a) => new Date(a.date).getTime() > now)?.date || null,
      allergies,
      insurance: null,
      outstandingAmount: 0,
      unreadMessages: 0,
      unreviewedReports,
    });
    const sinceLastVisit = buildSinceLastVisitComparison({ appointments, prescriptions, reports, certificates, followUp });
    const medicationReconciliation = buildMedicationReconciliation(prescriptions);

    const key = resolveCopilotQuestionKey(question);
    const { answer, evidence } = buildCopilotAnswer(key, {
      patientId,
      patientName: patientUser.name,
      appointmentCount: appointments.length,
      lastVisit,
      prescriptionCount: prescriptions.length,
      prescriptions,
      followUp,
      noteCount: notes.length,
      reports,
      attentionItems,
      sinceLastVisit,
      medicationReconciliation,
      currentAppointmentId: nonCancelled[0]?._id || null,
      previousAppointmentId: nonCancelled[1]?._id || null,
    });

    return {
      content: { answer, evidence },
      generatedBy: "template",
      disclaimer: DISCLAIMERS.doctorDraft,
      quickQuestions: COPILOT_QUICK_QUESTIONS,
      isDraft: false,
    };
  },

  // AI Consultation Assistant (Phase D5, Step 3): a single grounded, non-diagnostic
  // pre-charting aid for an in-progress consultation. Reuses the same real
  // visit-intake fields as draftClinicalNote/patientClinicalBrief plus this
  // doctor's own prior prescription history for the patient — no new data
  // source, no chatbot, just a new prompt over data already on file.
  async consultationAssistant({ appointmentId, doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const appointment = await Appointment.findOne({ _id: appointmentId, doctorId: doctor._id }).lean();
    if (!appointment) throw new AppError("Appointment not found for this doctor", 404);

    const [priorPrescriptions, patientUser, reportCount, linkedPrescription] = await Promise.all([
      Prescription.find({ doctorId: doctor._id, patientId: appointment.patientId, appointmentId: { $ne: appointment._id } })
        .select("diagnosis medicines")
        .sort({ createdAt: -1 })
        .lean(),
      User.findById(appointment.patientId).select("patientProfile").lean(),
      MedicalReport.countDocuments({ userId: appointment.patientId }),
      Prescription.findOne({ appointmentId: appointment._id }).select("medicines").lean(),
    ]);

    const allergies = patientUser?.patientProfile?.allergies?.length
      ? patientUser.patientProfile.allergies
      : appointment.allergies || [];

    let safetyWarningCount = 0;
    if (linkedPrescription?.medicines?.length) {
      const { checkAllergyConflicts } = await import("../utils/prescriptionSafety.js");
      safetyWarningCount = checkAllergyConflicts(linkedPrescription.medicines, allergies).length;
    }

    const context = {
      reason: appointment.reason,
      symptoms: appointment.symptoms,
      painLevel: appointment.painLevel,
      allergies,
      medications: (patientUser?.patientProfile?.medications || []).map((m) => m.name),
      medicalConditions: patientUser?.patientProfile?.medicalConditions || [],
      reportCount,
      priorVisitCount: priorPrescriptions.length,
      priorDiagnoses: [...new Set(priorPrescriptions.map((p) => p.diagnosis).filter(Boolean))],
      safetyWarningCount,
    };

    const { content, generatedBy } = await generateText({ promptKey: "consultationAssistant", context });
    const draft = await saveDraft({
      promptKey: "consultationAssistant",
      scope: "doctor",
      createdBy: doctorUserId,
      targetUserId: appointment.patientId,
      relatedEntity: { model: "Appointment", id: appointment._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft, draftId: draft._id });
  },

  // Patient-facing, plain-language explanation of a saved prescription — a
  // communication draft the doctor reviews and shares explicitly, reusing the
  // same Prescription fields as prescriptionFollowUpSuggestion.
  async patientEducationSummary({ prescriptionId, doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const prescription = await Prescription.findOne({ _id: prescriptionId, doctorId: doctor._id }).lean();
    if (!prescription) throw new AppError("Prescription not found", 404);

    const context = {
      diagnosis: prescription.diagnosis,
      medicines: prescription.medicines,
      followUpDate: prescription.followUpDate,
    };

    const { content, generatedBy } = await generateText({ promptKey: "patientEducationSummary", context });
    const draft = await saveDraft({
      promptKey: "patientEducationSummary",
      scope: "doctor",
      createdBy: doctorUserId,
      targetUserId: prescription.patientId,
      relatedEntity: { model: "Prescription", id: prescription._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.communication, draftId: draft._id });
  },

  // Follow-up window suggestion for a just-created (or existing) prescription.
  // Purely a scheduling aid — the doctor still sets the real follow-up date.
  async prescriptionFollowUpSuggestion({ prescriptionId, doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const prescription = await Prescription.findOne({ _id: prescriptionId, doctorId: doctor._id }).lean();
    if (!prescription) throw new AppError("Prescription not found", 404);

    const visitCount = await Appointment.countDocuments({ doctorId: doctor._id, patientId: prescription.patientId });

    const durationDays = (prescription.medicines || [])
      .map((m) => {
        const match = /(\d+)\s*(day|days|week|weeks|month|months)/i.exec(m.duration || "");
        if (!match) return 0;
        const value = Number(match[1]);
        const unit = match[2].toLowerCase();
        if (unit.startsWith("week")) return value * 7;
        if (unit.startsWith("month")) return value * 30;
        return value;
      })
      .reduce((max, days) => Math.max(max, days), 0);

    const context = {
      diagnosis: prescription.diagnosis,
      medicines: (prescription.medicines || []).map((m) => m.name),
      longestDurationDays: durationDays || null,
      visitCount,
    };

    const { content, generatedBy } = await generateText({ promptKey: "prescriptionFollowUpSuggestion", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // Reuses each day's real booked-appointment count vs the doctor's own
  // configured slot capacity for that weekday — never a fabricated figure.
  async scheduleOptimization({ doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingAppointments = await Appointment.find({
      doctorId: doctor._id,
      date: { $gte: now, $lte: weekFromNow },
      status: { $ne: "cancelled" },
    })
      .select("date")
      .lean();

    const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const bookedByWeekday = upcomingAppointments.reduce((acc, appointment) => {
      const dayName = weekdayNames[new Date(appointment.date).getDay()];
      acc[dayName] = (acc[dayName] || 0) + 1;
      return acc;
    }, {});

    const dayUtilization = (doctor.availability || []).map((slot) => ({
      label: slot.dayOfWeek ? slot.dayOfWeek[0].toUpperCase() + slot.dayOfWeek.slice(1) : "Unknown day",
      booked: bookedByWeekday[slot.dayOfWeek] || 0,
      capacity: Array.isArray(slot.timeSlots) ? slot.timeSlots.length : 0,
    }));

    const upcomingLeaveDays = await LeaveRequest.countDocuments({
      doctorId: doctor._id,
      status: "approved",
      endDate: { $gte: now },
      startDate: { $lte: weekFromNow },
    });

    const context = { dayUtilization, upcomingLeaveDays };
    const { content, generatedBy } = await generateText({ promptKey: "scheduleOptimization", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  async documentCenterSuggestions({ doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const documents = doctor.documents || [];
    const expiringCount = documents.filter((d) => d.expiryDate && d.expiryDate <= soon && d.expiryDate >= now).length;
    const expiredCount = documents.filter((d) => d.expiryDate && d.expiryDate < now).length;
    const pendingVerificationCount = documents.filter((d) => d.status === "pending").length;
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentCertificates = await Certificate.countDocuments({ doctorId: doctor._id, createdAt: { $gte: monthAgo } });

    const context = { expiringCount, expiredCount, pendingVerificationCount, recentCertificates };
    const { content, generatedBy } = await generateText({ promptKey: "documentCenterSuggestions", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // --------------------------------------------------------------- patient
  async explainPrescription({ prescriptionId, patientUserId }) {
    const prescription = await Prescription.findOne({ _id: prescriptionId, patientId: patientUserId }).lean();
    if (!prescription) throw new AppError("Prescription not found", 404);

    const context = {
      diagnosis: prescription.diagnosis,
      medicines: prescription.medicines,
      followUpDate: prescription.followUpDate,
    };

    const { content, generatedBy } = await generateText({ promptKey: "prescriptionExplain", context });
    const draft = await saveDraft({
      promptKey: "prescriptionExplain",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "Prescription", id: prescription._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  async summarizeDocument({ reportId, patientUserId }) {
    const report = await MedicalReport.findOne({ _id: reportId, userId: patientUserId }).lean();
    if (!report) throw new AppError("Report not found", 404);

    const missingFields = [];
    if (!report.notes) missingFields.push("notes");
    if (!report.category) missingFields.push("category");
    if (!report.tags?.length) missingFields.push("tags");

    const context = {
      title: report.title,
      category: report.category,
      reportDate: report.reportDate,
      notes: report.notes,
      missingFields,
    };

    const { content, generatedBy } = await generateText({ promptKey: "documentSummary", context });
    const draft = await saveDraft({
      promptKey: "documentSummary",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "MedicalReport", id: report._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  async appointmentPrepChecklist({ appointmentId, patientUserId }) {
    const appointment = await Appointment.findOne({ _id: appointmentId, patientId: patientUserId })
      .populate({ path: "doctorId", populate: { path: "userId", select: "name" } })
      .lean();
    if (!appointment) throw new AppError("Appointment not found", 404);

    const context = {
      doctorName: appointment.doctorId?.userId?.name,
      specialization: appointment.doctorId?.specialization,
      date: appointment.date,
      timeSlot: appointment.timeSlot,
      reason: appointment.reason,
      reportCount: (appointment.reportIds || []).length,
    };

    const { content, generatedBy } = await generateText({ promptKey: "appointmentPrep", context });
    const draft = await saveDraft({
      promptKey: "appointmentPrep",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "Appointment", id: appointment._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  // ------------------------------------------------------ patient finance
  async explainPayment({ paymentId, patientUserId }) {
    const payment = await Payment.findOne({ _id: paymentId, userId: patientUserId })
      .populate({ path: "doctorId", populate: { path: "userId", select: "name" } })
      .lean();
    if (!payment) throw new AppError("Payment not found", 404);

    const context = {
      totalAmount: payment.totalAmount,
      currency: payment.currency,
      gatewayAmount: payment.gatewayAmount,
      walletAmount: payment.walletAmount,
      discountAmount: payment.discountAmount,
      taxAmount: payment.taxAmount,
      status: payment.status,
      doctorName: payment.doctorId?.userId?.name,
      createdAt: payment.createdAt,
    };

    const { content, generatedBy } = await generateText({ promptKey: "paymentExplain", context });
    const draft = await saveDraft({
      promptKey: "paymentExplain",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "Payment", id: payment._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  async explainInvoice({ invoiceId, patientUserId }) {
    const invoice = await Invoice.findOne({ _id: invoiceId, userId: patientUserId }).lean();
    if (!invoice) throw new AppError("Invoice not found", 404);
    const payment = await Payment.findById(invoice.paymentId).select("refundStatus").lean();

    const context = {
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      taxAmount: invoice.taxAmount,
      currency: invoice.currency,
      lineItems: invoice.lineItems,
      issuedAt: invoice.issuedAt,
      documentType: payment?.refundStatus === "full" ? "refund_receipt" : payment?.refundStatus === "partial" ? "partial_refund_receipt" : "tax_invoice",
    };

    const { content, generatedBy } = await generateText({ promptKey: "invoiceExplain", context });
    const draft = await saveDraft({
      promptKey: "invoiceExplain",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "Invoice", id: invoice._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  async explainRefund({ refundRequestId, patientUserId }) {
    const refundRequest = await RefundRequest.findOne({ _id: refundRequestId, requestedBy: patientUserId }).lean();
    if (!refundRequest) throw new AppError("Refund request not found", 404);

    const context = {
      amount: refundRequest.amount,
      currency: "INR",
      reason: refundRequest.reason,
      status: refundRequest.status,
      timeline: refundRequest.timeline,
    };

    const { content, generatedBy } = await generateText({ promptKey: "refundAssistant", context });
    const draft = await saveDraft({
      promptKey: "refundAssistant",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "RefundRequest", id: refundRequest._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  // reused by the Payment Center's "AI expense summary" panel — the caller
  // supplies the already-computed getPaymentAnalytics aggregates so this
  // never re-derives or fabricates a figure of its own.
  async expenseSummary(analyticsData) {
    const { content, generatedBy } = await generateText({ promptKey: "expenseSummary", context: analyticsData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient });
  },

  // -------------------------------------------------- health ecosystem
  async familyHealthInsights({ patientUserId }) {
    const familyMembers = await FamilyMember.find({ userId: patientUserId, isActive: true }).lean();
    const members = await Promise.all(
      familyMembers.map(async (member) => {
        const [upcoming, reportCount, insuranceCount] = await Promise.all([
          Appointment.findOne({ familyMemberId: member._id, status: { $in: ACTIVE_STATUSES }, date: { $gte: new Date() } }).sort({ date: 1 }).select("date").lean(),
          MedicalReport.countDocuments({ familyMemberId: member._id }),
          Insurance.countDocuments({ familyMemberId: member._id }),
        ]);
        return { name: member.name, relation: member.relation, upcomingAppointment: upcoming?.date, reportCount, insuranceCount };
      }),
    );

    const { content, generatedBy } = await generateText({ promptKey: "familyHealthInsights", context: { members } });
    const draft = await saveDraft({
      promptKey: "familyHealthInsights",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "FamilyMember", id: null },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  async explainInsurance({ insuranceId, patientUserId }) {
    const policy = await Insurance.findOne({ _id: insuranceId, userId: patientUserId }).populate("familyMemberId", "name").lean();
    if (!policy) throw new AppError("Insurance policy not found", 404);

    const context = {
      provider: policy.provider,
      coverageAmount: policy.coverageAmount,
      validTill: policy.validTill,
      claimStatus: policy.claimStatus,
      familyMemberName: policy.familyMemberId?.name,
    };

    const { content, generatedBy } = await generateText({ promptKey: "insuranceExplain", context });
    const draft = await saveDraft({
      promptKey: "insuranceExplain",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "Insurance", id: policy._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  // Reuses the same linked-appointment utilization helper the Insurance
  // Center's utilization panel calls, so the AI narrative never diverges
  // from what the patient sees on screen.
  async insuranceEligibilitySummary({ insuranceId, patientUserId }) {
    const policy = await Insurance.findOne({ _id: insuranceId, userId: patientUserId }).lean();
    if (!policy) throw new AppError("Insurance policy not found", 404);
    const utilization = await buildInsuranceUtilization(policy, patientUserId);

    const context = {
      coverageAmount: policy.coverageAmount,
      utilizedAmount: utilization.utilizedAmount,
      remainingAmount: utilization.remainingAmount,
      claimStatus: policy.claimStatus,
    };

    const { content, generatedBy } = await generateText({ promptKey: "insuranceEligibilitySummary", context });
    const draft = await saveDraft({
      promptKey: "insuranceEligibilitySummary",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "Insurance", id: policy._id },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  // Reuses the exact healthScore/breakdown/bmi the Health Profile page
  // already computed (buildHealthScore/computeBMI in patientWorkflowController)
  // so the AI narrative can never diverge from what's on screen.
  async healthProfileReview({ patientUserId, healthScore, breakdown, bmi }) {
    const context = { healthScore, breakdown, bmi };
    const { content, generatedBy } = await generateText({ promptKey: "healthProfileReview", context });
    const draft = await saveDraft({
      promptKey: "healthProfileReview",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "User", id: patientUserId },
      content,
      generatedBy,
    });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  // Reuses the exact timeline/milestones/nextAction the Health Journey page
  // already computed (buildPatientTimeline in patientWorkflowController).
  async healthJourneySummary({ patientUserId, timeline, milestones, nextAction }) {
    const context = { timeline, milestones, nextAction };
    const { content, generatedBy } = await generateText({ promptKey: "healthJourneySummary", context });
    const draft = await saveDraft({
      promptKey: "healthJourneySummary",
      scope: "patient",
      createdBy: patientUserId,
      targetUserId: patientUserId,
      relatedEntity: { model: "User", id: patientUserId },
      content,
      generatedBy,
    });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.patient, draftId: draft._id });
  },

  // --------------------------------------------------------------- shared
  async draftCommunication({ type, context, actorId, scope }) {
    const { content, generatedBy } = await generateText({ promptKey: "communicationDraft", context: { ...context, type } });
    const draft = await saveDraft({
      promptKey: "communicationDraft",
      scope: scope || "shared",
      createdBy: actorId,
      targetUserId: context.targetUserId,
      relatedEntity: context.relatedEntity,
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.communication, draftId: draft._id });
  },

  // PHASE UI-4 — Patients Management Workspace. Admin-facing, strictly
  // operational summary built ONLY from the same real aggregate/attention
  // data the Patient 360 workspace itself displays (see
  // patientAdminAggregationService.js) — no new data source, no chatbot,
  // never a diagnosis. The controller passes the already-computed
  // aggregate/attentionItems/riskLevel in; this function does not query
  // the database itself, so it can never drift from what the admin sees
  // on screen.
  async patientOperationalSummary({ patientId, adminUserId, context }) {
    const patient = await User.findById(patientId).select("name").lean();
    if (!patient) throw new AppError("Patient not found", 404);

    const { content, generatedBy } = await generateText({
      promptKey: "patientOperationalSummary",
      context: { patientName: patient.name, ...context },
    });

    const draft = await saveDraft({
      promptKey: "patientOperationalSummary",
      scope: "admin",
      createdBy: adminUserId,
      targetUserId: patientId,
      relatedEntity: { model: "User", id: patientId },
      content,
      generatedBy,
    });

    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin, draftId: draft._id });
  },

  async reviewSentiment({ doctorId }) {
    const filter = doctorId ? { doctorId, adminDeleted: { $ne: true } } : { adminDeleted: { $ne: true } };
    const reviews = await Review.find(filter).select("rating comment").limit(500).lean();

    const { content, generatedBy } = await generateText({ promptKey: "reviewSentiment", context: { reviews } });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Review Intelligence Center: same reviewSentiment logic as the admin
  // capability above, but ownership-enforced to the calling doctor's own
  // profile so a doctor can never pass another doctor's id.
  async doctorReviewSummary({ doctorUserId }) {
    const doctor = await Doctor.findOne({ userId: doctorUserId }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);

    const reviews = await Review.find({ doctorId: doctor._id, adminDeleted: { $ne: true } })
      .select("rating comment")
      .limit(500)
      .lean();

    const { content, generatedBy } = await generateText({ promptKey: "reviewSentiment", context: { reviews } });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // Revenue Intelligence Center: AI Revenue Insights, grounded in the real
  // revenue breakdown already computed by buildDoctorRevenueIntelligence.
  async revenueInsights(revenueData) {
    const { content, generatedBy } = await generateText({ promptKey: "revenueInsights", context: revenueData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // Reputation Intelligence Center: AI Reputation Advisor, grounded in the
  // real reputation metrics already computed by buildDoctorReputationIntelligence.
  async reputationAdvisor(reputationData) {
    const { content, generatedBy } = await generateText({ promptKey: "reputationAdvisor", context: reputationData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // AI Business Advisor: grounded in the real composed Business Overview
  // snapshot (revenue + rating + growth + retention + appointments).
  async businessAdvisor(businessOverviewData) {
    const { content, generatedBy } = await generateText({ promptKey: "businessAdvisor", context: businessOverviewData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // Practice Management Platform (Phase D4): all five grounded in the real
  // builders in controllers/doctor/practiceController.js -- never a
  // separate, potentially-diverging computation.
  async profileReview(profileIntelligenceData) {
    const { content, generatedBy } = await generateText({ promptKey: "profileReview", context: profileIntelligenceData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  async verificationAdvisor(verificationCenterData) {
    const { content, generatedBy } = await generateText({ promptKey: "verificationAdvisor", context: verificationCenterData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  async subscriptionAdvisor(subscriptionIntelligenceData) {
    const { content, generatedBy } = await generateText({ promptKey: "subscriptionAdvisor", context: subscriptionIntelligenceData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  async growthAdvisor(practiceAnalyticsData) {
    const { content, generatedBy } = await generateText({ promptKey: "growthAdvisor", context: practiceAnalyticsData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  async missingFieldsAdvisor(profileIntelligenceData) {
    const { content, generatedBy } = await generateText({ promptKey: "missingFieldsAdvisor", context: profileIntelligenceData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.doctorDraft });
  },

  // ------------------------------------------------------------- approval
  async approveDraft({ draftId, userId, editedContent }) {
    const draft = await AIDraft.findById(draftId);
    if (!draft) throw new AppError("Draft not found", 404);
    if (String(draft.createdBy) !== String(userId)) throw new AppError("Not authorized to approve this draft", 403);

    if (editedContent !== undefined) {
      draft.content = editedContent;
      draft.edited = true;
    }
    draft.status = "approved";
    draft.approvedAt = new Date();
    draft.approvedBy = userId;
    await draft.save();

    return draft;
  },

  async listDrafts({ userId, promptKey, limit = 20 }) {
    const filter = { createdBy: userId };
    if (promptKey) filter.promptKey = promptKey;
    return AIDraft.find(filter).sort({ createdAt: -1 }).limit(Number(limit)).lean();
  },

  // reused by admin executive brief + workflow suggestions endpoints
  // Executive Action Center: AI Explain Everything. Grounded only in the
  // real metric value + breakdown/threshold the caller supplies (which the
  // controller itself always re-fetches server-side, never trusting a
  // client-provided number).
  async metricExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "metricExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.1 — Unified Operations Queue. Grounded only in the real
  // operation item fields the controller re-fetches server-side; no client-
  // supplied field is trusted for the summary itself.
  async operationSummary(context) {
    const { content, generatedBy } = await generateText({ promptKey: "operationSummary", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.2.1 — Enterprise Workflow Automation Core. Grounded only in the
  // real registry definition + item state the controller re-fetches
  // server-side; distinct from operationSummary (a per-item operational
  // summary) in that this explains the engine's own policy/lifecycle
  // reasoning for that item.
  async workflowExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "workflowExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.2.2 — Smart Assignment Engine (Step 12). 5 new capabilities via
  // this same pipeline. Every one is grounded only in real data the caller
  // (assignmentAdminController.js) already computed server-side via the
  // assignment/* modules — never a fresh/independent fetch, so the AI
  // narrative can never diverge from the score/workload numbers shown on
  // screen.
  async assignmentRecommendation(context) {
    const { content, generatedBy } = await generateText({ promptKey: "assignmentRecommendation", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async workloadAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "workloadAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async reassignmentAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "reassignmentAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async slaAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "slaAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async assignmentExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "assignmentExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.2.3 — Enterprise Automation Studio. Grounded only in the real
  // flow definition (+ real stats / trigger payload) the controller
  // re-fetches server-side — see automationStudioController.js and
  // actionExecutor.js#runAiInsight.
  async automationFlowExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "automationFlowExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async automationFlowAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "automationFlowAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.2.4 — Enterprise Monitoring Platform. All five grounded only
  // in real, server-refetched data — see monitoringController.js.
  async executionExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "executionExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async failureExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "failureExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async performanceAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "performanceAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async workflowHealthAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "workflowHealthAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async retryAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "retryAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async executiveBrief(platformOverviewData) {
    const { content, generatedBy } = await generateText({ promptKey: "executiveBrief", context: platformOverviewData });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // PHASE UI-9 — Executive Admin Command Center. Fed only the already-
  // composed commandCenterAggregates.js output (never a fresh/independent
  // fetch) — see that file's header for the full audit note on why this
  // is a new capability rather than a reuse of executiveBrief.
  async commandCenterExecutiveSummary(context) {
    const { content, generatedBy } = await generateText({ promptKey: "commandCenterExecutiveSummary", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async workflowSuggestions(counts) {
    const { content, generatedBy } = await generateText({ promptKey: "workflowSuggestions", context: counts });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
  // Every one of these 6 capabilities is grounded only in the real object
  // the caller (intelligenceAdminController.js) already computed
  // server-side via predictionEngine/anomalyDetector/capacityForecast/
  // optimizationEngine/selfHealingEngine — never a fresh/independent fetch.
  async predictionExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "predictionExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async anomalyExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "anomalyExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async capacityAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "capacityAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async optimizationAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "optimizationAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async selfHealingAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "selfHealingAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async platformIntelligenceSummary(context) {
    const { content, generatedBy } = await generateText({ promptKey: "platformIntelligenceSummary", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // ── Phase A6.3.1/A6.3.2 — Enterprise Process Registry & Orchestration
  // Core + Cross-System Integration Hub. See promptLibrary.js's own note on
  // why the brief's 8 asks are covered by these 4 prompts.
  async processExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async integrationExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "integrationExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async orchestrationAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "orchestrationAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async impactAnalysis(context) {
    const { content, generatedBy } = await generateText({ promptKey: "impactAnalysis", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.3.3 — Enterprise Process Designer. Grounded only in the real
  // definition / real simulation run the controller re-fetches
  // server-side — see processDesignerController.js.
  async processDesignExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processDesignExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async processSimulationExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processSimulationExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.3.4 — Process Analytics & Optimization Intelligence. Every
  // context object below is re-fetched server-side by
  // processAnalyticsController.js from process-analytics builders —
  // never trusted from the client, same discipline as A5.3's metricExplain.
  async processAnalyticsExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processAnalyticsExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async processBottleneckExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processBottleneckExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async processOptimizationAdvisor(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processOptimizationAdvisor", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async processVersionComparisonExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "processVersionComparisonExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // Phase A6.3.5 — Process Governance. Every context object is re-fetched
  // server-side by processGovernanceController.js from
  // process-governance/processGovernanceEngine.js — AI never decides
  // approval (Section 16), only explains the real deterministic result.
  async governanceExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "governanceExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async approvalRiskExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "approvalRiskExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async complianceSummary(context) {
    const { content, generatedBy } = await generateText({ promptKey: "complianceSummary", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  async changeImpactExplain(context) {
    const { content, generatedBy } = await generateText({ promptKey: "changeImpactExplain", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },

  // PHASE UI-7 — Finance Executive Command Center. Advisory only; the
  // full context (overview/health/attention) is always re-fetched
  // server-side by financeAdminController.js from
  // financeAggregates.js — AI never decides a financial action, only
  // explains the real aggregates it is given.
  async financeExecutiveSummary(context) {
    const { content, generatedBy } = await generateText({ promptKey: "financeExecutiveSummary", context });
    return respond({ content, generatedBy, disclaimer: DISCLAIMERS.admin });
  },
};

export async function pendingRefundCount() {
  return RefundRequest.countDocuments({ status: "pending" });
}

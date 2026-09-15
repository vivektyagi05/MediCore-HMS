import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import Insurance from "../models/Insurance.js";
import MedicalReport from "../models/MedicalReport.js";
import Prescription from "../models/Prescription.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";
import { ACTIVE_STATUSES } from "../constants/appointmentStatus.js";
import { generativeAssistant } from "../ai/generativeAssistant.js";
import { parseNaturalLanguageQuery } from "../ai/nlSearchParser.js";
import { buildPlatformOverviewData } from "./admin/overviewAdminController.js";
import { buildPaymentAnalyticsData } from "./paymentController.js";
import { buildHealthScore, buildPatientTimelineData, computeBMI } from "./patient/patientWorkflowController.js";
import { buildDoctorRevenueIntelligence } from "./doctor/doctorEarningsController.js";
import { buildDoctorAnalyticsIntelligence } from "./doctor/workflowController.js";
import { buildDoctorReputationIntelligence } from "./publicController.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";
import { buildPatientAggregates, computeAttentionItems, computePatientRiskLevel } from "../services/patientAdminAggregationService.js";
import { userHasPermission } from "../middleware/adminMiddleware.js";
import {
  buildProfileIntelligence,
  buildVerificationCenter,
  buildSubscriptionIntelligence,
  buildPracticeAnalytics,
} from "./doctor/practiceController.js";

// ------------------------------------------------------------------ doctor
export const draftConsultationSummary = asyncHandler(async (req, res) => {
  const { appointmentId } = req.body;
  if (!appointmentId) throw new AppError("appointmentId is required", 400);

  const result = await generativeAssistant.draftConsultationSummary({ appointmentId, doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Consultation summary draft generated" });
});

export const draftClinicalNote = asyncHandler(async (req, res) => {
  const { appointmentId } = req.body;
  if (!appointmentId) throw new AppError("appointmentId is required", 400);

  const result = await generativeAssistant.draftClinicalNote({ appointmentId, doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Clinical note draft generated" });
});

export const getPatientClinicalBrief = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const result = await generativeAssistant.patientClinicalBrief({ patientId, doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Patient clinical brief generated" });
});

// PHASE P6 — AI Clinical Copilot
export const getClinicalCopilotAnswer = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { question } = req.body;
  if (!question?.trim()) throw new AppError("A question is required", 400);
  const result = await generativeAssistant.clinicalCopilotAnswer({ patientId, doctorUserId: req.user._id, question: question.trim() });
  res.status(200).json({ success: true, data: result, message: "Copilot response generated" });
});

export const getPrescriptionFollowUpSuggestion = asyncHandler(async (req, res) => {
  const { prescriptionId } = req.params;
  const result = await generativeAssistant.prescriptionFollowUpSuggestion({ prescriptionId, doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Follow-up suggestion generated" });
});

export const getScheduleOptimization = asyncHandler(async (req, res) => {
  const result = await generativeAssistant.scheduleOptimization({ doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Schedule optimization suggestions generated" });
});

// Phase D5: AI Consultation Assistant
export const getConsultationAssistant = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;
  const result = await generativeAssistant.consultationAssistant({ appointmentId, doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Consultation assistant suggestions generated" });
});

export const getPatientEducationSummary = asyncHandler(async (req, res) => {
  const { prescriptionId } = req.params;
  const result = await generativeAssistant.patientEducationSummary({ prescriptionId, doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Patient education summary generated" });
});

export const getDocumentCenterSuggestions = asyncHandler(async (req, res) => {
  const result = await generativeAssistant.documentCenterSuggestions({ doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Document center suggestions generated" });
});

// ── Phase D3: Doctor Business Intelligence Platform ──
// All four reuse the same doctor-scoped, single-source-of-truth builders
// that power the Reviews/Earnings/Analytics/Reputation pages themselves,
// so the AI narrative can never diverge from what's shown on screen.
export const getDoctorReviewSummary = asyncHandler(async (req, res) => {
  const result = await generativeAssistant.doctorReviewSummary({ doctorUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Review summary generated" });
});

export const getRevenueInsights = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const revenueData = await buildDoctorRevenueIntelligence(doctor._id);
  const result = await generativeAssistant.revenueInsights(revenueData);
  res.status(200).json({ success: true, data: result, message: "Revenue insights generated" });
});

export const getReputationAdvisor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const reputationData = await buildDoctorReputationIntelligence(doctor._id);
  const result = await generativeAssistant.reputationAdvisor({ ...reputationData.overview, ...reputationData.intelligence });
  res.status(200).json({ success: true, data: result, message: "Reputation advisor insights generated" });
});

export const getBusinessAdvisor = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const [analytics, revenue, reputation] = await Promise.all([
    buildDoctorAnalyticsIntelligence(doctor),
    buildDoctorRevenueIntelligence(doctor._id),
    buildDoctorReputationIntelligence(doctor._id),
  ]);
  const revenueHealth = Math.max(0, Math.min(100, 50 + (analytics.growthForecast || 0)));
  const businessScore = Number(
    Math.max(
      0,
      Math.min(
        100,
        (reputation.intelligence.businessReputationScore || 0) * 0.35 +
          revenueHealth * 0.25 +
          (reputation.intelligence.repeatPatientRate || 0) * 0.2 +
          (analytics.approvalRate * 100 || 0) * 0.2,
      ),
    ).toFixed(1),
  );
  const businessOverviewData = {
    businessScore,
    revenue: { monthly: revenue.monthlyEarnings, forecast: analytics.revenueForecast },
    rating: { average: reputation.overview.rating, totalReviews: reputation.overview.totalReviews, satisfactionRate: reputation.overview.satisfactionRate },
    growth: { newPatientsThisMonth: analytics.patientFunnel.newPatients, growthForecast: analytics.growthForecast },
    retention: { repeatPatientRate: reputation.intelligence.repeatPatientRate },
    appointments: { cancelled: analytics.appointmentFunnel.cancelled },
    refundRate: revenue.totalEarnings ? Number(((revenue.totalRefunded / (revenue.totalEarnings + revenue.totalRefunded || 1)) * 100).toFixed(1)) : 0,
  };
  const result = await generativeAssistant.businessAdvisor(businessOverviewData);
  res.status(200).json({ success: true, data: result, message: "Business advisor insights generated" });
});

// ── Practice Management Platform (Phase D4) ──
// All five reuse the exact same builders that power the Practice Management
// Platform pages themselves, so the AI narrative can never diverge from
// what's shown on screen.
export const getProfileReview = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const profileIntelligenceData = await buildProfileIntelligence(doctor.toObject ? doctor.toObject() : doctor);
  const result = await generativeAssistant.profileReview(profileIntelligenceData);
  res.status(200).json({ success: true, data: result, message: "Profile review generated" });
});

export const getVerificationAdvisor = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const verificationCenterData = buildVerificationCenter(doctor.toObject ? doctor.toObject() : doctor);
  const result = await generativeAssistant.verificationAdvisor(verificationCenterData);
  res.status(200).json({ success: true, data: result, message: "Verification advisor insights generated" });
});

export const getSubscriptionAdvisor = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const subscriptionIntelligenceData = await buildSubscriptionIntelligence(doctor.toObject ? doctor.toObject() : doctor, req.user._id);
  const result = await generativeAssistant.subscriptionAdvisor(subscriptionIntelligenceData);
  res.status(200).json({ success: true, data: result, message: "Subscription advisor insights generated" });
});

export const getGrowthAdvisor = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const practiceAnalyticsData = await buildPracticeAnalytics(doctor.toObject ? doctor.toObject() : doctor);
  const result = await generativeAssistant.growthAdvisor(practiceAnalyticsData);
  res.status(200).json({ success: true, data: result, message: "Growth advisor insights generated" });
});

export const getMissingFieldsAdvisor = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  const profileIntelligenceData = await buildProfileIntelligence(doctor.toObject ? doctor.toObject() : doctor);
  const result = await generativeAssistant.missingFieldsAdvisor(profileIntelligenceData);
  res.status(200).json({ success: true, data: result, message: "Missing fields checklist generated" });
});

// ------------------------------------------------------------------ patient
export const explainPrescription = asyncHandler(async (req, res) => {
  const { prescriptionId } = req.params;
  const result = await generativeAssistant.explainPrescription({ prescriptionId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Prescription explained in plain language" });
});

export const summarizeDocument = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const result = await generativeAssistant.summarizeDocument({ reportId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Document summarized" });
});

export const appointmentPrepChecklist = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;
  const result = await generativeAssistant.appointmentPrepChecklist({ appointmentId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Appointment preparation checklist generated" });
});

// ------------------------------------------------------------ patient finance
export const explainPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const result = await generativeAssistant.explainPayment({ paymentId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Payment explained in plain language" });
});

export const explainInvoice = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  const result = await generativeAssistant.explainInvoice({ invoiceId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Invoice explained in plain language" });
});

export const explainRefund = asyncHandler(async (req, res) => {
  const { refundRequestId } = req.params;
  const result = await generativeAssistant.explainRefund({ refundRequestId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Refund request explained" });
});

export const getExpenseSummary = asyncHandler(async (req, res) => {
  const analyticsData = await buildPaymentAnalyticsData(req.user);
  const result = await generativeAssistant.expenseSummary(analyticsData);
  res.status(200).json({ success: true, data: { ...result, analytics: analyticsData }, message: "Expense summary generated" });
});

// -------------------------------------------------- health ecosystem
export const getFamilyHealthInsights = asyncHandler(async (req, res) => {
  const result = await generativeAssistant.familyHealthInsights({ patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Family health insights generated" });
});

export const getInsuranceExplain = asyncHandler(async (req, res) => {
  const { insuranceId } = req.params;
  const result = await generativeAssistant.explainInsurance({ insuranceId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Insurance policy explained" });
});

export const getInsuranceEligibilitySummary = asyncHandler(async (req, res) => {
  const { insuranceId } = req.params;
  const result = await generativeAssistant.insuranceEligibilitySummary({ insuranceId, patientUserId: req.user._id });
  res.status(200).json({ success: true, data: result, message: "Insurance eligibility summary generated" });
});

// Recomputes via the exact same buildHealthScore/computeBMI helpers the
// Health Profile page itself calls, so the AI narrative can never diverge
// from the score/BMI the patient sees on screen.
export const getHealthProfileReview = asyncHandler(async (req, res) => {
  const now = new Date();
  const [user, insurancePolicies, upcomingAppointment, overdueFollowUpCount] = await Promise.all([
    User.findById(req.user._id).select("-password").lean(),
    Insurance.find({ userId: req.user._id }).select("validTill").lean(),
    Appointment.findOne({ patientId: req.user._id, status: { $in: ACTIVE_STATUSES }, date: { $gte: now } }).sort({ date: 1 }).lean(),
    Prescription.countDocuments({ patientId: req.user._id, followUpDate: { $lt: now }, status: "active" }),
  ]);
  const reportCount = await MedicalReport.countDocuments({ userId: req.user._id });
  const health = buildHealthScore({ user, insuranceCount: insurancePolicies.length, reportCount, upcomingAppointment, overdueFollowUpCount });
  const bmi = computeBMI(user.patientProfile?.vitals?.heightCm, user.patientProfile?.vitals?.weightKg);

  const result = await generativeAssistant.healthProfileReview({
    patientUserId: req.user._id,
    healthScore: health.score,
    breakdown: health.breakdown,
    bmi,
  });
  res.status(200).json({ success: true, data: result, message: "Health profile review generated" });
});

// Recomputes via the exact same buildPatientTimelineData helper the Health
// Journey page calls, so the AI summary can never diverge from what's shown.
export const getHealthJourneySummary = asyncHandler(async (req, res) => {
  const familyMemberId = req.query.familyMemberId;
  const { timeline } = await buildPatientTimelineData(req, familyMemberId);
  const completedAppointments = timeline.filter((item) => item.type === "appointment" && ["completed", "review_eligible"].includes(item.data?.status));
  const reportsCount = timeline.filter((item) => item.type === "report").length;
  const milestones = [
    { label: "Completed visits", value: completedAppointments.length },
    { label: "Health records on file", value: reportsCount },
  ].filter((m) => m.value > 0);

  const upcoming = timeline.find((item) => item.type === "appointment" && ACTIVE_STATUSES.includes(item.data?.status) && new Date(item.date) >= new Date());
  const nextAction = upcoming
    ? { type: "appointment", label: `Prepare for your upcoming appointment on ${new Date(upcoming.date).toLocaleDateString()}` }
    : { type: "checkup", label: "No pending actions — consider scheduling a routine checkup" };

  const result = await generativeAssistant.healthJourneySummary({
    patientUserId: req.user._id,
    timeline,
    milestones,
    nextAction,
  });
  res.status(200).json({ success: true, data: result, message: "Health journey summary generated" });
});

// ------------------------------------------------------------------ shared
export const draftCommunication = asyncHandler(async (req, res) => {
  const { type, context } = req.body;
  if (!type) throw new AppError("Communication type is required", 400);
  const scope = req.user.role === ROLES.PATIENT ? "patient" : req.user.role === ROLES.DOCTOR ? "doctor" : "admin";

  const result = await generativeAssistant.draftCommunication({ type, context: context || {}, actorId: req.user._id, scope });
  res.status(200).json({ success: true, data: result, message: "Communication draft generated" });
});

export const approveDraft = asyncHandler(async (req, res) => {
  const { draftId } = req.params;
  const { editedContent } = req.body;
  const draft = await generativeAssistant.approveDraft({ draftId, userId: req.user._id, editedContent });
  res.status(200).json({ success: true, data: { draft }, message: "AI draft approved" });
});

export const listDrafts = asyncHandler(async (req, res) => {
  const drafts = await generativeAssistant.listDrafts({ userId: req.user._id, promptKey: req.query.promptKey, limit: req.query.limit });
  res.status(200).json({ success: true, data: { drafts }, message: "AI drafts fetched" });
});

// ------------------------------------------------------------------- admin
export const getExecutiveBrief = asyncHandler(async (_req, res) => {
  const overviewData = await buildPlatformOverviewData();
  const result = await generativeAssistant.executiveBrief(overviewData);
  res.status(200).json({ success: true, data: { ...result, overview: overviewData }, message: "Executive brief generated" });
});

// PHASE UI-4 — Patients Management Workspace. Builds the same real
// aggregate/attention data the Patient 360 workspace displays and passes
// it straight into generativeAssistant.patientOperationalSummary so the AI
// text can never diverge from what's on screen.
export const getPatientOperationalSummaryAdmin = asyncHandler(async (req, res) => {
  const patientId = req.params.patientId;
  const aggregateMap = await buildPatientAggregates([patientId]);
  const aggregate = aggregateMap.get(patientId.toString()) || {};
  const patient = await User.findById(patientId).select("patientProfile").lean();
  if (!patient) throw new AppError("Patient not found", 404);

  const canViewFinance = await userHasPermission(req.user, "manage_payments");
  const attentionItems = computeAttentionItems(patient, aggregate);
  const riskLevel = computePatientRiskLevel({
    medicalConditions: patient.patientProfile?.medicalConditions || [],
    allergies: patient.patientProfile?.allergies || [],
    latestPainLevel: aggregate.latestVisitSnapshot?.painLevel,
  });

  const result = await generativeAssistant.patientOperationalSummary({
    patientId,
    adminUserId: req.user._id,
    context: {
      appointmentCount: aggregate.appointmentCount || 0,
      lastVisit: aggregate.lastVisit,
      nextVisit: aggregate.nextVisit,
      riskLevel,
      canViewFinance,
      outstandingAmount: canViewFinance ? aggregate.outstandingAmount || 0 : null,
      hasInsurance: (aggregate.insurance || []).length > 0,
      expiringInsuranceCount: (aggregate.expiringInsurance || []).length,
      expiredInsuranceCount: (aggregate.expiredInsurance || []).length,
      unreviewedCriticalReportsCount: (aggregate.criticalUnreviewedReports || []).length,
      attentionItems,
    },
  });

  res.status(200).json({ success: true, data: result, message: "Patient operational summary generated" });
});

export const getReviewSentiment = asyncHandler(async (req, res) => {
  const result = await generativeAssistant.reviewSentiment({ doctorId: req.query.doctorId });
  res.status(200).json({ success: true, data: result, message: "Review sentiment overview generated" });
});

// ---------------------------------------------------------- workflow intel
export const getWorkflowSuggestions = asyncHandler(async (req, res) => {
  const now = new Date();
  const followUpWindow = new Date(now);
  followUpWindow.setDate(followUpWindow.getDate() + 3);

  let counts;

  if (ADMIN_ROLES.includes(req.user.role)) {
    const overviewData = await buildPlatformOverviewData();
    const followUpsDue = await Prescription.countDocuments({ followUpDate: { $gte: now, $lte: followUpWindow }, status: "active" });
    counts = {
      pendingApprovals: overviewData.appointments.pending,
      pendingRefunds: overviewData.refunds.pendingCount,
      doctorVerifications: overviewData.pendingApprovals.doctorVerifications,
      followUpsDue,
    };
  } else if (req.user.role === ROLES.DOCTOR) {
    const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
    const doctorId = doctor?._id;
    const [pendingApprovals, followUpsDue] = await Promise.all([
      doctorId ? Appointment.countDocuments({ doctorId, status: "pending" }) : 0,
      doctorId ? Prescription.countDocuments({ doctorId, followUpDate: { $gte: now, $lte: followUpWindow }, status: "active" }) : 0,
    ]);
    counts = { pendingApprovals, followUpsDue };
  } else {
    // patient: incomplete profile + upcoming follow-ups only
    const followUpsDue = await Prescription.countDocuments({ patientId: req.user._id, followUpDate: { $gte: now, $lte: followUpWindow }, status: "active" });
    counts = { followUpsDue };
  }

  const result = await generativeAssistant.workflowSuggestions(counts);
  res.status(200).json({ success: true, data: { ...result, counts }, message: "Workflow suggestions generated" });
});

// -------------------------------------------------------------- smart search
export const naturalLanguageSearch = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) throw new AppError("Search query must be at least 2 characters", 400);

  const parsed = await parseNaturalLanguageQuery(query, req.user);
  if (!parsed) {
    return res.status(200).json({
      success: true,
      data: { matched: false },
      message: "No natural-language intent recognized; use standard search",
    });
  }

  res.status(200).json({ success: true, data: { matched: true, ...parsed }, message: "Natural-language search resolved" });
});

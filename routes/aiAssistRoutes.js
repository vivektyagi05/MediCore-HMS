import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import {
  approveDraft,
  appointmentPrepChecklist,
  draftClinicalNote,
  draftCommunication,
  draftConsultationSummary,
  explainInvoice,
  explainPayment,
  explainPrescription,
  explainRefund,
  getExecutiveBrief,
  getExpenseSummary,
  getFamilyHealthInsights,
  getHealthJourneySummary,
  getHealthProfileReview,
  getInsuranceEligibilitySummary,
  getInsuranceExplain,
  getPatientClinicalBrief,
  getClinicalCopilotAnswer,
  getPatientOperationalSummaryAdmin,
  getDocumentCenterSuggestions,
  getConsultationAssistant,
  getPatientEducationSummary,
  getPrescriptionFollowUpSuggestion,
  getReviewSentiment,
  getDoctorReviewSummary,
  getRevenueInsights,
  getReputationAdvisor,
  getBusinessAdvisor,
  getProfileReview,
  getVerificationAdvisor,
  getSubscriptionAdvisor,
  getGrowthAdvisor,
  getMissingFieldsAdvisor,
  getScheduleOptimization,
  getWorkflowSuggestions,
  listDrafts,
  naturalLanguageSearch,
  summarizeDocument,
} from "../controllers/aiAssistController.js";

const router = Router();

router.use(protect);

// Doctor AI Assistant
router.post("/consultation-summary", authorizeRoles(ROLES.DOCTOR), draftConsultationSummary);
router.post("/clinical-note", authorizeRoles(ROLES.DOCTOR), draftClinicalNote);
router.get("/patients/:patientId/brief", authorizeRoles(ROLES.DOCTOR), getPatientClinicalBrief);
router.post("/patients/:patientId/copilot", authorizeRoles(ROLES.DOCTOR), getClinicalCopilotAnswer);
router.get("/prescriptions/:prescriptionId/follow-up-suggestion", authorizeRoles(ROLES.DOCTOR), getPrescriptionFollowUpSuggestion);
router.get("/prescriptions/:prescriptionId/patient-education", authorizeRoles(ROLES.DOCTOR), getPatientEducationSummary);
router.get("/appointments/:appointmentId/consultation-assistant", authorizeRoles(ROLES.DOCTOR), getConsultationAssistant);
router.get("/schedule/optimization", authorizeRoles(ROLES.DOCTOR), getScheduleOptimization);
router.get("/documents/suggestions", authorizeRoles(ROLES.DOCTOR), getDocumentCenterSuggestions);

// Doctor Business Intelligence Platform (Phase D3)
router.get("/doctor/reviews/summary", authorizeRoles(ROLES.DOCTOR), getDoctorReviewSummary);
router.get("/doctor/revenue/insights", authorizeRoles(ROLES.DOCTOR), getRevenueInsights);
router.get("/doctor/reputation/advisor", authorizeRoles(ROLES.DOCTOR), getReputationAdvisor);
router.get("/doctor/business/advisor", authorizeRoles(ROLES.DOCTOR), getBusinessAdvisor);

// Practice Management Platform (Phase D4)
router.get("/doctor/practice/profile-review", authorizeRoles(ROLES.DOCTOR), getProfileReview);
router.get("/doctor/practice/verification-advisor", authorizeRoles(ROLES.DOCTOR), getVerificationAdvisor);
router.get("/doctor/practice/subscription-advisor", authorizeRoles(ROLES.DOCTOR), getSubscriptionAdvisor);
router.get("/doctor/practice/growth-advisor", authorizeRoles(ROLES.DOCTOR), getGrowthAdvisor);
router.get("/doctor/practice/missing-fields-advisor", authorizeRoles(ROLES.DOCTOR), getMissingFieldsAdvisor);

// Patient AI Assistant
router.post("/prescriptions/:prescriptionId/explain", authorizeRoles(ROLES.PATIENT), explainPrescription);
router.post("/documents/:reportId/summarize", authorizeRoles(ROLES.PATIENT), summarizeDocument);
router.post("/appointments/:appointmentId/prep", authorizeRoles(ROLES.PATIENT), appointmentPrepChecklist);

// Patient Financial Ecosystem AI Assist
router.post("/payments/:paymentId/explain", authorizeRoles(ROLES.PATIENT), explainPayment);
router.post("/invoices/:invoiceId/explain", authorizeRoles(ROLES.PATIENT), explainInvoice);
router.post("/refunds/:refundRequestId/explain", authorizeRoles(ROLES.PATIENT), explainRefund);
router.get("/expense-summary", authorizeRoles(ROLES.PATIENT), getExpenseSummary);

// Patient Health Ecosystem AI Assist (Records / Family / Insurance)
router.get("/family/insights", authorizeRoles(ROLES.PATIENT), getFamilyHealthInsights);
router.post("/insurance/:insuranceId/explain", authorizeRoles(ROLES.PATIENT), getInsuranceExplain);
router.get("/insurance/:insuranceId/eligibility", authorizeRoles(ROLES.PATIENT), getInsuranceEligibilitySummary);

// Personal Health Intelligence Platform (Health Profile + Health Journey)
router.get("/health-profile/review", authorizeRoles(ROLES.PATIENT), getHealthProfileReview);
router.get("/health-journey/summary", authorizeRoles(ROLES.PATIENT), getHealthJourneySummary);

// Shared: communication drafts + draft lifecycle
router.post("/communications/draft", draftCommunication);
router.post("/drafts/:draftId/approve", approveDraft);
router.get("/drafts", listDrafts);

// Admin AI Assistant
router.get("/admin/brief", authorizeRoles(ROLES.SUPER_ADMIN), getExecutiveBrief);
router.get("/admin/review-sentiment", authorizeRoles(ROLES.SUPER_ADMIN), getReviewSentiment);
router.get("/admin/patients/:patientId/operational-summary", authorizeRoles(ROLES.SUPER_ADMIN), getPatientOperationalSummaryAdmin);

// Workflow Intelligence (role-aware — admin/doctor/patient)
router.get("/workflow/suggestions", getWorkflowSuggestions);

// Smart Search (natural language)
router.get("/search", naturalLanguageSearch);

export default router;

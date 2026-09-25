import { requireFeatureEnabled } from "../services/featureToggleService.js";
import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import {
  analyzeSymptoms,
  chatbotReply,
  generateAdminInsights,
  getAdminInsights,
  getAISystemHealth,
  getPredictiveDashboard,
  getReminderHistory,
  getScheduleOptimization,
  recommendDoctors,
  runAutomation,
  smartSearch,
  suggestAppointmentSlots,
} from "../controllers/aiController.js";

const router = Router();

router.post("/symptoms/analyze", protect, authorizeRoles(ROLES.PATIENT), requireFeatureEnabled("ai_features", "AI features"), analyzeSymptoms);
router.get("/doctors/recommend", protect, authorizeRoles(ROLES.PATIENT, ROLES.SUPER_ADMIN), requireFeatureEnabled("ai_features", "AI features"), recommendDoctors);
router.post("/appointments/suggest-slots", protect, authorizeRoles(ROLES.PATIENT, ROLES.SUPER_ADMIN), requireFeatureEnabled("ai_features", "AI features"), suggestAppointmentSlots);
router.get("/search", protect, smartSearch);
router.post("/chatbot", protect, requireFeatureEnabled("ai_features", "AI features"), chatbotReply);

router.get("/insights", protect, authorizeRoles(ROLES.SUPER_ADMIN), getAdminInsights);
router.post("/insights/generate", protect, authorizeRoles(ROLES.SUPER_ADMIN), generateAdminInsights);
router.get("/predictions", protect, authorizeRoles(ROLES.SUPER_ADMIN), getPredictiveDashboard);
router.get("/schedule/optimization", protect, authorizeRoles(ROLES.SUPER_ADMIN), getScheduleOptimization);
router.post("/automation/run", protect, authorizeRoles(ROLES.SUPER_ADMIN), runAutomation);
router.get("/automation/reminders", protect, getReminderHistory);
router.get("/system-health", protect, authorizeRoles(ROLES.SUPER_ADMIN), getAISystemHealth);

export default router;

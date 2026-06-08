import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import {
  analyzeSymptoms,
  chatbotReply,
  generateAdminInsights,
  getAdminInsights,
  getPredictiveDashboard,
  getReminderHistory,
  getScheduleOptimization,
  recommendDoctors,
  runAutomation,
  smartSearch,
  suggestAppointmentSlots,
} from "../controllers/aiController.js";

const router = Router();

router.post("/symptoms/analyze", protect, authorizeRoles(ROLES.PATIENT), analyzeSymptoms);
router.get("/doctors/recommend", protect, authorizeRoles(ROLES.PATIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN), recommendDoctors);
router.post("/appointments/suggest-slots", protect, authorizeRoles(ROLES.PATIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN), suggestAppointmentSlots);
router.get("/search", protect, smartSearch);
router.post("/chatbot", protect, chatbotReply);

router.get("/insights", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), getAdminInsights);
router.post("/insights/generate", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), generateAdminInsights);
router.get("/predictions", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), getPredictiveDashboard);
router.get("/schedule/optimization", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), getScheduleOptimization);
router.post("/automation/run", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), runAutomation);
router.get("/automation/reminders", protect, getReminderHistory);

export default router;

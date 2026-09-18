import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";
import { requireApprovedDoctor } from "../../middleware/doctorAccessMiddleware.js";
import { ROLES } from "../../constants/roles.js";
import { getDoctorCommandCenter, markReportReviewed } from "../../controllers/doctor/commandCenterController.js";

const router = express.Router();

router.use(protect, authorizeRoles(ROLES.DOCTOR), requireApprovedDoctor);

router.get("/command-center", getDoctorCommandCenter);
router.patch("/reports/:reportId/reviewed", markReportReviewed);

export default router;

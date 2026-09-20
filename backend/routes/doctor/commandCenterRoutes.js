import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";
import { requireApprovedDoctor } from "../../middleware/doctorAccessMiddleware.js";
import { ROLES } from "../../constants/roles.js";
import { getDoctorCommandCenter, markReportReviewed } from "../../controllers/doctor/commandCenterController.js";

const router = express.Router();

// IMPORTANT: this router is mounted at /api/doctor BEFORE the onboarding router.
// A router-level `router.use(..., requireApprovedDoctor)` (no path) runs for EVERY
// /api/doctor/* request that reaches this router — including GET/POST/PUT
// /api/doctor/onboarding — and returned 403 "Your doctor account is not yet
// approved" to exactly the pending doctors who need onboarding. The approval
// gate therefore belongs on the approved-only routes themselves.
const approvedDoctorOnly = [protect, authorizeRoles(ROLES.DOCTOR), requireApprovedDoctor];

router.get("/command-center", ...approvedDoctorOnly, getDoctorCommandCenter);
router.patch("/reports/:reportId/reviewed", ...approvedDoctorOnly, markReportReviewed);

export default router;

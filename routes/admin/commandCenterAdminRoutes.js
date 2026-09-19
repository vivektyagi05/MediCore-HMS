import { Router } from "express";
import { getCommandCenter, getCommandCenterExecutiveSummary } from "../../controllers/admin/commandCenterAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// No requirePermission() gate at the route level — this endpoint is the
// executive overview every admin should be able to load (same as
// mission-control/dashboard). Section-level permission checks (Finance ->
// manage_payments, Operations/Workflow/Governance -> manage_settings)
// happen inside the controller/aggregator instead, so an admin without
// those permissions still gets the sections they ARE allowed to see
// rather than a blanket 403.
router.get("/", getCommandCenter);
router.get("/executive-summary", getCommandCenterExecutiveSummary);

export default router;

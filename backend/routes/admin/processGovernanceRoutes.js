import { Router } from "express";
import {
  getOverview,
  getApprovalQueue,
  getComplianceMatrix,
  getExceptions,
  getProcessGovernance,
  getAuditTimeline,
  updateGovernanceClassification,
  submitForReview,
  approveGovernance,
  rejectGovernance,
  requestChanges,
  emergencyPublish,
  resolveException,
  explainGovernance,
  explainApprovalRisk,
  explainCompliance,
  explainChangeImpact,
} from "../../controllers/admin/processGovernanceController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key every other Process/Workflow/
// Automation Studio surface already uses — no new roles/permissions
// introduced for Governance (Section 4H audit finding).
const gate = requirePermission("manage_settings");

router.get("/overview", gate, getOverview);
router.get("/approval-queue", gate, getApprovalQueue);
router.get("/compliance-matrix", gate, getComplianceMatrix);
router.get("/exceptions", gate, getExceptions);

router.get("/processes/:id", gate, getProcessGovernance);
router.get("/processes/:id/audit-timeline", gate, getAuditTimeline);
router.put("/processes/:id/classification", gate, updateGovernanceClassification);

router.post("/processes/:id/submit-review", gate, submitForReview);
router.post("/processes/:id/approve", gate, approveGovernance);
router.post("/processes/:id/reject", gate, rejectGovernance);
router.post("/processes/:id/request-changes", gate, requestChanges);
router.post("/processes/:id/emergency-publish", gate, emergencyPublish);
router.post("/processes/:id/exceptions/:exceptionId/resolve", gate, resolveException);

router.get("/processes/:id/ai-explain", gate, explainGovernance);
router.get("/processes/:id/ai-approval-risk", gate, explainApprovalRisk);
router.get("/processes/:id/ai-compliance-summary", gate, explainCompliance);
router.get("/processes/:id/ai-change-impact", gate, explainChangeImpact);

export default router;

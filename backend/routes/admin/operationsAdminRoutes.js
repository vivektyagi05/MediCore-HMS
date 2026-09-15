import { Router } from "express";
import {
  getOperationsQueueUnified,
  getOperationDetail,
  claimOperation,
  releaseOperation,
  assignOperation,
  escalateOperation,
  resolveOperation,
  cancelOperation,
  pinOperation,
  getOperationAiSummary,
  getOperationsBusinessRules,
  getWorkflowRegistry,
  getWorkflowLifecycle,
  getWorkflowExplain,
  getSlaOverview,
} from "../../controllers/admin/operationsAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Read surfaces — same "manage_settings" permission key already used by the
// Platform Health Center / Executive Action Center (no new roles/permissions
// invented for Phase A6.1).
router.get("/queue", requirePermission("manage_settings"), getOperationsQueueUnified);
router.get("/business-rules", requirePermission("manage_settings"), getOperationsBusinessRules);

// Phase A6.2.1 — Enterprise Workflow Automation Core: Workflow Engine
// Inspector read surfaces (registry + shared lifecycle graph). Placed above
// the "/:operationKey" catch-all route so these literal paths are matched
// first.
router.get("/workflow-registry", requirePermission("manage_settings"), getWorkflowRegistry);
router.get("/workflow-lifecycle", requirePermission("manage_settings"), getWorkflowLifecycle);

// Phase UI-11, Part K — SLA Command Center. Literal path, placed above the
// "/:operationKey" catch-all so it isn't swallowed as an operation key.
router.get("/sla-overview", requirePermission("manage_settings"), getSlaOverview);

router.get("/:operationKey", requirePermission("manage_settings"), getOperationDetail);
router.get("/:operationKey/ai-summary", requirePermission("manage_settings"), getOperationAiSummary);
router.get("/:operationKey/workflow-explain", requirePermission("manage_settings"), getWorkflowExplain);

// Assignment System (Step 4) — action surfaces.
router.post("/:operationKey/claim", requirePermission("manage_settings"), claimOperation);
router.post("/:operationKey/release", requirePermission("manage_settings"), releaseOperation);
router.post("/:operationKey/assign", requirePermission("manage_settings"), assignOperation);
router.post("/:operationKey/escalate", requirePermission("manage_settings"), escalateOperation);
router.post("/:operationKey/resolve", requirePermission("manage_settings"), resolveOperation);
router.post("/:operationKey/cancel", requirePermission("manage_settings"), cancelOperation);
router.post("/:operationKey/pin", requirePermission("manage_settings"), pinOperation);

export default router;

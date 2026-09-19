import { Router } from "express";
import {
  getStudioHome,
  getTriggerLibrary,
  getActionLibrary,
  getTemplateLibrary,
  listFlows,
  getFlow,
  createFlow,
  createFlowFromTemplate,
  updateFlow,
  publishFlow,
  archiveFlow,
  restoreFlow,
  cloneFlow,
  rollbackFlow,
  compareVersions,
  pinFlow,
  favoriteFlow,
  deleteFlow,
  simulateFlow,
  getFlowRunHistory,
  getFlowInspector,
  explainFlow,
  advisorFlow,
} from "../../controllers/admin/automationStudioController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key already used by every other
// Operations/Workflow/Assignment surface — no new roles/permissions
// introduced for the Automation Studio.
const gate = requirePermission("manage_settings");

router.get("/home", gate, getStudioHome);
router.get("/triggers", gate, getTriggerLibrary);
router.get("/actions", gate, getActionLibrary);
router.get("/templates", gate, getTemplateLibrary);
router.post("/templates/:templateKey/use", gate, createFlowFromTemplate);

router.get("/flows", gate, listFlows);
router.post("/flows", gate, createFlow);
router.get("/flows/:id", gate, getFlow);
router.put("/flows/:id", gate, updateFlow);
router.delete("/flows/:id", gate, deleteFlow);

router.post("/flows/:id/publish", gate, publishFlow);
router.post("/flows/:id/archive", gate, archiveFlow);
router.post("/flows/:id/restore", gate, restoreFlow);
router.post("/flows/:id/clone", gate, cloneFlow);
router.post("/flows/:id/rollback", gate, rollbackFlow);
router.get("/flows/:id/compare-versions", gate, compareVersions);
router.post("/flows/:id/pin", gate, pinFlow);
router.post("/flows/:id/favorite", gate, favoriteFlow);

router.post("/flows/:id/simulate", gate, simulateFlow);
router.get("/flows/:id/runs", gate, getFlowRunHistory);
router.get("/flows/:id/inspector", gate, getFlowInspector);

router.get("/flows/:id/ai-explain", gate, explainFlow);
router.get("/flows/:id/ai-advisor", gate, advisorFlow);

export default router;

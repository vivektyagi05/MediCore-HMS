import { Router } from "express";
import {
  getRegistry,
  listProcesses,
  getProcess,
  getProcessVersions,
  compareVersions,
  createProcess,
  updateProcess,
  deleteProcess,
  cloneProcess,
  validateProcess,
  simulateProcess,
  getRunHistory,
  getImpact,
  publishProcess,
  activateProcess,
  pauseProcess,
  archiveProcess,
  explainProcess,
  explainSimulation,
} from "../../controllers/admin/processDesignerController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Same "manage_settings" permission key every other Operations/Workflow/
// Assignment/Automation Studio/Process Orchestrator surface already uses —
// no new roles/permissions introduced for the Process Designer.
const gate = requirePermission("manage_settings");

router.get("/node-registry", gate, getRegistry);

router.get("/processes", gate, listProcesses);
router.post("/processes", gate, createProcess);
router.get("/processes/:id", gate, getProcess);
router.put("/processes/:id", gate, updateProcess);
router.delete("/processes/:id", gate, deleteProcess);
router.post("/processes/:id/clone", gate, cloneProcess);

router.get("/processes/:id/versions", gate, getProcessVersions);
router.get("/processes/:id/compare-versions", gate, compareVersions);

router.post("/processes/:id/validate", gate, validateProcess);
router.post("/processes/:id/simulate", gate, simulateProcess);
router.get("/processes/:id/runs", gate, getRunHistory);
router.get("/processes/:id/impact", gate, getImpact);

router.post("/processes/:id/publish", gate, publishProcess);
router.post("/processes/:id/activate", gate, activateProcess);
router.post("/processes/:id/pause", gate, pauseProcess);
router.post("/processes/:id/archive", gate, archiveProcess);

router.get("/processes/:id/ai-explain", gate, explainProcess);
router.get("/processes/:id/ai-simulation-explain", gate, explainSimulation);

export default router;

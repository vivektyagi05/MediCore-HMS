import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createLead, listLeads, getLead, assignLead, changeLeadPriority, changeLeadStatus, addLeadNote } from "../controllers/leadController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/adminMiddleware.js";

const router = Router();
const publicLeadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many enquiries. Please try again later." } });
const adminLeadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many lead-management requests. Please try again later." } });

router.post("/", publicLeadLimiter, optionalProtect, createLead);
router.use(protect, requireAdmin, adminLeadLimiter);
router.get("/", listLeads);
router.get("/:id", getLead);
router.post("/:id/assign", assignLead);
router.post("/:id/priority", changeLeadPriority);
router.post("/:id/status", changeLeadStatus);
router.post("/:id/notes", addLeadNote);

export default router;

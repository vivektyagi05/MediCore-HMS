import { Router } from "express";
import {
  downloadInvoice,
  getInvoiceById,
  getInvoiceSummary,
  getInvoices,
} from "../controllers/invoiceController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

// PHASE DOC-09: doctors gained real, ownership-scoped read access to this
// existing invoice engine (see invoiceController.js's ownershipFilter) —
// additive role only, admin/patient behavior is unchanged.
router.get("/", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT, ROLES.DOCTOR), getInvoices);
router.get("/summary", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT, ROLES.DOCTOR), getInvoiceSummary);
router.get("/:id", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT, ROLES.DOCTOR), getInvoiceById);
router.get("/:id/download", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT, ROLES.DOCTOR), downloadInvoice);

export default router;

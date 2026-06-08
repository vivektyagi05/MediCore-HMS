import { Router } from "express";
import {
  downloadInvoice,
  getInvoiceById,
  getInvoices,
} from "../controllers/invoiceController.js";
import { ROLES } from "../constants/roles.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), getInvoices);
router.get("/:id", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), getInvoiceById);
router.get("/:id/download", protect, authorizeRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PATIENT), downloadInvoice);

export default router;

import { Router } from "express";
import {
  listPaymentsAdmin,
  getPaymentSummaryAdmin,
  getPaymentDetailAdmin,
  listCaptureCasesAdmin,
  resolveCaptureCaseAdmin,
  listWalletReservationsAdmin,
  resolveWalletReservationAdmin,
} from "../../controllers/admin/paymentAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// The whole Payments workspace is financial data — gated behind
// manage_payments in full, same permission key already used by
// doctorAdminRoutes.js's /:id/earnings and every other financial surface
// in this codebase. No new permission key introduced.
const gate = requirePermission("manage_payments");

// Fixed subpaths before "/:id", same ordering convention as
// appointmentAdminRoutes.js / patientAdminRoutes.js.
router.get("/summary", gate, getPaymentSummaryAdmin);
router.get("/", gate, listPaymentsAdmin);
router.get("/capture-cases", gate, listCaptureCasesAdmin);
router.post("/:id/capture-cases/resolve", gate, resolveCaptureCaseAdmin);
router.get("/wallet-reservations", gate, listWalletReservationsAdmin);
router.post("/:id/wallet-reservations/resolve", gate, resolveWalletReservationAdmin);
router.get("/:id", gate, getPaymentDetailAdmin);

export default router;

import { Router } from "express";
import {
  listWithdrawalsAdmin,
  getWithdrawalDetailAdmin,
  markWithdrawalProcessing,
  completeWithdrawal,
  failWithdrawal,
  retryWithdrawal,
  cancelWithdrawal,
} from "../../controllers/admin/withdrawalAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";

const router = Router();
router.use(protect, requireAdmin);

// Withdrawal data is financial data — same manage_payments permission key
// already used by the Payments/Refunds admin workspaces. No new key.
const gate = requirePermission("manage_payments");

router.get("/", gate, listWithdrawalsAdmin);
router.get("/:id", gate, getWithdrawalDetailAdmin);
router.patch("/:id/processing", gate, markWithdrawalProcessing);
router.patch("/:id/complete", gate, completeWithdrawal);
router.patch("/:id/fail", gate, failWithdrawal);
router.patch("/:id/retry", gate, retryWithdrawal);
router.patch("/:id/cancel", gate, cancelWithdrawal);

export default router;

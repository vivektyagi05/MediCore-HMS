// Phase 01: recovery of webhook events stuck after a crash (received / expired
// processing lease / retryable failure due) and of provider orders left as
// placeholder attempts by a crash or timeout. Runs under trackRun() like every
// scheduled job, so the Phase 00 lease/fencing guarantees apply.
import { connectDB } from "../config/db.js";
import { recoverWebhookEvents } from "../payments/webhookHandler.js";
import { recoverOrphanAttempts } from "../payments/paymentAttemptService.js";
import { recoverWalletReservations } from "../payments/walletReservationService.js";
import { recoverWalletOnlyPayments } from "../payments/walletOnlyRecovery.js";
import { recoverStuckWalletRecharges } from "../payments/walletRechargeService.js";
import { recoverOrphanCouponReservations, sweepUnpayablePayments } from "../payments/unpaidPaymentCleanup.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

export const runRecoverPaymentEvents = async () => {
  await connectDB();
  return trackRun("recoverPaymentEvents", async () => {
    const events = await recoverWebhookEvents();
    const attempts = await recoverOrphanAttempts();
    // Phase 02: wallet-side recovery rides the SAME leased job (no second scheduler).
    const walletOnly = await recoverWalletOnlyPayments();
    const reservations = await recoverWalletReservations();
    const recharges = await recoverStuckWalletRecharges();
    const unpayable = await sweepUnpayablePayments();
    const couponOrphans = await recoverOrphanCouponReservations();
    const processed = events.filter((r) => r.state === "processed").length;
    const summary = { events: events.length, processed, attempts: attempts.length, walletOnly: walletOnly.length, reservations: reservations.length, recharges: recharges.length, unpayable: unpayable.length, couponOrphans: couponOrphans.length };
    logger.info("Payment event recovery completed", summary);
    return summary;
  });
};

if (process.argv[1]?.endsWith("recoverPaymentEvents.js")) {
  runRecoverPaymentEvents().then(() => process.exit(0)).catch((error) => {
    logger.error("Payment event recovery failed", { message: error.message });
    process.exit(1);
  });
}

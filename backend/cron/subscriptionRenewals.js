import { connectDB } from "../config/db.js";
import Subscription from "../models/Subscription.js";
import { logger } from "../utils/logger.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";
import { trackRun } from "../utils/cronRunTracker.js";

export const runSubscriptionRenewals = async () => {
  await connectDB();
  return trackRun("subscriptionRenewals", () => runSubscriptionRenewalsBody());
};

const runSubscriptionRenewalsBody = async () => {
  const dueSubscriptions = await Subscription.find({
    status: { $in: ["active", "past_due"] },
    autoRenew: true,
    nextBillingAt: { $lte: new Date() },
  }).limit(100);

  // BUGFIX: previously a subscription that kept failing to renew stayed
  // "past_due" forever with no resolution — an unresolved workflow state.
  // After this many consecutive missed renewal windows, cancel it instead
  // of leaving it stuck, using the same fields subscriptionService.cancel()
  // already uses.
  const MAX_FAILED_RENEWALS_BEFORE_CANCEL = 3;

  let cancelledCount = 0;
  for (const subscription of dueSubscriptions) {
    subscription.failedRenewalCount += 1;

    if (subscription.failedRenewalCount >= MAX_FAILED_RENEWALS_BEFORE_CANCEL) {
      subscription.status = "cancelled";
      subscription.autoRenew = false;
      cancelledCount += 1;
    } else {
      subscription.status = "past_due";
    }

    await subscription.save();

    // BUGFIX (Phase D4, Step 8): this transition previously never notified
    // anyone -- a doctor's subscription could silently go past_due or get
    // cancelled with zero realtime signal, discovering it only if they
    // happened to check the billing page.
    try {
      await practiceEmitter.subscriptionUpdated({
        doctorUserId: subscription.userId,
        subscriptionId: subscription._id,
        status: subscription.status,
        planName: subscription.planName,
      });
    } catch (error) {
      logger.warn("practiceEmitter.subscriptionUpdated failed in renewal cron", { message: error?.message });
    }
  }

  // Renewal reminders (Step 8): previously nothing warned a doctor their
  // subscription was about to renew/charge. This looks 3 days ahead of
  // nextBillingAt for still-active, auto-renewing subscriptions -- a real,
  // bounded window, not a guess.
  const REMINDER_WINDOW_DAYS = 3;
  const reminderWindowEnd = new Date(Date.now() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const upcomingRenewals = await Subscription.find({
    status: "active",
    autoRenew: true,
    nextBillingAt: { $gt: new Date(), $lte: reminderWindowEnd },
  }).limit(200);

  for (const subscription of upcomingRenewals) {
    const daysRemaining = Math.max(1, Math.ceil((subscription.nextBillingAt - new Date()) / (24 * 60 * 60 * 1000)));
    try {
      await practiceEmitter.renewalReminder({
        doctorUserId: subscription.userId,
        subscriptionId: subscription._id,
        planName: subscription.planName,
        daysRemaining,
        nextBillingAt: subscription.nextBillingAt,
      });
    } catch (error) {
      logger.warn("practiceEmitter.renewalReminder failed in renewal cron", { message: error?.message });
    }
  }

  logger.info("Subscription renewal cron completed", {
    due: dueSubscriptions.length,
    cancelledAfterMaxRetries: cancelledCount,
    remindersSent: upcomingRenewals.length,
  });
  return { due: dueSubscriptions.length, cancelledAfterMaxRetries: cancelledCount, remindersSent: upcomingRenewals.length };
};

if (process.argv[1]?.endsWith("subscriptionRenewals.js")) {
  runSubscriptionRenewals()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Subscription renewal cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

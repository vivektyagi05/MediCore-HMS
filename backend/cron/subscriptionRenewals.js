import { connectDB } from "../config/db.js";
import Subscription from "../models/Subscription.js";
import { subscriptionService } from "../payments/subscriptionService.js";
import { logger } from "../utils/logger.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";
import { trackRun } from "../utils/cronRunTracker.js";

export const runSubscriptionRenewals = async () => {
  await connectDB();
  return trackRun("subscriptionRenewals", () => runSubscriptionRenewalsBody());
};

// F-023 / A1: this job NEVER extends a subscription and never counts a "missed
// renewal" that was not actually attempted. For each due, auto-renewing,
// currently-paid subscription it opens a provider order (atomic claim in
// subscriptionService.openRenewalOrder) that the doctor must pay. Paid access
// continues only until currentPeriodEnd; an unpaid renewal then expires.
const runSubscriptionRenewalsBody = async () => {
  const dueSubscriptions = await Subscription.find({
    status: "active",
    autoRenew: true,
    nextBillingAt: { $lte: new Date() },
  }).select("_id").sort({ _id: 1 }).limit(100).lean();

  let ordersOpened = 0;
  let orderErrors = 0;
  for (const { _id } of dueSubscriptions) {
    try {
      const opened = await subscriptionService.openRenewalOrder(_id);
      if (!opened) continue; // another worker claimed it
      ordersOpened += 1;
      await practiceEmitter.subscriptionUpdated({
        doctorUserId: opened.userId,
        subscriptionId: opened._id,
        status: opened.status,
        planName: opened.planName,
      }).catch((error) => logger.warn("practiceEmitter.subscriptionUpdated failed in renewal cron", { message: error?.message }));
    } catch (error) {
      orderErrors += 1;
      logger.error("Renewal order creation failed; will retry next run", { subscriptionId: String(_id), message: error?.message });
    }
  }

  // Unpaid renewals whose paid period is over lose entitlement. Conditional update,
  // so a payment that lands concurrently (-> active) is never overwritten.
  const expiredResult = await Subscription.updateMany(
    { status: { $in: ["renewal_pending", "renewal_failed", "past_due"] }, currentPeriodEnd: { $lte: new Date() } },
    { $set: { status: "expired", autoRenew: false }, $inc: { failedRenewalCount: 1 }, $push: { stateHistory: { from: "renewal_unpaid", to: "expired", source: "cron", reason: "Renewal not paid by end of paid period", at: new Date() } } },
  );
  const expiredCount = expiredResult.modifiedCount || 0;

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
    due: dueSubscriptions.length, ordersOpened, orderErrors, expiredUnpaid: expiredCount, remindersSent: upcomingRenewals.length,
  });
  return { due: dueSubscriptions.length, ordersOpened, orderErrors, expiredUnpaid: expiredCount, remindersSent: upcomingRenewals.length };
};

if (process.argv[1]?.endsWith("subscriptionRenewals.js")) {
  runSubscriptionRenewals()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Subscription renewal cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

import { connectDB } from "../config/db.js";
import Subscription from "../models/Subscription.js";
import { logger } from "../utils/logger.js";

export const runSubscriptionRenewals = async () => {
  await connectDB();
  const dueSubscriptions = await Subscription.find({
    status: "active",
    autoRenew: true,
    nextBillingAt: { $lte: new Date() },
  }).limit(100);

  for (const subscription of dueSubscriptions) {
    subscription.status = "past_due";
    subscription.failedRenewalCount += 1;
    await subscription.save();
  }

  logger.info("Subscription renewal cron completed", { due: dueSubscriptions.length });
  return dueSubscriptions;
};

if (process.argv[1]?.endsWith("subscriptionRenewals.js")) {
  runSubscriptionRenewals()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Subscription renewal cron failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

// F-001 legacy-data report. READ-ONLY: lists subscriptions that are entitled
// (active/past_due) but have no provider payment reference, i.e. rows created by
// the old "create => active" flow. It never changes them; deciding whether to
// charge, grandfather or expire each is a business decision.
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Subscription from "../models/Subscription.js";

export const run = async () => {
  await connectDB();
  const rows = await Subscription.find({
    status: { $in: ["active", "past_due"] },
    gatewayPaymentId: { $exists: false },
    razorpaySubscriptionId: { $exists: false },
  }).select("_id userId planCode amount status currentPeriodEnd createdAt").lean();
  console.log(JSON.stringify({ migration: "010", unpaidEntitledSubscriptions: rows.length, rows }, null, 2));
  return rows.length;
};

if (process.argv[1]?.endsWith("010_report_unpaid_active_subscriptions.js")) {
  run().then(async () => { await mongoose.disconnect(); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}

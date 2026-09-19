import Subscription from "../models/Subscription.js";

// Subscription Intelligence (Phase D4, additive): plan definitions gained
// real usage limits so the Subscription Center can show genuine "usage vs
// limit" bars instead of a bare plan name. `free` is not purchasable
// (createSubscription rejects it) -- it's the implicit tier a doctor is on
// when they have no active paid subscription, used only for comparison and
// for computing usage against a baseline.
const planCatalog = {
  doctor_free: {
    planName: "Free",
    interval: "monthly",
    amount: 0,
    purchasable: false,
    limits: { maxAIRequestsPerMonth: 20, maxPatients: 25, maxAppointmentsPerMonth: 30, maxStorageMB: 50 },
  },
  doctor_premium_monthly: {
    planName: "Doctor Premium Monthly",
    interval: "monthly",
    amount: 2999,
    purchasable: true,
    limits: { maxAIRequestsPerMonth: 500, maxPatients: 1000, maxAppointmentsPerMonth: 1000, maxStorageMB: 2048 },
  },
  doctor_premium_yearly: {
    planName: "Doctor Premium Yearly",
    interval: "yearly",
    amount: 29999,
    purchasable: true,
    limits: { maxAIRequestsPerMonth: 500, maxPatients: 1000, maxAppointmentsPerMonth: 1000, maxStorageMB: 2048 },
  },
};

export const getPlanLimits = (planCode) => planCatalog[planCode]?.limits || planCatalog.doctor_free.limits;
export const FREE_PLAN_CODE = "doctor_free";

export const subscriptionService = {
  getPlans() {
    return Object.entries(planCatalog).map(([planCode, plan]) => ({ planCode, ...plan }));
  },

  async createSubscription({ userId, doctorId, planCode }) {
    const plan = planCatalog[planCode];
    if (!plan || !plan.purchasable) throw new Error("Invalid subscription plan");
    const now = new Date();
    const nextBillingAt = new Date(now);
    nextBillingAt.setMonth(nextBillingAt.getMonth() + (plan.interval === "yearly" ? 12 : 1));
    return Subscription.create({
      userId,
      doctorId,
      planCode,
      planName: plan.planName,
      interval: plan.interval,
      amount: plan.amount,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: nextBillingAt,
      nextBillingAt,
    });
  },

  // Subscription Intelligence (Step 5 -- Upgrade/Downgrade): swaps the plan
  // on the doctor's current active subscription. Keeps the existing billing
  // cycle dates (no proration engine exists in this codebase, so this is a
  // straightforward plan swap, not a prorated mid-cycle charge) and takes
  // effect immediately -- the new plan's limits apply right away.
  async changePlan({ subscriptionId, planCode }) {
    const plan = planCatalog[planCode];
    if (!plan || !plan.purchasable) throw new Error("Invalid subscription plan");

    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) throw new Error("Subscription not found");
    if (subscription.status !== "active") throw new Error("Only an active subscription can change plans");
    if (subscription.planCode === planCode) throw new Error("Already on this plan");

    const previousPlanCode = subscription.planCode;
    subscription.planCode = planCode;
    subscription.planName = plan.planName;
    subscription.interval = plan.interval;
    subscription.amount = plan.amount;
    await subscription.save();

    return { subscription, previousPlanCode };
  },

  // BUGFIX: this previously only reset status/failedRenewalCount and never
  // advanced nextBillingAt/currentPeriodEnd. That meant even a SUCCESSFULLY
  // charged subscription still matched the renewal cron's
  // `nextBillingAt <= now` query on its very next run, which would
  // immediately mark it "past_due" again — an oscillating status that never
  // settled, regardless of whether Razorpay's charge actually succeeded.
  async markCharged(razorpaySubscriptionId) {
    const subscription = await Subscription.findOne({ razorpaySubscriptionId });
    if (!subscription) return null;

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + (subscription.interval === "yearly" ? 12 : 1));

    subscription.status = "active";
    subscription.failedRenewalCount = 0;
    subscription.currentPeriodStart = periodStart;
    subscription.currentPeriodEnd = periodEnd;
    subscription.nextBillingAt = periodEnd;
    await subscription.save();
    return subscription;
  },

  async cancel(razorpaySubscriptionId) {
    return Subscription.findOneAndUpdate(
      { razorpaySubscriptionId },
      { status: "cancelled", autoRenew: false },
      { returnDocument: "after" },
    );
  },
};

import Subscription from "../models/Subscription.js";

const planCatalog = {
  doctor_premium_monthly: { planName: "Doctor Premium Monthly", interval: "monthly", amount: 2999 },
  doctor_premium_yearly: { planName: "Doctor Premium Yearly", interval: "yearly", amount: 29999 },
};

export const subscriptionService = {
  getPlans() {
    return Object.entries(planCatalog).map(([planCode, plan]) => ({ planCode, ...plan }));
  },

  async createSubscription({ userId, doctorId, planCode }) {
    const plan = planCatalog[planCode];
    if (!plan) throw new Error("Invalid subscription plan");
    const now = new Date();
    const nextBillingAt = new Date(now);
    nextBillingAt.setMonth(nextBillingAt.getMonth() + (plan.interval === "yearly" ? 12 : 1));
    return Subscription.create({
      userId,
      doctorId,
      planCode,
      ...plan,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: nextBillingAt,
      nextBillingAt,
    });
  },

  async markCharged(razorpaySubscriptionId) {
    return Subscription.findOneAndUpdate(
      { razorpaySubscriptionId },
      { status: "active", failedRenewalCount: 0 },
      { returnDocument: "after" },
    );
  },

  async cancel(razorpaySubscriptionId) {
    return Subscription.findOneAndUpdate(
      { razorpaySubscriptionId },
      { status: "cancelled", autoRenew: false },
      { returnDocument: "after" },
    );
  },
};

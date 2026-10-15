import Subscription, { SUBSCRIPTION_STATUS } from "../models/Subscription.js";
import TransactionLedger from "../models/TransactionLedger.js";
import { paymentGateway } from "./paymentGateway.js";
import { toPaise } from "./money.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { logger } from "../utils/logger.js";
import { ACTIVATABLE_STATES, UNPAID_STATES, RENEWAL_STATES, computeNextPeriod } from "./subscriptionLifecycle.js";

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

  /**
   * F-001: starting a paid plan creates a PENDING intent plus a provider order.
   * Price comes only from the server catalog. Nothing is entitled until
   * activateFromCapture() runs after provider confirmation.
   */
  async createIntent({ userId, doctorId, planCode }) {
    const plan = planCatalog[planCode];
    if (!plan || !plan.purchasable) throw new AppError("Invalid subscription plan", 400);

    const alreadyEntitled = await Subscription.findOne({ userId, status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, ...RENEWAL_STATES] } }).lean();
    if (alreadyEntitled) throw new AppError("You already have an active subscription. Change plan or wait for renewal instead.", 409);

    // Reuse an open intent for the same plan so a double click / refresh never creates two orders.
    const open = await Subscription.findOne({ userId, planCode, status: { $in: [SUBSCRIPTION_STATUS.PENDING_PAYMENT, SUBSCRIPTION_STATUS.PAYMENT_PROCESSING] } });
    if (open?.gatewayOrderId) return { subscription: open, order: this.orderView(open), reused: true };

    const order = await paymentGateway.createOrder({
      amount: plan.amount,
      currency: "INR",
      receipt: `sub_${String(userId).slice(-10)}_${Date.now().toString(36)}`,
      notes: { module: "hms_subscription", planCode, userId: String(userId) },
    });
    const now = new Date();
    const subscription = await Subscription.create({
      userId,
      doctorId,
      planCode,
      planName: plan.planName,
      interval: plan.interval,
      amount: plan.amount,
      currency: "INR",
      status: SUBSCRIPTION_STATUS.PENDING_PAYMENT,
      pricingSnapshot: { planCode, planName: plan.planName, interval: plan.interval, amount: plan.amount, currency: "INR", capturedAt: now },
      gatewayOrderId: order.id,
      paymentHistory: [{ kind: "initial", gatewayOrderId: order.id, amount: plan.amount, currency: "INR", status: "created" }],
      stateHistory: [{ from: "none", to: SUBSCRIPTION_STATUS.PENDING_PAYMENT, source: "patient", reason: "Subscription intent created; awaiting provider payment", at: now }],
    });
    return { subscription, order, reused: false };
  },

  orderView(subscription) {
    return { id: subscription.gatewayOrderId, amount: toPaise(subscription.amount), currency: subscription.currency };
  },

  async findByGatewayOrder(gatewayOrderId) {
    return Subscription.findOne({ $or: [{ gatewayOrderId }, { "paymentHistory.gatewayOrderId": gatewayOrderId }] });
  },

  /**
   * Provider-confirmed capture -> activation. The conditional update is the capture
   * claim: only one caller (browser verify, webhook, recovery) can flip the state,
   * so a replay can never extend the period twice.
   */
  async activateFromCapture({ subscription, gatewayPaymentId, source = "system" }) {
    const isRenewal = RENEWAL_STATES.includes(subscription.status);
    const now = new Date();
    const { periodStart, periodEnd } = computeNextPeriod({ interval: subscription.interval, currentPeriodEnd: subscription.currentPeriodEnd, now, isRenewal });
    const claimed = await Subscription.findOneAndUpdate(
      { _id: subscription._id, status: { $in: ACTIVATABLE_STATES }, gatewayOrderId: subscription.gatewayOrderId },
      {
        $set: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          gatewayPaymentId,
          activatedAt: now,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          failedRenewalCount: 0,
          postProcessingState: "pending",
          "paymentHistory.$[order].status": "captured",
          "paymentHistory.$[order].gatewayPaymentId": gatewayPaymentId,
          "paymentHistory.$[order].settledAt": now,
        },
        $push: { stateHistory: { from: subscription.status, to: SUBSCRIPTION_STATUS.ACTIVE, source, reason: "Provider payment captured", at: now } },
      },
      { returnDocument: "after", arrayFilters: [{ "order.gatewayOrderId": subscription.gatewayOrderId }] },
    );
    if (!claimed) {
      const current = await Subscription.findById(subscription._id);
      return { subscription: current, activated: false };
    }
    return { subscription: claimed, activated: true };
  },

  /** Ledger + invoice for an activated payment. Idempotent; failure is recorded, not swallowed. */
  async completePostProcessing(subscription, { doctorUser } = {}) {
    try {
      try {
        await TransactionLedger.create({
          userId: subscription.userId,
          subscriptionId: subscription._id,
          type: "subscription_payment",
          direction: "debit",
          amount: subscription.amount,
          currency: subscription.currency,
          referenceId: subscription.gatewayPaymentId,
          idempotencyKey: `subscription:payment:${subscription.gatewayPaymentId}`,
          metadata: { planCode: subscription.planCode, gatewayOrderId: subscription.gatewayOrderId },
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
      const { createSubscriptionInvoiceRecord } = await import("../services/invoiceService.js");
      const invoice = await createSubscriptionInvoiceRecord({ subscription, doctorUser });
      await Subscription.updateOne({ _id: subscription._id }, { $set: { postProcessingState: "complete", invoiceId: invoice?._id }, $unset: { postProcessingError: "" } });
      const { financialEmails } = await import("../services/financialEmails.js");
      await financialEmails.subscriptionActivated({ subscription, user: doctorUser });
      return { complete: true, invoice };
    } catch (error) {
      await Subscription.updateOne({ _id: subscription._id }, { $set: { postProcessingState: "failed", postProcessingError: String(error?.message || error).slice(0, 300) } });
      logger.error("Subscription post-processing failed; marked for recovery", { subscriptionId: String(subscription._id), message: error?.message });
      return { complete: false, error };
    }
  },

  async markPaymentFailed({ subscription, gatewayPaymentId, reason, source = "system" }) {
    const toState = RENEWAL_STATES.includes(subscription.status) ? SUBSCRIPTION_STATUS.RENEWAL_FAILED : SUBSCRIPTION_STATUS.PAYMENT_FAILED;
    const updated = await Subscription.findOneAndUpdate(
      { _id: subscription._id, status: { $in: [...UNPAID_STATES, ...RENEWAL_STATES] }, gatewayOrderId: subscription.gatewayOrderId },
      {
        $set: { status: toState, "paymentHistory.$[order].status": "failed", "paymentHistory.$[order].failureReason": reason || "Payment failed", ...(gatewayPaymentId ? { "paymentHistory.$[order].gatewayPaymentId": gatewayPaymentId } : {}) },
        $push: { stateHistory: { from: subscription.status, to: toState, source, reason: reason || "Payment failed", at: new Date() } },
      },
      { returnDocument: "after", arrayFilters: [{ "order.gatewayOrderId": subscription.gatewayOrderId }] },
    );
    if (updated) {
      const { financeEmitter } = await import("../realtime/financeEmitter.js");
      financeEmitter.invalidate({ userIds: [updated.userId], domain: "subscription", entityId: updated._id });
      const { default: User } = await import("../models/User.js");
      const { financialEmails } = await import("../services/financialEmails.js");
      const user = await User.findById(updated.userId).select("name email").lean();
      await financialEmails.subscriptionPaymentFailed({ subscription: updated, user });
    }
    return updated;
  },

  /**
   * F-023: renewal never extends anything by itself. It opens a provider order the
   * doctor must pay; the paid period keeps running meanwhile. Atomic claim: only
   * one cron run / worker creates the order.
   */
  async openRenewalOrder(subscriptionId) {
    const claim = await Subscription.findOneAndUpdate(
      { _id: subscriptionId, status: SUBSCRIPTION_STATUS.ACTIVE, autoRenew: true, nextBillingAt: { $lte: new Date() } },
      { $set: { status: SUBSCRIPTION_STATUS.RENEWAL_PENDING }, $push: { stateHistory: { from: "active", to: SUBSCRIPTION_STATUS.RENEWAL_PENDING, source: "cron", reason: "Renewal due; awaiting provider payment", at: new Date() } } },
      { returnDocument: "after" },
    );
    if (!claim) return null;
    try {
      const order = await paymentGateway.createOrder({
        amount: claim.amount,
        currency: claim.currency,
        receipt: `renew_${String(claim._id).slice(-10)}_${Date.now().toString(36)}`,
        notes: { module: "hms_subscription", planCode: claim.planCode, renewal: "true" },
      });
      return Subscription.findOneAndUpdate(
        { _id: claim._id, status: SUBSCRIPTION_STATUS.RENEWAL_PENDING },
        { $set: { gatewayOrderId: order.id }, $push: { paymentHistory: { kind: "renewal", gatewayOrderId: order.id, amount: claim.amount, currency: claim.currency, status: "created" } } },
        { returnDocument: "after" },
      );
    } catch (error) {
      // Order creation failed: put it back so the next run retries. No entitlement change.
      await Subscription.updateOne({ _id: claim._id, status: SUBSCRIPTION_STATUS.RENEWAL_PENDING, gatewayOrderId: claim.gatewayOrderId }, { $set: { status: SUBSCRIPTION_STATUS.ACTIVE } });
      throw error;
    }
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
    // A4: there is no proration/charge for a mid-cycle swap, so a plan that costs MORE
    // would hand out unpaid entitlement. Only equal-or-cheaper swaps are allowed.
    if (plan.amount > subscription.amount) {
      throw new AppError("Moving to a higher-priced plan requires a new payment and is not available as a free plan swap", 409);
    }

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

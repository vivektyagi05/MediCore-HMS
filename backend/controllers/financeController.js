import mongoose from "mongoose";
import Coupon from "../models/Coupon.js";
import Doctor from "../models/Doctor.js";
import Payment from "../models/Payment.js";
import Subscription from "../models/Subscription.js";
import TransactionLedger from "../models/TransactionLedger.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { paymentGateway } from "../payments/paymentGateway.js";
import { couponService } from "../payments/couponService.js";
import { paymentRetryService } from "../payments/paymentRetryService.js";
import { reconciliationService } from "../payments/reconciliationService.js";
import { subscriptionService } from "../payments/subscriptionService.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import { writeAdminLog } from "../utils/adminAudit.js";
import { summarizeCouponUsage, validateCouponRules } from "../payments/couponRules.js";

const escapeRegex = (value) => value.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&");

const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const assertObjectId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
};

export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, appointmentId, amount } = req.body;
  if (!code || !appointmentId || !amount) {
    throw new AppError("Coupon code, appointment id, and amount are required", 400);
  }

  const result = await couponService.validateAndCalculate({
    code,
    userId: req.user._id,
    appointmentId,
    amount: Number(amount),
  });

  res.status(200).json({
    success: true,
    data: { discountAmount: result.discountAmount, coupon: result.coupon },
    message: "Coupon validated successfully",
  });
});

export const listCoupons = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = req.query.status === "inactive" ? { isActive: false } : req.query.status === "active" ? { isActive: true } : {};
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    filter.code = { $regex: `^${escapeRegex(req.query.search.trim().toUpperCase())}` };
  }

  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Coupon.countDocuments(filter),
  ]);
  // The list never ships the per-use entries (user/payment ids); it ships the server-computed summary.
  const rows = coupons.map(({ usedBy, ...rest }) => ({ ...rest, usage: summarizeCouponUsage({ ...rest, usedBy }) }));

  res.status(200).json({
    success: true,
    data: { coupons: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Coupons fetched successfully",
  });
});

export const getCouponUsage = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, "coupon id");
  const coupon = await Coupon.findById(req.params.id).lean();
  if (!coupon) throw new AppError("Coupon not found", 404);
  const history = await AdminActivityLog.find({ resourceType: "Coupon", resourceId: String(coupon._id) })
    .populate("actorId", "name email").sort({ createdAt: -1 }).limit(50).lean();
  res.status(200).json({
    success: true,
    data: {
      coupon: { _id: coupon._id, code: coupon.code, isActive: coupon.isActive, rejectedCount: coupon.rejectedCount || 0, lastRejectionCode: coupon.lastRejectionCode || null },
      usage: summarizeCouponUsage(coupon),
      entries: (coupon.usedBy || []).slice(-100).map((e) => ({ paymentId: e.paymentId, state: e.state || "legacy", usedAt: e.usedAt, redeemedAt: e.redeemedAt || null })),
      history: history.map((h) => ({ action: h.action, at: h.createdAt, actor: h.actorId ? { name: h.actorId.name, email: h.actorId.email } : null, metadata: h.metadata })),
    },
    message: "Coupon usage fetched successfully",
  });
});

const COUPON_EDITABLE = ["description", "value", "maxDiscount", "expiresAt", "usageLimit", "isActive"];

export const createCoupon = asyncHandler(async (req, res) => {
  const errors = validateCouponRules(req.body || {}, { isCreate: true });
  if (errors.length) throw new AppError(errors[0].message, 400, { code: "COUPON_VALIDATION", errors });
  const { code, type, value, expiresAt, usageLimit = 1 } = req.body;

  const coupon = await Coupon.create({
    code: String(code).trim(),
    description: req.body.description,
    type,
    value: Number(value),
    maxDiscount: req.body.maxDiscount ? Number(req.body.maxDiscount) : undefined,
    expiresAt,
    usageLimit: Number(usageLimit),
    userId: req.body.userId,
    appointmentId: req.body.appointmentId,
  });
  await writeAdminLog({ req, action: "coupon.created", resourceType: "Coupon", resourceId: String(coupon._id), metadata: { code: coupon.code, type: coupon.type, value: coupon.value, usageLimit: coupon.usageLimit, expiresAt: coupon.expiresAt } });

  res.status(201).json({
    success: true,
    data: { coupon },
    message: "Coupon created successfully",
  });
});

export const updateCoupon = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, "coupon id");
  const updates = COUPON_EDITABLE.reduce((acc, field) => {
    if (req.body[field] !== undefined) acc[field] = req.body[field];
    return acc;
  }, {});
  if (Object.keys(updates).length === 0) throw new AppError("No editable fields supplied", 400);

  const existing = await Coupon.findById(req.params.id).lean();
  if (!existing) throw new AppError("Coupon not found", 404);
  const errors = validateCouponRules(updates, { existing });
  if (errors.length) throw new AppError(errors[0].message, 400, { code: "COUPON_VALIDATION", errors });

  const coupon = await Coupon.findByIdAndUpdate(req.params.id, updates, { returnDocument: "after", runValidators: true });
  const before = {}; const after = {};
  for (const field of Object.keys(updates)) { before[field] = existing[field]; after[field] = coupon[field]; }
  await writeAdminLog({ req, action: "coupon.updated", resourceType: "Coupon", resourceId: String(coupon._id), metadata: { code: coupon.code, before, after } });

  res.status(200).json({
    success: true,
    data: { coupon },
    message: "Coupon updated successfully",
  });
});

export const getPlans = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: { plans: subscriptionService.getPlans() },
    message: "Subscription plans fetched successfully",
  });
});

export const getSubscriptions = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.SUPER_ADMIN ? {} : { userId: req.user._id };
  const subscriptions = await Subscription.find(filter).sort({ createdAt: -1 }).lean();

  res.status(200).json({
    success: true,
    data: { subscriptions },
    message: "Subscriptions fetched successfully",
  });
});

// F-001: starting a paid plan only opens a PENDING intent + provider order. The
// subscription is entitled/invoiced/ledgered only after verifySubscriptionPayment
// (or the webhook) confirms provider capture. Price is server-derived; the body
// carries only the plan code.
export const createSubscription = asyncHandler(async (req, res) => {
  const { planCode } = req.body;
  if (!planCode) throw new AppError("Plan code is required", 400);

  const doctor = req.user.role === ROLES.DOCTOR ? await Doctor.findOne({ userId: req.user._id }).lean() : null;
  const { subscription, order, reused } = await subscriptionService.createIntent({
    userId: req.user._id,
    doctorId: doctor?._id,
    planCode,
  });

  try {
    await practiceEmitter.subscriptionUpdated({
      doctorUserId: req.user._id,
      subscriptionId: subscription._id,
      status: subscription.status,
      planName: subscription.planName,
    });
  } catch (error) {
    logger.warn("practiceEmitter failed on subscription intent", { message: error?.message });
  }

  res.status(reused ? 200 : 201).json({
    success: true,
    data: { subscription, order, razorpayKeyId: paymentGateway.keyId(), gateway: paymentGateway.mode() },
    message: "Subscription payment order created. The plan is not active until payment is confirmed.",
  });
});

const finishSubscriptionActivation = async (subscription, { gatewayPaymentId, source, userId }) => {
  const { subscription: current, activated } = await subscriptionService.activateFromCapture({ subscription, gatewayPaymentId, source });
  const needsPosting = activated || current?.postProcessingState === "failed" || current?.postProcessingState === "pending";
  let invoice = null;
  if (current?.status === "active" && needsPosting) {
    const doctorUser = await User.findById(current.userId).select("name email").lean();
    const posted = await subscriptionService.completePostProcessing(current, { doctorUser });
    invoice = posted.invoice || null;
  }
  financeEmitter.invalidate({ userIds: [current?.userId], admin: true, domain: "subscription", entityId: subscription._id });
  if (activated) {
    try {
      await practiceEmitter.subscriptionUpdated({ doctorUserId: userId || current.userId, subscriptionId: current._id, status: current.status, planName: current.planName });
      if (invoice) await practiceEmitter.invoiceGenerated({ doctorUserId: userId || current.userId, invoiceId: invoice._id, totalAmount: invoice.totalAmount, currency: invoice.currency });
    } catch (error) {
      logger.warn("practiceEmitter failed on subscription activation", { message: error?.message });
    }
  }
  return Subscription.findById(subscription._id).lean();
};
export { finishSubscriptionActivation };

export const verifySubscriptionPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, paymentId, signature } = req.body;
  if (!razorpayOrderId || !paymentId || !signature) throw new AppError("Order id, payment id, and signature are required", 400);

  const subscription = await Subscription.findOne({ userId: req.user._id, $or: [{ gatewayOrderId: razorpayOrderId }, { "paymentHistory.gatewayOrderId": razorpayOrderId }] });
  if (!subscription) throw new AppError("Subscription order not found", 404);

  // Duplicate verification of an already-captured order is an idempotent read.
  const alreadyCaptured = subscription.paymentHistory.find((entry) => entry.gatewayOrderId === razorpayOrderId && entry.status === "captured");
  if (alreadyCaptured) {
    const current = await finishSubscriptionActivation(subscription, { gatewayPaymentId: alreadyCaptured.gatewayPaymentId, source: "patient", userId: req.user._id });
    return res.status(200).json({ success: true, data: { subscription: current }, message: "Subscription payment already confirmed" });
  }
  if (subscription.gatewayOrderId !== razorpayOrderId) throw new AppError("This payment order is no longer current", 409);

  if (!paymentGateway.verifyPaymentSignature({ razorpayOrderId, paymentId, signature })) {
    throw new AppError("Payment verification could not be confirmed. Check the subscription status again shortly.", 400);
  }
  let gatewayPayment;
  try {
    gatewayPayment = await paymentGateway.fetchPayment({ paymentId, orderId: razorpayOrderId, amount: subscription.amount, currency: subscription.currency });
  } catch {
    throw new AppError("Payment status could not be confirmed yet. Please check status again.", 503);
  }
  if (gatewayPayment?.order_id && gatewayPayment.order_id !== razorpayOrderId) throw new AppError("Payment order does not match this subscription", 400);
  const expectedPaise = toPaise(subscription.amount);
  const gatewayAmountPaise = gatewayPayment?.amount == null ? expectedPaise : Number(gatewayPayment.amount);
  const gatewayCurrency = String(gatewayPayment?.currency || subscription.currency).toUpperCase();
  if (gatewayAmountPaise !== expectedPaise || gatewayCurrency !== String(subscription.currency).toUpperCase()) {
    throw new AppError("Payment details could not be reconciled with this subscription. Please contact support.", 409);
  }
  const providerStatus = String(gatewayPayment?.status || "").toLowerCase();
  if (providerStatus === "failed") {
    await subscriptionService.markPaymentFailed({ subscription, gatewayPaymentId: paymentId, reason: "Provider reported failed payment", source: "gateway" });
    throw new AppError("Payment was not captured by the provider.", 402);
  }
  if (!["captured", "processed"].includes(providerStatus)) {
    return res.status(202).json({ success: true, data: { subscription }, message: "Payment is still pending confirmation from the provider" });
  }
  const current = await finishSubscriptionActivation(subscription, { gatewayPaymentId: paymentId, source: "patient", userId: req.user._id });
  res.status(200).json({ success: true, data: { subscription: current }, message: "Subscription activated successfully" });
});

// Authoritative status for refresh/recovery; never invents success.
export const getSubscriptionPaymentStatus = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({ userId: req.user._id, $or: [{ gatewayOrderId: req.params.gatewayOrderId }, { "paymentHistory.gatewayOrderId": req.params.gatewayOrderId }] }).lean();
  if (!subscription) throw new AppError("Subscription order not found", 404);
  res.status(200).json({ success: true, data: { subscription }, message: "Subscription status fetched" });
});

// Test gateway only: records a provider-style FAILED payment for the order so the
// failure path runs through the same markPaymentFailed state transition.
export const failTestSubscriptionPayment = asyncHandler(async (req, res) => {
  if (paymentGateway.mode() !== "test") throw new AppError("Test payment gateway is disabled", 404);
  const razorpayOrderId = typeof req.body?.razorpayOrderId === "string" ? req.body.razorpayOrderId.trim() : "";
  const subscription = razorpayOrderId ? await Subscription.findOne({ userId: req.user._id, gatewayOrderId: razorpayOrderId }) : null;
  if (!subscription) throw new AppError("Subscription order not found", 404);
  const updated = await subscriptionService.markPaymentFailed({ subscription, reason: "Test gateway: payment failed", source: "test-gateway" });
  if (!updated) throw new AppError("This subscription order is no longer payable", 409);
  res.status(200).json({ success: true, data: { subscription: updated }, message: "Test payment failure recorded" });
});

export const completeTestSubscriptionPayment = asyncHandler(async (req, res) => {
  if (paymentGateway.mode() !== "test") throw new AppError("Test payment gateway is disabled", 404);
  const razorpayOrderId = typeof req.body?.razorpayOrderId === "string" ? req.body.razorpayOrderId.trim() : "";
  if (!razorpayOrderId) throw new AppError("Order id is required", 400);
  const subscription = await Subscription.findOne({ userId: req.user._id, gatewayOrderId: razorpayOrderId });
  if (!subscription) throw new AppError("Subscription order not found", 404);
  if (!["pending_payment", "payment_processing", "payment_failed", "renewal_pending", "renewal_failed"].includes(subscription.status)) {
    throw new AppError("This subscription order is no longer payable", 409);
  }
  const response = paymentGateway.buildPaymentResponse(subscription.gatewayOrderId, `test_payment_${subscription._id.toString()}_${subscription.paymentHistory.length}`, subscription.amount, subscription.currency);
  res.status(200).json({ success: true, data: response, message: "Test gateway response generated" });
});

export const cancelSubscription = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, "subscription id");
  const filter = req.user.role === ROLES.SUPER_ADMIN
    ? { _id: req.params.id }
    : { _id: req.params.id, userId: req.user._id };

  const subscription = await Subscription.findOneAndUpdate(
    filter,
    { status: "cancelled", autoRenew: false },
    { returnDocument: "after" },
  );
  if (!subscription) throw new AppError("Subscription not found", 404);

  try {
    await practiceEmitter.subscriptionUpdated({
      doctorUserId: subscription.userId,
      subscriptionId: subscription._id,
      status: "cancelled",
      planName: subscription.planName,
    });
  } catch (error) {
    logger.warn("practiceEmitter failed on subscription cancel", { message: error?.message });
  }

  res.status(200).json({
    success: true,
    data: { subscription },
    message: "Subscription cancelled successfully",
  });
});

export const getLedger = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = req.user.role === ROLES.SUPER_ADMIN ? {} : { userId: req.user._id };

  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [ledger, total] = await Promise.all([
    TransactionLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    TransactionLedger.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { ledger, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Transaction ledger fetched successfully",
  });
});

// P23 BUG 2 FIX (Sections 2-16) — full rewrite of the wallet recharge
// lifecycle. AUDIT FINDING: the old flow was
//   create order -> Razorpay checkout -> handler() (success-only callback)
//   -> verify signature -> immediately credit wallet
// A valid signature only proves the checkout payload wasn't tampered with;
// it is not proof the provider actually captured the money. There was no
// dedicated model, no failure/pending/cancelled state, and nothing to
// recover from after a dismissed checkout or a dropped network call. This
// section replaces that with the real order->verification->capture->post
// lifecycle (Section 4) backed by WalletRecharge, reusing the exact
// signature -> fetchPayment -> order/amount/currency/status verification
// sequence paymentController.verifyPayment already uses for appointment
// payments (Section 30 — do not invent a second, differently-shaped
// verification path).
import WalletRecharge, { WALLET_RECHARGE_STATUS } from "../models/WalletRecharge.js";
import { appendWalletRechargeTransition } from "../payments/walletRechargeStateMachine.js";
import { financeEmitter } from "../realtime/financeEmitter.js";
import { toPaise } from "../payments/money.js";
import { createRechargeIntent, finishRechargePosting, flagRecharge, persistRechargeGuarded, settleRechargeFromProviderPayment, postRechargeCapture as postWalletRechargeCaptureShared } from "../payments/walletRechargeService.js";
const postWalletRechargeCapture = (recharge, opts) => postWalletRechargeCaptureShared(recharge, opts);

export const createWalletRechargeOrder = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 1) throw new AppError("Recharge amount must be at least INR 1", 400);
  // Money has at most 2 decimals: reject (never round) so the stored amount always equals the provider amount in paise.
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new AppError("Recharge amount can have at most 2 decimal places", 400);
  if (Math.round(amount * 100) > 10_000_000) throw new AppError("Recharge amount exceeds the allowed maximum", 400);

  // Phase 02: the recharge intent is persisted BEFORE the provider order exists.
  const { recharge, order } = await createRechargeIntent({ userId: req.user._id, amount });

  res.status(201).json({
    success: true,
    data: { order, recharge, razorpayKeyId: paymentGateway.keyId(), gateway: paymentGateway.mode() },
    message: "Wallet recharge order created successfully",
  });
});

// Section 7 — the Razorpay checkout modal was dismissed (or the user
// closed the tab) before a success/failure callback ever fired. The
// recharge attempt/order must be preserved so it can be recovered or
// safely retried later (Section 8) — never silently lost, never credited.
export const cancelWalletRecharge = asyncHandler(async (req, res) => {
  const { gatewayOrderId } = req.body;
  if (!gatewayOrderId) throw new AppError("Gateway order id is required", 400);

  const recharge = await WalletRecharge.findOne({ userId: req.user._id, gatewayOrderId });
  if (!recharge) throw new AppError("Recharge order not found", 404);

  // Only a still-open recharge can be marked cancelled by the client. If it
  // already reached captured/posted (e.g. the webhook/verify call raced
  // ahead of the dismiss event), never let a late "cancelled" report
  // override a real successful capture.
  if ([WALLET_RECHARGE_STATUS.CAPTURED, WALLET_RECHARGE_STATUS.POSTED].includes(recharge.status)) {
    return res.status(200).json({ success: true, data: { recharge }, message: "Recharge already completed" });
  }
  if (recharge.status === WALLET_RECHARGE_STATUS.CANCELLED) {
    return res.status(200).json({ success: true, data: { recharge }, message: "Recharge already cancelled" });
  }

  appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.CANCELLED, {
    actorId: req.user._id, source: "patient", reason: "Checkout dismissed by patient",
  });
  const cancelled = await persistRechargeGuarded(recharge, { attempt: { completedAt: new Date(), outcome: "cancelled" } });
  if (!cancelled) {
    // A capture won the race; never let a late "cancelled" override it.
    const current = await WalletRecharge.findById(recharge._id);
    return res.status(200).json({ success: true, data: { recharge: current }, message: "Recharge already completed" });
  }

  res.status(200).json({ success: true, data: { recharge: cancelled }, message: "Recharge cancelled" });
});

// Section 8/15 — recovery. Lets the frontend re-check a recharge's real
// authoritative status after a refresh, a closed checkout, or a callback
// that never reached the browser (network failure). Never fabricates a
// result: if the provider itself cannot be reached, the recharge is left
// exactly where it was and flagged for reconciliation rather than guessed.
export const getWalletRechargeStatus = asyncHandler(async (req, res) => {
  const { gatewayOrderId } = req.params;
  const recharge = await WalletRecharge.findOne({ userId: req.user._id, gatewayOrderId });
  if (!recharge) throw new AppError("Recharge order not found", 404);

  const terminal = [
    WALLET_RECHARGE_STATUS.POSTED,
    WALLET_RECHARGE_STATUS.FAILED,
    WALLET_RECHARGE_STATUS.CANCELLED,
    WALLET_RECHARGE_STATUS.EXPIRED,
  ];
  if (terminal.includes(recharge.status) || !recharge.gatewayPaymentId) {
    return res.status(200).json({ success: true, data: { recharge }, message: "Recharge status fetched" });
  }

  // Still open with a known gateway payment id (e.g. verification_pending
  // from a prior failed lookup, or reconciliation_required) — re-fetch the
  // authoritative provider state rather than leaving the patient stuck.
  try {
    const gatewayPayment = await paymentGateway.fetchPayment({
      paymentId: recharge.gatewayPaymentId,
      orderId: recharge.gatewayOrderId,
      amount: recharge.amount,
      currency: recharge.currency,
    });
    const status = String(gatewayPayment?.status || "").toLowerCase();
    if (["captured", "processed"].includes(status)) {
      await postWalletRechargeCapture(recharge, { gatewayPaymentId: recharge.gatewayPaymentId, actorId: req.user._id, source: "recovery" });
    } else if (["failed"].includes(status)) {
      await settleRechargeFromProviderPayment({ recharge, entity: { id: recharge.gatewayPaymentId, status: "failed", order_id: recharge.gatewayOrderId }, source: "recovery" });
    }
    // Any other provider status (created/authorized) genuinely means "still
    // pending" — leave the recharge exactly as-is, do not guess.
  } catch {
    // Provider unreachable — leave state untouched, this is not evidence of
    // failure, just an inconclusive check.
  }

  res.status(200).json({ success: true, data: { recharge }, message: "Recharge status fetched" });
});

// Section 14 — recharge history, so the wallet page can distinguish
// successful / pending / failed / cancelled recharges instead of the
// ledger alone (which only ever showed successful credits).
export const listWalletRecharges = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { userId: req.user._id };
  const [recharges, total] = await Promise.all([
    WalletRecharge.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    WalletRecharge.countDocuments(filter),
  ]);
  res.status(200).json({
    success: true,
    data: { recharges, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Wallet recharge history fetched successfully",
  });
});

// Capture/credit pipeline lives in payments/walletRechargeService.js (one pipeline
// for verify, webhook, status polling and recovery).
export const verifyWalletRecharge = asyncHandler(async (req, res) => {
  const { razorpayOrderId, paymentId, signature } = req.body;
  if (!razorpayOrderId || !paymentId || !signature) {
    throw new AppError("Razorpay order id, payment id, and signature are required", 400);
  }

  const recharge = await WalletRecharge.findOne({ userId: req.user._id, gatewayOrderId: razorpayOrderId }).select("+signature");
  if (!recharge) throw new AppError("Recharge order not found", 404);

  if (recharge.status === WALLET_RECHARGE_STATUS.POSTED) {
    const wallet = await Wallet.findOne({ userId: req.user._id }).lean();
    return res.status(200).json({ success: true, data: { wallet, recharge }, message: "Wallet recharge already completed" });
  }
  if (recharge.status === WALLET_RECHARGE_STATUS.CAPTURED) {
    // Capture already claimed (concurrent verify/webhook, or a crash before posting):
    // finish the idempotent credit pipeline instead of re-claiming.
    const result = await finishRechargePosting(recharge, { actorId: req.user._id, source: "patient" });
    const wallet = result.wallet || (await Wallet.findOne({ userId: req.user._id }).lean());
    return res.status(200).json({ success: true, data: { wallet, recharge: result.recharge }, message: "Wallet recharge completed successfully" });
  }

  // Step 1 — signature verification (Section 5). A failure here does NOT
  // mean the payment failed — it means we cannot yet trust this callback,
  // so the recharge goes to verification_pending/reconciliation, never a
  // silent credit and never a false "failed" (Section 39).
  const validSignature = paymentGateway.verifyPaymentSignature({ razorpayOrderId, paymentId, signature });
  if (!validSignature) {
    appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.VERIFICATION_PENDING, {
      actorId: req.user._id, source: "patient", reason: "Gateway signature verification failed; authoritative state requires review",
    });
    await persistRechargeGuarded(recharge, { set: { reconciliationState: "required" } });
    throw new AppError("Recharge verification could not be confirmed. Your payment status is being checked.", 400);
  }

  // Step 2 — fetch the actual provider payment state (Section 5). This is
  // the exact fix for Bug 2: a valid signature alone must never be treated
  // as "money definitely captured".
  let gatewayPayment;
  try {
    gatewayPayment = await paymentGateway.fetchPayment({
      paymentId, orderId: razorpayOrderId, amount: recharge.amount, currency: recharge.currency,
    });
  } catch {
    appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.VERIFICATION_PENDING, {
      actorId: req.user._id, source: "gateway", reason: "Gateway payment lookup failed",
    });
    await persistRechargeGuarded(recharge, { set: { reconciliationState: "required", gatewayPaymentId: paymentId } });
    throw new AppError("Payment status could not be confirmed yet. Please check status again.", 503);
  }

  // Steps 3-5 — order match, amount match, currency match (Section 5).
  const expectedPaise = toPaise(recharge.amount);
  const gatewayAmountPaise = Number(gatewayPayment?.amount);
  const gatewayCurrency = typeof gatewayPayment?.currency === "string" ? gatewayPayment.currency.trim().toUpperCase() : "";
  const providerSaysCaptured = ["captured", "processed"].includes(String(gatewayPayment?.status || "").toLowerCase());
  if (providerSaysCaptured && (!Number.isInteger(gatewayAmountPaise) || gatewayAmountPaise <= 0 || gatewayCurrency.length !== 3)) {
    // Never fabricate a missing provider amount/currency from our own record.
    await flagRecharge(recharge, "Provider capture is missing amount or currency", { gatewayPaymentId: paymentId });
    throw new AppError("Recharge details could not be reconciled. Please contact support.", 409);
  }
  if (gatewayPayment?.order_id && gatewayPayment.order_id !== razorpayOrderId) {
    throw new AppError("Payment order does not match this recharge", 400);
  }
  if (providerSaysCaptured && (gatewayAmountPaise !== expectedPaise || gatewayCurrency !== recharge.currency.toUpperCase())) {
    await flagRecharge(recharge, "Gateway amount or currency did not match authoritative recharge", { gatewayPaymentId: paymentId });
    throw new AppError("Recharge details could not be reconciled. Please contact support.", 409);
  }

  // Step 6 — provider status check (Section 5/6). Only captured/processed
  // may proceed to financial posting. Every other real provider outcome
  // gets its own honest state, never a blind credit.
  const providerStatus = String(gatewayPayment?.status || "").toLowerCase();
  if (!["captured", "processed"].includes(providerStatus)) {
    const pendingAttempt = { completedAt: new Date(), outcome: providerStatus === "failed" ? "failed" : "unknown", gatewayPaymentId: paymentId, failureReason: `Gateway payment status: ${providerStatus}` };
    if (providerStatus === "failed") {
      // CAS from OPEN states only: a concurrent capture (webhook) is never overwritten by a stale save().
      await settleRechargeFromProviderPayment({ recharge, entity: { id: paymentId, status: "failed", order_id: razorpayOrderId }, source: "gateway" });
      throw new AppError("Payment was not captured by the provider.", 402);
    }
    // created/authorized/pending — genuinely still in flight, not a
    // failure. Leave it as pending and let recovery/polling resolve it.
    appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.PENDING, {
      actorId: req.user._id, source: "gateway", reason: `Gateway payment status: ${providerStatus}`,
    });
    const pending = await persistRechargeGuarded(recharge, { set: { gatewayPaymentId: paymentId }, attempt: pendingAttempt });
    return res.status(202).json({ success: true, data: { recharge: pending || (await WalletRecharge.findById(recharge._id)) }, message: "Payment is still pending confirmation from the provider" });
  }

  await persistRechargeGuarded(recharge, { transitioned: false, set: { gatewayPaymentId: paymentId, signature } });

  const result = await postWalletRechargeCapture(recharge, { gatewayPaymentId: paymentId, actorId: req.user._id, source: "patient" });

  res.status(200).json({
    success: true,
    data: { wallet: result.wallet, recharge: result.recharge },
    message: "Wallet recharge completed successfully",
  });
});

export const retryDuePayments = asyncHandler(async (_req, res) => {
  const results = await paymentRetryService.retryDuePayments();
  res.status(200).json({
    success: true,
    data: { retried: results.filter(Boolean).length },
    message: "Due payment retries processed successfully",
  });
});

export const getReconciliationReport = asyncHandler(async (_req, res) => {
  const report = await reconciliationService.generateReport();
  const incompletePayments = await reconciliationService.findIncompletePayments();
  res.status(200).json({
    success: true,
    data: { report, incompletePayments },
    message: "Reconciliation report generated successfully",
  });
});

// Manually trigger the same idempotent repair the nightly cron runs, for
// captured payments that never finished generating an invoice/payout because
// a downstream step failed after the money was already taken.
export const repairIncompletePayments = asyncHandler(async (_req, res) => {
  const results = await reconciliationService.repairIncompletePayments();
  res.status(200).json({
    success: true,
    data: { results, repaired: results.filter((r) => r.repaired).length },
    message: "Reconciliation repair completed",
  });
});

// ─── Admin: Doctor Payout Settlement ──────────────────────────────────────────
import DoctorPayout from "../models/DoctorPayout.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

export const listDoctorPayouts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.doctorId) filter.doctorId = req.query.doctorId;

  const [payouts, total] = await Promise.all([
    DoctorPayout.find(filter)
      .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
      .populate("appointmentId", "date timeSlot")
      .populate("paymentId", "totalAmount currency paidAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    DoctorPayout.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { payouts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Doctor payouts fetched successfully",
  });
});

export const settleDoctorPayout = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, "payout id");

  const payout = await DoctorPayout.findById(req.params.id)
    .populate({ path: "doctorId", populate: { path: "userId", select: "_id name email" } });

  if (!payout) throw new AppError("Payout record not found", 404);
  if (payout.status === "paid") throw new AppError("Payout has already been settled", 409);
  if (payout.status === "cancelled") throw new AppError("Payout is cancelled and cannot be settled", 400);

  payout.status = "paid";
  payout.paidAt = new Date();
  payout.settledBy = req.user._id;
  await payout.save();

  // AUDIT FINDING (Phase UI-7): payout settlement moves real money and was
  // never written to AdminActivityLog — every other financial admin action
  // (refund approve/reject/retry) already is. Additive fix so the Finance
  // Activity Timeline (financeAggregates.js) has a real event for this.
  try {
    await writeAdminLog({
      req,
      action: "payout.settled",
      resourceType: "DoctorPayout",
      resourceId: payout._id.toString(),
      severity: "info",
      metadata: { doctorAmount: payout.doctorAmount, doctorId: payout.doctorId?._id?.toString() },
    });
  } catch (error) {
    logger.warn("Admin activity log write failed for payout settlement", { message: error?.message, payoutId: payout._id });
  }

  // Notify the doctor about settlement
  try {
    if (payout.doctorId?.userId?._id) {
      await notificationEmitter.emitToUser(payout.doctorId.userId._id, {
        // BUGFIX (Phase DOC-02 Smart Inbox audit): typed "appointment" despite
        // entityType already correctly saying "payout" — mislabeled this under
        // the wrong Smart Inbox category (Appointments instead of Payments).
        type: "payout",
        title: "Earnings settled",
        message: `₹${payout.doctorAmount} has been settled to your account.`,
        entityType: "payout",
        entityId: payout._id,
        severity: "success",
        eventKey: `payout:${payout._id}:settled`,
      });
    }
  } catch (error) {
    logger.warn("Payout-settled notification failed", { message: error?.message, payoutId: payout._id });
  }

  res.status(200).json({
    success: true,
    data: { payout },
    message: "Doctor payout settled successfully",
  });
});

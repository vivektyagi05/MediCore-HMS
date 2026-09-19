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
import { createSubscriptionInvoiceRecord } from "../services/invoiceService.js";
import { practiceEmitter } from "../realtime/practiceEmitter.js";

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
  const filter = req.query.status === "inactive" ? { isActive: false } : {};

  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Coupon.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { coupons, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Coupons fetched successfully",
  });
});

export const createCoupon = asyncHandler(async (req, res) => {
  const { code, type, value, expiresAt, usageLimit = 1 } = req.body;
  if (!code || !type || !value || !expiresAt) {
    throw new AppError("Code, type, value, and expiry date are required", 400);
  }

  const coupon = await Coupon.create({
    code,
    description: req.body.description,
    type,
    value: Number(value),
    maxDiscount: req.body.maxDiscount ? Number(req.body.maxDiscount) : undefined,
    expiresAt,
    usageLimit: Number(usageLimit),
    userId: req.body.userId,
    appointmentId: req.body.appointmentId,
  });

  res.status(201).json({
    success: true,
    data: { coupon },
    message: "Coupon created successfully",
  });
});

export const updateCoupon = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, "coupon id");
  const allowed = ["description", "value", "maxDiscount", "expiresAt", "usageLimit", "isActive"];
  const updates = allowed.reduce((acc, field) => {
    if (req.body[field] !== undefined) acc[field] = req.body[field];
    return acc;
  }, {});

  const coupon = await Coupon.findByIdAndUpdate(req.params.id, updates, { returnDocument: "after", runValidators: true });
  if (!coupon) throw new AppError("Coupon not found", 404);

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

export const createSubscription = asyncHandler(async (req, res) => {
  const { planCode } = req.body;
  if (!planCode) throw new AppError("Plan code is required", 400);

  const doctor = req.user.role === ROLES.DOCTOR ? await Doctor.findOne({ userId: req.user._id }).lean() : null;
  const subscription = await subscriptionService.createSubscription({
    userId: req.user._id,
    doctorId: doctor?._id,
    planCode,
  });

  await TransactionLedger.create({
    userId: req.user._id,
    subscriptionId: subscription._id,
    type: "subscription",
    direction: "debit",
    amount: subscription.amount,
    currency: subscription.currency,
    referenceId: subscription._id.toString(),
    idempotencyKey: `subscription:create:${subscription._id}`,
    metadata: { planCode },
  });

  // Subscription Intelligence (Phase D4): previously no invoice or
  // notification was ever generated for a subscription payment, unlike
  // appointment payments which always got both.
  let invoice = null;
  try {
    const doctorUser = await User.findById(req.user._id).select("name email").lean();
    invoice = await createSubscriptionInvoiceRecord({ subscription, doctorUser });
  } catch (error) {
    logger.warn("createSubscriptionInvoiceRecord failed on subscription create", { message: error?.message });
  }

  try {
    await practiceEmitter.subscriptionUpdated({
      doctorUserId: req.user._id,
      subscriptionId: subscription._id,
      status: "active",
      planName: subscription.planName,
    });
    if (invoice) {
      await practiceEmitter.invoiceGenerated({
        doctorUserId: req.user._id,
        invoiceId: invoice._id,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
      });
    }
  } catch (error) {
    logger.warn("practiceEmitter failed on subscription create", { message: error?.message });
  }

  res.status(201).json({
    success: true,
    data: { subscription, invoice },
    message: "Subscription activated successfully",
  });
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
import { toPaise } from "../payments/money.js";

export const createWalletRechargeOrder = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount < 1) throw new AppError("Recharge amount must be at least INR 1", 400);

  const order = await paymentGateway.createOrder({
    amount,
    currency: "INR",
    receipt: `wallet_${req.user._id.toString().slice(-10)}_${Date.now()}`,
    notes: { userId: req.user._id.toString(), module: "hms_wallet_recharge" },
  });

  const recharge = new WalletRecharge({
    userId: req.user._id,
    amount,
    currency: "INR",
    gatewayOrderId: order.id,
    status: WALLET_RECHARGE_STATUS.CREATED,
  });
  appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.ORDER_CREATED, {
    actorId: req.user._id, source: "patient", reason: "Gateway order created",
  });
  await recharge.save();

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
  recharge.attempts.push({ completedAt: new Date(), outcome: "cancelled" });
  await recharge.save();

  res.status(200).json({ success: true, data: { recharge }, message: "Recharge cancelled" });
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
      appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.FAILED, {
        actorId: req.user._id, source: "recovery", reason: `Gateway payment status: ${status}`,
      });
      recharge.failureReason = `Gateway payment status: ${status}`;
      await recharge.save();
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

// Shared atomic capture step (idempotent — Section 9). Only ever called
// once the caller has already confirmed authoritative provider capture.
// Uses the recharge document's own status field as the concurrency mutex,
// same pattern as the pre-existing pending->posted fix this replaces:
// only the request that wins the atomic order_created/pending/etc ->
// captured transition proceeds to credit the wallet; everything else
// (concurrent duplicate verify call, webhook racing the sync call) is
// answered idempotently from the already-captured/posted state.
const postWalletRechargeCapture = async (rechargeDoc, { gatewayPaymentId, actorId, source }) => {
  const claimed = await WalletRecharge.findOneAndUpdate(
    {
      _id: rechargeDoc._id,
      status: { $in: [WALLET_RECHARGE_STATUS.ORDER_CREATED, WALLET_RECHARGE_STATUS.CHECKOUT_STARTED, WALLET_RECHARGE_STATUS.PENDING, WALLET_RECHARGE_STATUS.VERIFICATION_PENDING, WALLET_RECHARGE_STATUS.RECONCILIATION_REQUIRED] },
    },
    {
      $set: { status: WALLET_RECHARGE_STATUS.CAPTURED, gatewayPaymentId, reconciliationState: "matched" },
      $push: { stateHistory: { from: rechargeDoc.status, to: WALLET_RECHARGE_STATUS.CAPTURED, actorId, source, reason: "Gateway payment captured", at: new Date() } },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    // Lost the race or genuinely already posted — return the current
    // authoritative document rather than crediting a second time.
    const current = await WalletRecharge.findById(rechargeDoc._id);
    return current;
  }

  // Ledger + wallet credit, atomic and idempotent via a unique
  // idempotencyKey keyed on this recharge's own _id (never the mutable
  // gatewayPaymentId) — a duplicate call after this point can only ever
  // hit the unique-index conflict below, never double-post.
  let ledgerEntry;
  try {
    ledgerEntry = await TransactionLedger.create({
      userId: claimed.userId,
      type: "wallet_credit",
      direction: "credit",
      amount: claimed.amount,
      currency: claimed.currency,
      status: "posted",
      referenceId: gatewayPaymentId,
      idempotencyKey: `wallet:recharge:${claimed._id.toString()}`,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // Ledger row already posted by a concurrent winner of a prior race
      // window — treat as the benign idempotent no-op it is.
      ledgerEntry = await TransactionLedger.findOne({ idempotencyKey: `wallet:recharge:${claimed._id.toString()}` }).lean();
    } else {
      throw error;
    }
  }

  const wallet = await Wallet.findOneAndUpdate(
    { userId: claimed.userId },
    {
      $setOnInsert: { userId: claimed.userId, currency: claimed.currency },
      $inc: { balance: claimed.amount },
      $push: {
        transactions: {
          type: "credit",
          amount: claimed.amount,
          currency: claimed.currency,
          status: "completed",
          referenceType: "payment",
          referenceId: gatewayPaymentId,
          description: "Wallet recharge",
        },
      },
    },
    { returnDocument: "after", upsert: true },
  );

  appendWalletRechargeTransition(claimed, WALLET_RECHARGE_STATUS.POSTED, {
    actorId, source, reason: "Wallet credited and ledger posted",
  });
  claimed.ledgerEntryId = ledgerEntry?._id;
  claimed.attempts.push({ completedAt: new Date(), outcome: "captured", gatewayPaymentId });
  await claimed.save();

  return { recharge: claimed, wallet, ledger: ledgerEntry };
};

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
    // Race with a concurrent verify/webhook call that already claimed
    // capture but hasn't finished posting — retry the same atomic step,
    // which is itself idempotent, rather than erroring.
    const result = await postWalletRechargeCapture(recharge, { gatewayPaymentId: paymentId, actorId: req.user._id, source: "patient" });
    const wallet = result.wallet || (await Wallet.findOne({ userId: req.user._id }).lean());
    return res.status(200).json({ success: true, data: { wallet, recharge: result.recharge || result }, message: "Wallet recharge completed successfully" });
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
    recharge.reconciliationState = "required";
    await recharge.save();
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
    recharge.reconciliationState = "required";
    recharge.gatewayPaymentId = paymentId;
    await recharge.save();
    throw new AppError("Payment status could not be confirmed yet. Please check status again.", 503);
  }

  // Steps 3-5 — order match, amount match, currency match (Section 5).
  const expectedPaise = toPaise(recharge.amount);
  const gatewayAmountPaise = gatewayPayment?.amount == null ? expectedPaise : Number(gatewayPayment.amount);
  const gatewayCurrency = String(gatewayPayment?.currency || recharge.currency).toUpperCase();
  if (gatewayPayment?.order_id && gatewayPayment.order_id !== razorpayOrderId) {
    throw new AppError("Payment order does not match this recharge", 400);
  }
  if (gatewayAmountPaise !== expectedPaise || gatewayCurrency !== recharge.currency.toUpperCase()) {
    appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.RECONCILIATION_REQUIRED, {
      actorId: req.user._id, source: "gateway", reason: "Gateway amount or currency did not match authoritative recharge",
    });
    recharge.gatewayPaymentId = paymentId;
    await recharge.save();
    throw new AppError("Recharge details could not be reconciled. Please contact support.", 409);
  }

  // Step 6 — provider status check (Section 5/6). Only captured/processed
  // may proceed to financial posting. Every other real provider outcome
  // gets its own honest state, never a blind credit.
  const providerStatus = String(gatewayPayment?.status || "").toLowerCase();
  if (!["captured", "processed"].includes(providerStatus)) {
    recharge.gatewayPaymentId = paymentId;
    recharge.attempts.push({ completedAt: new Date(), outcome: providerStatus === "failed" ? "failed" : "unknown", gatewayPaymentId: paymentId, failureReason: `Gateway payment status: ${providerStatus}` });
    if (providerStatus === "failed") {
      appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.FAILED, {
        actorId: req.user._id, source: "gateway", reason: `Gateway payment status: ${providerStatus}`,
      });
      recharge.failureReason = `Gateway payment status: ${providerStatus}`;
      await recharge.save();
      throw new AppError("Payment was not captured by the provider.", 402);
    }
    // created/authorized/pending — genuinely still in flight, not a
    // failure. Leave it as pending and let recovery/polling resolve it.
    appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.PENDING, {
      actorId: req.user._id, source: "gateway", reason: `Gateway payment status: ${providerStatus}`,
    });
    await recharge.save();
    return res.status(202).json({ success: true, data: { recharge }, message: "Payment is still pending confirmation from the provider" });
  }

  recharge.gatewayPaymentId = paymentId;
  recharge.signature = signature;
  await recharge.save();

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
import { writeAdminLog } from "../utils/adminAudit.js";

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

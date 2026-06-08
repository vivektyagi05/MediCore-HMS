import mongoose from "mongoose";
import Coupon from "../models/Coupon.js";
import Doctor from "../models/Doctor.js";
import Payment from "../models/Payment.js";
import Subscription from "../models/Subscription.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import { ROLES } from "../constants/roles.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { razorpayService } from "../services/razorpayService.js";
import { couponService } from "../payments/couponService.js";
import { paymentRetryService } from "../payments/paymentRetryService.js";
import { reconciliationService } from "../payments/reconciliationService.js";
import { subscriptionService } from "../payments/subscriptionService.js";

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
  const filter = req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN ? {} : { userId: req.user._id };
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

  res.status(201).json({
    success: true,
    data: { subscription },
    message: "Subscription activated successfully",
  });
});

export const cancelSubscription = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, "subscription id");
  const filter = req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN
    ? { _id: req.params.id }
    : { _id: req.params.id, userId: req.user._id };

  const subscription = await Subscription.findOneAndUpdate(
    filter,
    { status: "cancelled", autoRenew: false },
    { returnDocument: "after" },
  );
  if (!subscription) throw new AppError("Subscription not found", 404);

  res.status(200).json({
    success: true,
    data: { subscription },
    message: "Subscription cancelled successfully",
  });
});

export const getLedger = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN ? {} : { userId: req.user._id };

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

export const createWalletRechargeOrder = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount < 1) throw new AppError("Recharge amount must be at least INR 1", 400);

  const order = await razorpayService.createOrder({
    amount,
    currency: "INR",
    receipt: `wallet_${req.user._id.toString().slice(-10)}_${Date.now()}`,
    notes: { userId: req.user._id.toString(), module: "hms_wallet_recharge" },
  });

  await TransactionLedger.create({
    userId: req.user._id,
    type: "wallet_credit",
    direction: "credit",
    amount,
    currency: "INR",
    status: "pending",
    referenceId: order.id,
    idempotencyKey: `wallet:recharge:${order.id}`,
  });

  res.status(201).json({
    success: true,
    data: { order, razorpayKeyId: env.razorpayKeyId },
    message: "Wallet recharge order created successfully",
  });
});

export const verifyWalletRecharge = asyncHandler(async (req, res) => {
  const { razorpayOrderId, paymentId, signature } = req.body;
  if (!razorpayOrderId || !paymentId || !signature) {
    throw new AppError("Razorpay order id, payment id, and signature are required", 400);
  }

  const valid = razorpayService.verifyPaymentSignature({ razorpayOrderId, paymentId, signature });
  if (!valid) throw new AppError("Invalid recharge payment signature", 400);

  const ledger = await TransactionLedger.findOne({
    userId: req.user._id,
    referenceId: razorpayOrderId,
    type: "wallet_credit",
    status: "pending",
  });
  if (!ledger) throw new AppError("Recharge ledger entry not found", 404);

  const wallet = await Wallet.findOneAndUpdate(
    { userId: req.user._id },
    {
      $inc: { balance: ledger.amount },
      $push: {
        transactions: {
          type: "credit",
          amount: ledger.amount,
          currency: ledger.currency,
          status: "completed",
          referenceType: "payment",
          referenceId: paymentId,
          description: "Wallet recharge",
        },
      },
    },
    { returnDocument: "after", upsert: true },
  );

  ledger.status = "posted";
  ledger.walletId = wallet._id;
  ledger.referenceId = paymentId;
  ledger.metadata = { razorpayOrderId };
  await ledger.save();

  res.status(200).json({
    success: true,
    data: { wallet, ledger },
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
  res.status(200).json({
    success: true,
    data: { report },
    message: "Reconciliation report generated successfully",
  });
});

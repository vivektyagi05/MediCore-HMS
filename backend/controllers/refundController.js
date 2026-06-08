import mongoose from "mongoose";
import Payment, { PAYMENT_STATUS, REFUND_STATUS } from "../models/Payment.js";
import RefundRequest from "../models/RefundRequest.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ROLES } from "../constants/roles.js";
import { razorpayService } from "../services/razorpayService.js";
import { emailService } from "../services/emailService.js";
import { transactionLogger } from "../utils/transactionLogger.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";

const validatePaymentId = (paymentId) => {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new AppError("Invalid payment id", 400);
};

const processRefund = async ({ payment, refundAmount, reason, actorId, refundRequest }) => {
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.status !== PAYMENT_STATUS.CAPTURED && payment.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED) {
    throw new AppError("Only captured payments can be refunded", 400);
  }

  const refundableAmount = Number((payment.totalAmount - payment.refundedAmount).toFixed(2));

  if (refundAmount <= 0 || refundAmount > refundableAmount) {
    throw new AppError("Refund amount exceeds refundable balance", 400);
  }

  payment.refundStatus = REFUND_STATUS.PENDING;
  await payment.save();

  const refund = await razorpayService.refundPayment({
    paymentId: payment.paymentId,
    amount: refundAmount,
    notes: {
      reason,
      paymentRecordId: payment._id.toString(),
      refundRequestId: refundRequest?._id?.toString?.(),
    },
  });

  payment.refundedAmount = Number((payment.refundedAmount + refundAmount).toFixed(2));
  const isFullRefund = payment.refundedAmount >= payment.totalAmount;
  payment.refundStatus = isFullRefund ? REFUND_STATUS.FULL : REFUND_STATUS.PARTIAL;
  payment.status = isFullRefund ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  await payment.save();

  const wallet = await Wallet.findOneAndUpdate(
    { userId: payment.userId._id },
    {
      $inc: { balance: refundAmount },
      $push: {
        transactions: {
          type: "refund",
          amount: refundAmount,
          currency: payment.currency,
          status: "completed",
          referenceType: "refund",
          referenceId: refund.id,
          description: reason || "Appointment payment refund",
        },
      },
    },
    { returnDocument: "after", upsert: true },
  );

  await emailService.sendRefundConfirmation({
    patient: payment.userId,
    amount: refundAmount,
    currency: payment.currency,
  });

  await TransactionLedger.create({
    userId: payment.userId._id,
    paymentId: payment._id,
    walletId: wallet._id,
    type: "refund",
    direction: "credit",
    amount: refundAmount,
    currency: payment.currency,
    referenceId: refund.id,
    idempotencyKey: `refund:${refund.id}`,
    metadata: { reason, refundRequestId: refundRequest?._id },
  });

  if (refundRequest) {
    refundRequest.status = "processed";
    refundRequest.processedBy = actorId;
    refundRequest.razorpayRefundId = refund.id;
    refundRequest.timeline.push({
      status: "processed",
      note: "Refund processed through Razorpay and credited to wallet",
      actorId,
    });
    await refundRequest.save();
  }

  transactionLogger.refund("Refund processed", {
    paymentId: payment._id.toString(),
    refundId: refund.id,
    refundAmount,
  });

  await paymentEmitter.refundProcessed({ payment, refundRequest });

  return { payment, refund, wallet, refundRequest };
};

export const createRefundRequest = asyncHandler(async (req, res) => {
  validatePaymentId(req.params.paymentId);

  const payment = await Payment.findById(req.params.paymentId).populate("userId", "name email");
  if (!payment) throw new AppError("Payment not found", 404);
  if (req.user.role === ROLES.PATIENT && payment.userId._id.toString() !== req.user._id.toString()) {
    throw new AppError("You can only request refunds for your own payments", 403);
  }

  const refundableAmount = Number((payment.totalAmount - payment.refundedAmount).toFixed(2));
  const amount = req.body.amount ? Number(req.body.amount) : refundableAmount;
  if (amount <= 0 || amount > refundableAmount) throw new AppError("Refund amount exceeds refundable balance", 400);
  if (!req.body.reason) throw new AppError("Refund reason is required", 400);

  const duplicate = await RefundRequest.findOne({
    paymentId: payment._id,
    status: { $in: ["pending", "approved"] },
  }).lean();
  if (duplicate) throw new AppError("A refund request is already pending for this payment", 409);

  const refundRequest = await RefundRequest.create({
    paymentId: payment._id,
    requestedBy: req.user._id,
    amount,
    reason: req.body.reason,
    timeline: [{ status: "pending", note: "Refund request submitted", actorId: req.user._id }],
  });

  res.status(201).json({
    success: true,
    data: { refundRequest },
    message: "Refund request submitted successfully",
  });
});

export const listRefundRequests = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN
    ? {}
    : { requestedBy: req.user._id };

  if (req.query.status) filter.status = req.query.status;

  const refundRequests = await RefundRequest.find(filter)
    .populate("paymentId", "totalAmount refundedAmount currency status paymentId")
    .populate("requestedBy", "name email role")
    .populate("processedBy", "name email role")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.status(200).json({
    success: true,
    data: { refundRequests },
    message: "Refund requests fetched successfully",
  });
});

export const approveRefundRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);

  const refundRequest = await RefundRequest.findById(req.params.id);
  if (!refundRequest) throw new AppError("Refund request not found", 404);
  if (refundRequest.status !== "pending") throw new AppError("Only pending refund requests can be approved", 400);

  refundRequest.status = "approved";
  refundRequest.processedBy = req.user._id;
  refundRequest.timeline.push({ status: "approved", note: req.body.note || "Refund approved", actorId: req.user._id });
  await refundRequest.save();

  const payment = await Payment.findById(refundRequest.paymentId).populate("userId", "name email");
  const data = await processRefund({
    payment,
    refundAmount: refundRequest.amount,
    reason: refundRequest.reason,
    actorId: req.user._id,
    refundRequest,
  });

  res.status(200).json({
    success: true,
    data,
    message: "Refund processed successfully",
  });
});

export const rejectRefundRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid refund request id", 400);

  const refundRequest = await RefundRequest.findById(req.params.id);
  if (!refundRequest) throw new AppError("Refund request not found", 404);
  if (refundRequest.status !== "pending") throw new AppError("Only pending refund requests can be rejected", 400);

  refundRequest.status = "rejected";
  refundRequest.processedBy = req.user._id;
  refundRequest.timeline.push({ status: "rejected", note: req.body.note || "Refund rejected", actorId: req.user._id });
  await refundRequest.save();

  res.status(200).json({
    success: true,
    data: { refundRequest },
    message: "Refund request rejected successfully",
  });
});

export const initiateRefund = asyncHandler(async (req, res) => {
  validatePaymentId(req.params.paymentId);

  const payment = await Payment.findById(req.params.paymentId).populate("userId", "name email");
  if (!payment) throw new AppError("Payment not found", 404);
  const refundableAmount = Number((payment.totalAmount - payment.refundedAmount).toFixed(2));
  const refundAmount = req.body.amount ? Number(req.body.amount) : refundableAmount;
  const reason = req.body.reason || "Admin initiated HMS refund";

  const refundRequest = await RefundRequest.create({
    paymentId: payment._id,
    requestedBy: req.user._id,
    processedBy: req.user._id,
    amount: refundAmount,
    reason,
    status: "approved",
    timeline: [{ status: "approved", note: "Admin direct refund approved", actorId: req.user._id }],
  });

  const data = await processRefund({ payment, refundAmount, reason, actorId: req.user._id, refundRequest });

  res.status(200).json({
    success: true,
    data,
    message: "Refund processed successfully",
  });
});

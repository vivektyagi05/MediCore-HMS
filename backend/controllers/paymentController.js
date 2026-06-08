import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Coupon from "../models/Coupon.js";
import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import Subscription from "../models/Subscription.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ROLES } from "../constants/roles.js";
import { razorpayService } from "../services/razorpayService.js";
import { calculateInvoiceAmounts, invoiceService } from "../services/invoiceService.js";
import { emailService } from "../services/emailService.js";
import { transactionLogger } from "../utils/transactionLogger.js";
import { env } from "../config/env.js";
import { PAYMENT_STATUS as APPOINTMENT_PAYMENT_STATUS } from "../constants/appointmentStatus.js";
import { couponService } from "../payments/couponService.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";

const ensureObjectId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
};

const populateAppointment = (query) =>
  query
    .populate("patientId", "name email role")
    .populate({
      path: "doctorId",
      select: "specialization fees userId",
      populate: { path: "userId", select: "name email role" },
    });

export const createPaymentOrder = asyncHandler(async (req, res) => {
  const {
    appointmentId,
    couponCode,
    idempotencyKey,
    walletAmount = 0,
  } = req.body;
  ensureObjectId(appointmentId, "appointment id");

  const appointment = await populateAppointment(Appointment.findById(appointmentId));

  

  if (!appointment) throw new AppError("Appointment not found", 404);
    if (
    appointment.status ===
    APPOINTMENT_STATUS.CANCELLED
  ) {

    throw new AppError(
      "Cancelled appointments cannot be paid",
      400
    );
  }
  if ( appointment.status !== APPOINTMENT_STATUS.APPROVED) {
    throw new AppError(
      "Appointment must be approved before payment",
      400
    );
  }
  if (appointment.patientId._id.toString() !== req.user._id.toString()) {
    throw new AppError("You can only pay for your own appointments", 403);
  }
  if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID) {
    throw new AppError("Appointment is already paid", 409);
  }

  const existingPayment = await Payment.findOne({
    ...(idempotencyKey ? { idempotencyKey } : { appointmentId, userId: req.user._id }),
    status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CAPTURED] },
  }).lean();

  if (existingPayment) {
    if (idempotencyKey && existingPayment.idempotencyKey === idempotencyKey && existingPayment.status !== PAYMENT_STATUS.CAPTURED) {
      return res.status(200).json({
        success: true,
        data: {
          payment: existingPayment,
          order: {
            id: existingPayment.razorpayOrderId,
            amount: Math.round((existingPayment.gatewayAmount || existingPayment.totalAmount) * 100),
            currency: existingPayment.currency,
          },
          razorpayKeyId: env.razorpayKeyId,
        },
        message: "Existing payment order returned successfully",
      });
    }

    throw new AppError(
      existingPayment.status === PAYMENT_STATUS.CAPTURED
        ? "Payment has already been captured"
        : "A payment order is already active for this appointment",
      409,
    );
  }

  const baseAmounts = calculateInvoiceAmounts(appointment.doctorId.fees);
  const { coupon, discountAmount } = await couponService.validateAndCalculate({
    code: couponCode,
    userId: req.user._id,
    appointmentId: appointment._id,
    amount: baseAmounts.subtotal,
  });
  const taxableSubtotal = Number((baseAmounts.subtotal - discountAmount).toFixed(2));
  const taxAmount = Number((taxableSubtotal * 0.18).toFixed(2));
  const totalAmount = Number((taxableSubtotal + taxAmount).toFixed(2));
  const requestedWalletAmount = Math.max(Number(walletAmount) || 0, 0);
  const wallet = requestedWalletAmount
    ? await Wallet.findOneAndUpdate(
        { userId: req.user._id },
        { $setOnInsert: { userId: req.user._id, balance: 0, currency: "INR" } },
        { returnDocument: "after", upsert: true },
      )
    : null;
  const walletApplied = requestedWalletAmount
    ? Number(Math.min(requestedWalletAmount, wallet.balance, Math.max(totalAmount - 1, 0)).toFixed(2))
    : 0;
  const gatewayAmount = Number((totalAmount - walletApplied).toFixed(2));

  if (gatewayAmount < 1) {
    throw new AppError("A minimum payable gateway amount of INR 1 is required", 400);
  }

  const receipt = `appt_${appointment._id.toString().slice(-12)}`;
  const razorpayOrder = await razorpayService.createOrder({
    amount: gatewayAmount,
    currency: "INR",
    receipt,
    notes: {
      appointmentId: appointment._id.toString(),
      patientId: req.user._id.toString(),
      walletApplied: String(walletApplied),
      couponCode: couponCode || "",
      module: "hms_finance",
    },
  });

  const payment = await Payment.create({
    appointmentId: appointment._id,
    userId: req.user._id,
    doctorId: appointment.doctorId._id,
    amount: taxableSubtotal,
    discountAmount,
    couponId: coupon?._id,
    taxAmount,
    totalAmount,
    gatewayAmount,
    walletAmount: walletApplied,
    currency: "INR",
    status: PAYMENT_STATUS.CREATED,
    razorpayOrderId: razorpayOrder.id,
    idempotencyKey,
    metadata: {
      receipt,
      subscriptionReady: true,
      couponCode: couponCode || null,
      insuranceClaimId: null,
      hospitalId: "primary",
      baseAmount: baseAmounts.subtotal,
    },
  });

  transactionLogger.payment("Razorpay order created", {
    paymentId: payment._id.toString(),
    appointmentId: appointment._id.toString(),
    razorpayOrderId: razorpayOrder.id,
  });

  res.status(201).json({
    success: true,
    data: {
      payment,
      order: razorpayOrder,
      razorpayKeyId: env.razorpayKeyId,
    },
    message: "Payment order created successfully",
  });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, paymentId, signature } = req.body;

  if (!razorpayOrderId || !paymentId || !signature) {
    throw new AppError("Razorpay order id, payment id, and signature are required", 400);
  }

  const payment = await Payment.findOne({ razorpayOrderId }).select("+signature");
  if (!payment) throw new AppError("Payment order not found", 404);
  if (payment.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only verify your own payments", 403);
  }
  if (payment.status === PAYMENT_STATUS.CAPTURED) {
    throw new AppError("Payment has already been verified", 409);
  }

  const isValidSignature = razorpayService.verifyPaymentSignature({
    razorpayOrderId,
    paymentId,
    signature,
  });

  if (!isValidSignature) {
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failedAt = new Date();
    await payment.save();
    throw new AppError("Invalid payment signature", 400);
  }

  payment.paymentId = paymentId;
  payment.signature = signature;
  payment.status = PAYMENT_STATUS.CAPTURED;
  payment.paidAt = new Date();
  await payment.save();

  if (payment.walletAmount > 0) {
    const wallet = await Wallet.findOneAndUpdate(
      { userId: payment.userId, balance: { $gte: payment.walletAmount } },
      {
        $inc: { balance: -payment.walletAmount },
        $push: {
          transactions: {
            type: "payment",
            amount: payment.walletAmount,
            currency: payment.currency,
            status: "completed",
            referenceType: "payment",
            referenceId: payment._id.toString(),
            description: "Wallet contribution for appointment payment",
          },
        },
      },
      { returnDocument: "after" },
    );

    if (!wallet) {
      payment.status = PAYMENT_STATUS.FAILED;
      payment.failedAt = new Date();
      await payment.save();
      throw new AppError("Wallet balance changed before payment verification. Please contact support.", 409);
    }

    await TransactionLedger.create({
      userId: payment.userId,
      paymentId: payment._id,
      walletId: wallet._id,
      type: "wallet_debit",
      direction: "debit",
      amount: payment.walletAmount,
      currency: payment.currency,
      referenceId: payment._id.toString(),
      idempotencyKey: `wallet:debit:${payment._id}`,
      metadata: { appointmentId: payment.appointmentId },
    });
  }

  if (payment.couponId) {
    await couponService.markUsed({
      coupon: await Coupon.findById(payment.couponId),
      userId: payment.userId,
      paymentId: payment._id,
    });
    await TransactionLedger.create({
      userId: payment.userId,
      paymentId: payment._id,
      type: "coupon",
      direction: "credit",
      amount: payment.discountAmount,
      currency: payment.currency,
      referenceId: payment.couponId.toString(),
      idempotencyKey: `coupon:${payment._id}`,
      metadata: { couponId: payment.couponId },
    });
  }

  const appointment = await populateAppointment(
    Appointment.findByIdAndUpdate(
      payment.appointmentId,
      {
        paymentStatus:
          APPOINTMENT_PAYMENT_STATUS.PAID,

        paymentId: payment._id,

        paidAt: new Date(),
      },
      {
        returnDocument: "after",
      }
    )
  );

  const invoice = await invoiceService.createInvoice({ payment, appointment });
  payment.invoiceId = invoice._id;
  await payment.save();

  await Appointment.findByIdAndUpdate(
  appointment._id,
  {
    invoiceId: invoice._id,
  }
);

  await TransactionLedger.create({
    userId: payment.userId,
    paymentId: payment._id,
    type: "payment",
    direction: "debit",
    amount: payment.totalAmount,
    currency: payment.currency,
    referenceId: payment.paymentId,
    idempotencyKey: `payment:capture:${payment._id}`,
    metadata: {
      gatewayAmount: payment.gatewayAmount,
      walletAmount: payment.walletAmount,
      invoiceId: invoice._id,
    },
  });

  await emailService.sendPaymentReceipt({
    patient: appointment.patientId,
    invoice,
    pdfPath: invoice.pdfPath,
  });

  await paymentEmitter.captured({ payment, invoice });

  transactionLogger.payment("Payment verified and invoice generated", {
    paymentId: payment._id.toString(),
    invoiceId: invoice._id.toString(),
  });

  res.status(200).json({
    success: true,
    data: { payment, invoice },
    message: "Payment verified successfully",
  });
});

export const getPayments = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;
  const filter = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role) ? {} : { userId: req.user._id };

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("appointmentId", "date timeSlot status")
      .populate("userId", "name email role")
      .populate({
        path: "doctorId",
        select: "specialization userId",
        populate: { path: "userId", select: "name email role" },
      })
      .populate("invoiceId", "invoiceNumber totalAmount pdfPath issuedAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      payments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    message: "Payments fetched successfully",
  });
});

export const getFinancialSummary = asyncHandler(async (_req, res) => {
  const [summary, [walletSummary], [subscriptionSummary]] = await Promise.all([
    Payment.aggregate([
    {
      $group: {
        _id: null,
        totalEarnings: {
          $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.CAPTURED] }, "$totalAmount", 0] },
        },
        refundedAmount: { $sum: "$refundedAmount" },
        failedPayments: {
          $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.FAILED] }, 1, 0] },
        },
        capturedPayments: {
          $sum: { $cond: [{ $eq: ["$status", PAYMENT_STATUS.CAPTURED] }, 1, 0] },
        },
        totalPayments: { $sum: 1 },
      },
    },
    ]),
    Wallet.aggregate([{ $group: { _id: null, walletBalances: { $sum: "$balance" } } }]),
    Subscription.aggregate([
      {
        $group: {
          _id: null,
          recurringRevenue: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, "$amount", 0] },
          },
          activeSubscriptions: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const data = summary || {
    totalEarnings: 0,
    refundedAmount: 0,
    failedPayments: 0,
    capturedPayments: 0,
    totalPayments: 0,
  };
  data.walletBalances = walletSummary?.walletBalances || 0;
  data.recurringRevenue = subscriptionSummary?.recurringRevenue || 0;
  data.activeSubscriptions = subscriptionSummary?.activeSubscriptions || 0;
  data.successRatio = data.totalPayments
    ? Number(((data.capturedPayments / data.totalPayments) * 100).toFixed(2))
    : 0;

  res.status(200).json({
    success: true,
    data,
    message: "Financial summary fetched successfully",
  });
});

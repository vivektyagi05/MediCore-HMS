import mongoose from "mongoose";

export const PAYMENT_STATUS = Object.freeze({
  CREATED: "created",
  PENDING: "pending",
  CAPTURED: "captured",
  FAILED: "failed",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
});

export const REFUND_STATUS = Object.freeze({
  NONE: "none",
  PENDING: "pending",
  PARTIAL: "partial",
  FULL: "full",
  FAILED: "failed",
});

const paymentSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      index: true,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    gatewayAmount: {
      type: Number,
      min: 0,
    },
    walletAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
      uppercase: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.CREATED,
      index: true,
    },
    gateway: {
      type: String,
      default: "razorpay",
      index: true,
    },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    paymentId: {
      type: String,
      index: true,
    },
    signature: {
      type: String,
      select: false,
    },
    refundStatus: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.NONE,
      index: true,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    idempotencyKey: {
      type: String,
      index: true,
      sparse: true,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextRetryAt: Date,
    lockedAt: Date,
    paidAt: Date,
    failedAt: Date,
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.signature;
        delete ret.__v;
        return ret;
      },
    },
  },
);

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ appointmentId: 1, status: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;

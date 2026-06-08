import crypto from "crypto";
import Appointment from "../models/Appointment.js";
import Coupon from "../models/Coupon.js";
import Payment, { PAYMENT_STATUS, REFUND_STATUS } from "../models/Payment.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { env } from "../config/env.js";
import { PAYMENT_STATUS as APPOINTMENT_PAYMENT_STATUS } from "../constants/appointmentStatus.js";
import { emailService } from "../services/emailService.js";
import { invoiceService } from "../services/invoiceService.js";
import { couponService } from "./couponService.js";
import { paymentRetryService } from "./paymentRetryService.js";
import { subscriptionService } from "./subscriptionService.js";
import { paymentEmitter } from "../realtime/paymentEmitter.js";

const verifyWebhookSignature = (rawBody, signature) => {
  if (!env.razorpayWebhookSecret) return false;
  const expected = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const processEvent = async (event) => {
  const entity = event.payload?.payment?.entity || event.payload?.refund?.entity || event.payload?.subscription?.entity;
  switch (event.event) {
    case "payment.captured": {
      const payment = await Payment.findOneAndUpdate(
        { razorpayOrderId: entity.order_id },
        { status: PAYMENT_STATUS.CAPTURED, paymentId: entity.id, paidAt: new Date(entity.created_at * 1000) },
        { returnDocument: "after" },
      );
      if (payment) {
        const appointment = await Appointment.findByIdAndUpdate(
          payment.appointmentId,
          { paymentStatus: APPOINTMENT_PAYMENT_STATUS.PAID },
          { returnDocument: "after" },
        )
          .populate("patientId", "name email role")
          .populate({
            path: "doctorId",
            select: "specialization fees userId",
            populate: { path: "userId", select: "name email role" },
          });

        if (appointment && !payment.invoiceId) {
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

            if (wallet) {
              await TransactionLedger.create({
                userId: payment.userId,
                paymentId: payment._id,
                walletId: wallet._id,
                type: "wallet_debit",
                direction: "debit",
                amount: payment.walletAmount,
                currency: payment.currency,
                referenceId: payment._id.toString(),
                idempotencyKey: `webhook:wallet:debit:${payment._id}`,
              });
            }
          }

          if (payment.couponId) {
            await couponService.markUsed({
              coupon: await Coupon.findById(payment.couponId),
              userId: payment.userId,
              paymentId: payment._id,
            });
          }

          const invoice = await invoiceService.createInvoice({ payment, appointment });
          payment.invoiceId = invoice._id;
          await payment.save();
          await emailService.sendPaymentReceipt({
            patient: appointment.patientId,
            invoice,
            pdfPath: invoice.pdfPath,
          });
          await paymentEmitter.captured({ payment, invoice });
        }
      }
      break;
    }
    case "payment.failed": {
      const payment = await Payment.findOneAndUpdate(
        { razorpayOrderId: entity.order_id },
        { status: PAYMENT_STATUS.FAILED, failedAt: new Date() },
        { returnDocument: "after" },
      );
      if (payment) await paymentRetryService.scheduleFailedPayment(payment._id);
      break;
    }
    case "refund.processed":
      await Payment.findOneAndUpdate({ paymentId: entity.payment_id }, { refundStatus: REFUND_STATUS.PARTIAL, $inc: { refundedAmount: entity.amount / 100 } });
      break;
    case "refund.failed":
      await Payment.findOneAndUpdate({ paymentId: entity.payment_id }, { refundStatus: REFUND_STATUS.FAILED });
      break;
    case "subscription.charged":
      await subscriptionService.markCharged(entity.subscription_id);
      break;
    case "subscription.cancelled":
      await subscriptionService.cancel(entity.id);
      break;
    default:
      break;
  }
};

export const razorpayWebhookHandler = async (req, res, next) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body;
    if (!verifyWebhookSignature(rawBody, signature)) return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    const event = JSON.parse(rawBody.toString("utf8"));
    const entity = event.payload?.payment?.entity || event.payload?.refund?.entity || event.payload?.subscription?.entity;
    const eventId = `${event.event}:${entity?.id || event.created_at}`;
    const existing = await WebhookEvent.findOne({ eventId });
    if (existing) return res.status(200).json({ success: true, message: "Duplicate webhook ignored" });
    const webhookEvent = await WebhookEvent.create({ eventId, eventType: event.event, payload: event, signature });
    await processEvent(event);
    webhookEvent.status = "processed";
    webhookEvent.processedAt = new Date();
    await webhookEvent.save();
    return res.status(200).json({ success: true, message: "Webhook processed" });
  } catch (error) {
    return next(error);
  }
};

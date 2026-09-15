import crypto from "crypto";
import Appointment from "../models/Appointment.js";
import Coupon from "../models/Coupon.js";
import Payment, { PAYMENT_STATUS, REFUND_STATUS } from "../models/Payment.js";
import TransactionLedger from "../models/TransactionLedger.js";
import Wallet from "../models/Wallet.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { env } from "../config/env.js";
import { PAYMENT_STATUS as APPOINTMENT_PAYMENT_STATUS } from "../constants/appointmentStatus.js";
import { paymentRetryService } from "./paymentRetryService.js";
import { subscriptionService } from "./subscriptionService.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { appendPaymentTransition } from "./paymentStateMachine.js";

const verifyWebhookSignature = (rawBody, signature) => {
  if (!env.razorpayWebhookSecret) return false;
  const expected = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

// Phase A6.2.5 AUDIT FINDING: this function was private to this file, so
// the new Self-Healing Engine's "retry failed webhook" action had no way
// to reuse the exact same processing logic and would have had to duplicate
// it. Exporting it (no other change) lets selfHealingEngine.js call the
// identical code path a real incoming webhook uses.
export const processEvent = async (event) => {
  const entity = event.payload?.payment?.entity || event.payload?.refund?.entity || event.payload?.subscription?.entity;
  switch (event.event) {
    case "payment.captured": {
      const payment = await Payment.findOne({ gatewayOrderId: entity.order_id || entity.order_id }).select("+signature");
      if (!payment) break;
      const expectedGatewayAmount = Math.round(Number(payment.gatewayAmount || payment.totalAmount) * 100);
      if (Number(entity.amount) !== expectedGatewayAmount || String(entity.currency || payment.currency).toUpperCase() !== payment.currency) {
        payment.paymentState = "reconciliation_required";
        payment.reconciliationState = "required";
        payment.stateHistory.push({
          from: payment.paymentState,
          to: "reconciliation_required",
          source: "webhook",
          reason: "Captured webhook amount/currency mismatch",
          at: new Date(),
        });
        await payment.save();
        throw new Error("Captured webhook did not match the authoritative payment amount or currency");
      }
      if (payment.status !== PAYMENT_STATUS.CAPTURED && payment.status !== PAYMENT_STATUS.COMPLETED) {
        const previousState = payment.paymentState || "pending";
        payment.status = PAYMENT_STATUS.CAPTURED;
        payment.paymentState = "captured";
        payment.reconciliationState = "matched";
        payment.paymentId = entity.id;
        payment.gatewayPaymentId = entity.id;
        payment.paidAt = new Date(entity.created_at * 1000);
        payment.stateHistory.push({ from: previousState, to: "captured", source: "webhook", reason: "Gateway reported payment.captured", at: new Date() });
        await payment.save();
      }
      const { completePaymentPostProcessing } = await import("../controllers/paymentController.js");
      try {
        await completePaymentPostProcessing(payment);
      } catch (error) {
        payment.postProcessingState = "failed";
        payment.paymentState = "post_processing_failed";
        payment.reconciliationState = "required";
        await payment.save().catch(() => {});
        throw error;
      }
      await emitAutomationTrigger(TRIGGER_TYPES.PAYMENT_SUCCESS, {
        paymentId: payment._id,
        userId: payment.userId,
        amount: payment.amount,
        appointmentId: payment.appointmentId,
      });
      break;
    }
    case "payment.failed": {
      const payment = await Payment.findOneAndUpdate(
        { razorpayOrderId: entity.order_id },
        { $set: { status: PAYMENT_STATUS.FAILED, paymentState: "failed", failedAt: new Date(), reconciliationState: "matched" }, $push: { stateHistory: { from: "pending", to: "failed", source: "webhook", reason: "Gateway reported payment.failed", at: new Date() } } },
        { returnDocument: "after" },
      );
      if (payment) {
        await paymentRetryService.scheduleFailedPayment(payment._id);
        // Phase A6.2.3 — Automation Studio real trigger.
        await emitAutomationTrigger(TRIGGER_TYPES.PAYMENT_FAILED, {
          paymentId: payment._id,
          userId: payment.userId,
          amount: payment.amount,
        });
      }
      break;
    }
    case "refund.processed": {
      // P23 (Section 24/25) — gatewayRefundId (entity.id) is the unique,
      // authoritative dedupe key: the `processedGatewayRefundIds: {$ne:...}`
      // filter is what guarantees a duplicate "refund.processed" webhook
      // (or one arriving after processRefund() already recorded this exact
      // gateway refund id) can never post a second time. This branch only
      // exists to converge an out-of-band gateway confirmation (e.g. a
      // refund the dashboard/support tooling issued directly at Razorpay,
      // bypassing this app's own processRefund) onto the same canonical
      // counters processRefund uses — it must NEVER re-derive its own
      // separate financial posting for a refund this app itself already
      // processed (Section 24's explicit rule).
      const payment = await Payment.findOneAndUpdate(
        { paymentId: entity.payment_id, processedGatewayRefundIds: { $ne: entity.id } },
        {
          $inc: {
            refundedAmount: Number(entity.amount || 0) / 100,
            gatewayRefundedAmount: Number(entity.amount || 0) / 100,
          },
          $addToSet: { processedGatewayRefundIds: entity.id },
        },
        { returnDocument: "after" },
      );
      if (payment) {
        const isFull = Number(payment.refundedAmount) >= Number(payment.totalAmount);
        payment.refundStatus = isFull ? REFUND_STATUS.FULL : REFUND_STATUS.PARTIAL;
        const targetStatus = isFull ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
        try {
          appendPaymentTransition(payment, targetStatus, {
            source: "webhook", reason: "Gateway reported refund.processed",
          });
        } catch {
          // An out-of-order/unexpected webhook state — never force an
          // illegal transition. Surface it for manual reconciliation
          // instead of silently mutating status (Section 26).
          payment.paymentState = "reconciliation_required";
          payment.reconciliationState = "required";
        }
        await payment.save();
      }
      break;
    }
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
    // AUDIT FINDING (Phase A6.2.3): processEvent() below was previously
    // called OUTSIDE any try/catch scoped to `webhookEvent`, so a thrown
    // error skipped straight to `return next(error)` — webhookEvent.status
    // stayed "received" forever, never "failed". The existing
    // "webhook_failure" Operation Registry type (operationsAdminController.js)
    // reads WebhookEvent.find({ status: "failed" }), which meant that
    // operation type could never actually surface an item, no matter how
    // many webhooks genuinely failed. Fixed by wrapping processEvent() so a
    // failure is honestly recorded on the row that already exists for it.
    try {
      await processEvent(event);
      webhookEvent.status = "processed";
      webhookEvent.processedAt = new Date();
      await webhookEvent.save();
      return res.status(200).json({ success: true, message: "Webhook processed" });
    } catch (processingError) {
      webhookEvent.status = "failed";
      webhookEvent.failureReason = processingError?.message || "Unknown processing error";
      await webhookEvent.save().catch(() => {});
      // Phase A6.2.3 — Automation Studio real trigger.
      await emitAutomationTrigger(TRIGGER_TYPES.WEBHOOK_FAILED, {
        eventId,
        eventType: event.event,
        failureReason: webhookEvent.failureReason,
      });
      return next(processingError);
    }
  } catch (error) {
    return next(error);
  }
};

// Phase A6.2.5 — Self-Healing Engine's "retry failed webhook" action.
// Reuses processEvent() (the exact function razorpayWebhookHandler calls
// above) against a WebhookEvent row already stored with status="failed".
// Never re-verifies the signature (the row already passed that check when
// it was first received) and never touches anything with a status other
// than "failed" — only real, already-failed rows are eligible. Downstream
// side effects (wallet debit, coupon usage) remain protected by the exact
// same idempotencyKey uniqueness (TransactionLedger) that already governs
// the first-attempt code path, so a retry cannot double-apply a financial
// effect that already succeeded partially.
export async function retryWebhookEvent(webhookEventId) {
  const webhookEvent = await WebhookEvent.findById(webhookEventId);
  if (!webhookEvent) throw new Error("Webhook event not found");
  if (webhookEvent.status !== "failed") throw new Error(`Webhook event is not in a failed state (status=${webhookEvent.status})`);

  try {
    await processEvent(webhookEvent.payload);
    webhookEvent.status = "processed";
    webhookEvent.processedAt = new Date();
    webhookEvent.failureReason = undefined;
    await webhookEvent.save();
    return { ok: true, webhookEventId: String(webhookEvent._id) };
  } catch (error) {
    webhookEvent.failureReason = error?.message || "Unknown processing error";
    await webhookEvent.save().catch(() => {});
    throw error;
  }
}

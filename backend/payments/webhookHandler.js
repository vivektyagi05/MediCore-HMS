// Phase 01 — the ONE Razorpay webhook processor.
//
// Pipeline:  raw-body signature check (fail closed)  ->  parse  ->  stable
// event id  ->  sanitised payload stored under a UNIQUE event id (the insert is
// the dedupe gate)  ->  leased claim  ->  processEvent()  ->  fenced completion.
// The HTTP handler, retryWebhookEvent() (admin / self-healing) and the
// recovery job all call processWebhookEventRecord(), so they obey the same
// lease, the same idempotency and the same retry rules. There is no second
// processor.
import crypto from "crypto";
import { toPaise } from "./money.js";
import Payment, { REFUND_STATUS } from "../models/Payment.js";
import WebhookEvent from "../models/WebhookEvent.js";
import RefundRequest from "../models/RefundRequest.js";
import { env } from "../config/env.js";
import { subscriptionService } from "./subscriptionService.js";
import { paymentDeps } from "./paymentDeps.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import {
  claimPaymentCapture, markAttemptCaptured, preserveUnapplicableCapture, supersedeOpenAttempts,
} from "./paymentCapture.js";
import {
  PRE_CAPTURE_STATES, effectiveState, isCaptureConfirmed, markPostProcessingFailed, transitionPayment,
} from "./paymentTransitions.js";
import { attemptMatchesAllocation, authoritativeGatewayAmount, resolveGatewayOrder } from "./paymentAttemptService.js";
import { applyGatewayFailure } from "./paymentFailureService.js";

export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
export const MAX_WEBHOOK_ATTEMPTS = 8;
export const WEBHOOK_LEASE_MS = 2 * 60 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

/** A failure that retrying cannot fix (bad payload, mismatch). Never retried. */
export class PermanentWebhookError extends Error {
  constructor(message, code = "permanent") { super(message); this.name = "PermanentWebhookError"; this.code = code; this.retryable = false; }
}

export const backoffMs = (attempts) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

// ---------------------------------------------------------------- authenticity
// Seam so tests can prove the fail-closed behaviour without mutating the frozen env object.
export const webhookConfig = { secret: () => env.razorpayWebhookSecret };

export const verifyWebhookSignature = (rawBody, signature, secret = webhookConfig.secret()) => {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== "string" || !signature) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

// -------------------------------------------------------- payload minimisation
// Provider payloads carry patient e-mail, phone, card/VPA/bank details. Only the
// fields the processor needs are persisted; they are all that retries replay.
const ENTITY_KEEP = ["id", "entity", "amount", "currency", "status", "order_id", "payment_id", "subscription_id", "invoice_id", "method", "captured", "error_code", "error_source", "error_step", "error_reason", "created_at", "speed_processed", "speed_requested", "receipt"];
const pickEntity = (entity, extra = []) => {
  if (!entity || typeof entity !== "object") return undefined;
  const out = {};
  for (const key of [...ENTITY_KEEP, ...extra]) if (entity[key] !== undefined) out[key] = entity[key];
  return out;
};
export const sanitizeWebhookPayload = (event) => {
  const payload = event?.payload || {};
  const clean = {};
  if (payload.payment?.entity) clean.payment = { entity: pickEntity(payload.payment.entity) };
  if (payload.refund?.entity) clean.refund = { entity: pickEntity(payload.refund.entity, ["notes"]) };
  if (payload.subscription?.entity) clean.subscription = { entity: pickEntity(payload.subscription.entity, ["plan_id", "current_start", "current_end", "paid_count"]) };
  return { event: event?.event, entity: event?.entity, created_at: event?.created_at, account_id: event?.account_id, payload: clean };
};

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0 && v.length <= 200;

/** Structural validation before any financial mutation. Throws PermanentWebhookError. */
export const validateEventShape = (event) => {
  if (!event || typeof event !== "object" || !isNonEmptyString(event.event) || !event.payload || typeof event.payload !== "object") {
    throw new PermanentWebhookError("Malformed webhook event", "invalid_event");
  }
  const paymentEntity = event.payload.payment?.entity;
  if (event.event.startsWith("payment.")) {
    if (!paymentEntity || !isNonEmptyString(paymentEntity.id) || !isNonEmptyString(paymentEntity.order_id)) {
      throw new PermanentWebhookError("Payment event is missing the payment id or order id", "invalid_event");
    }
  }
  if (event.event.startsWith("refund.") && !isNonEmptyString(event.payload.refund?.entity?.id)) {
    throw new PermanentWebhookError("Refund event is missing the refund id", "invalid_event");
  }
  if (event.event.startsWith("subscription.") && !isNonEmptyString(event.payload.subscription?.entity?.id)) {
    throw new PermanentWebhookError("Subscription event is missing the subscription id", "invalid_event");
  }
};

export const deriveEventId = (event, headerId, rawBody) => {
  if (isNonEmptyString(headerId)) return `rzp:${headerId}`;
  const entity = event?.payload?.payment?.entity || event?.payload?.refund?.entity || event?.payload?.subscription?.entity;
  if (event?.event && (entity?.id || event?.created_at)) return `${event.event}:${entity?.id || event.created_at}`;
  return `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
};

// ---------------------------------------------------------------- event logic
const strictCaptureFields = (entity) => {
  const amount = Number(entity.amount);
  const hasAmount = entity.amount !== undefined && entity.amount !== null && Number.isInteger(amount) && amount > 0;
  const currency = typeof entity.currency === "string" ? entity.currency.trim().toUpperCase() : "";
  return { hasAmount, amount, currency, hasCurrency: currency.length === 3 };
};

const finishCapture = async ({ payment, won }) => {
  let result;
  try {
    result = await paymentDeps.postProcess(payment);
  } catch (error) {
    await markPostProcessingFailed(payment._id, error?.message);
    throw error; // transient: the event stays retryable and the payment stays recoverable
  }
  if (result?.completedNow) {
    await paymentDeps.emit(TRIGGER_TYPES.PAYMENT_SUCCESS, {
      paymentId: payment._id, userId: payment.userId, amount: payment.amount, appointmentId: payment.appointmentId,
    });
  }
  return won ? "captured" : "replay";
};

const handleCaptured = async (entity) => {
  const fields = strictCaptureFields(entity);
  const resolved = await resolveGatewayOrder({ provider: "razorpay", orderId: entity.order_id });

  if (resolved.kind === "orphan_attempt") {
    throw new PermanentWebhookError("Payment attempt references a missing payment record", "orphan_attempt");
  }

  if (resolved.kind === "none") {
    // F-001: a provider capture for a SUBSCRIPTION order (webhook may beat the browser).
    // Reached only when NO appointment payment or attempt owns this order.
    const subscription = await subscriptionService.findByGatewayOrder(entity.order_id);
    if (!subscription) return "ignored_unknown_order";
    if (!fields.hasAmount || !fields.hasCurrency) throw new PermanentWebhookError("Captured webhook is missing amount or currency", "invalid_event");
    if (fields.amount !== toPaise(subscription.amount) || fields.currency !== String(subscription.currency).toUpperCase()) {
      throw new PermanentWebhookError("Captured webhook did not match the authoritative subscription amount or currency", "amount_mismatch");
    }
    const { finishSubscriptionActivation } = await import("../controllers/financeController.js");
    await finishSubscriptionActivation(subscription, { gatewayPaymentId: entity.id, source: "webhook", userId: subscription.userId });
    return "subscription_captured";
  }

  const { payment, attempt } = resolved;

  // Ambiguous but authentic: keep the evidence, never guess, never substitute.
  if (!fields.hasAmount || !fields.hasCurrency) {
    await preserveUnapplicableCapture({ payment, attempt, entity, source: "webhook", disposition: "invalid_event_fields" });
    throw new PermanentWebhookError("Captured webhook is missing amount or currency; recorded for reconciliation", "invalid_event");
  }
  if (attempt && !attemptMatchesAllocation(attempt, payment)) {
    await preserveUnapplicableCapture({ payment, attempt, entity, source: "webhook", disposition: "attempt_allocation_mismatch" });
    await transitionPayment({ paymentId: payment._id, to: "reconciliation_required", from: PRE_CAPTURE_STATES.concat(["failed"]), set: { reconciliationState: "required" }, source: "webhook", reason: "Attempt allocation does not match payment allocation" });
    throw new PermanentWebhookError("Attempt amount or currency does not match the payment allocation", "attempt_mismatch");
  }
  const expectedPaise = toPaise(attempt ? attempt.amount : authoritativeGatewayAmount(payment));
  const expectedCurrency = String(attempt ? attempt.currency : payment.currency).toUpperCase();
  if (fields.amount !== expectedPaise || fields.currency !== expectedCurrency) {
    await preserveUnapplicableCapture({ payment, attempt, entity, source: "webhook", disposition: "amount_currency_mismatch" });
    await transitionPayment({ paymentId: payment._id, to: "reconciliation_required", from: PRE_CAPTURE_STATES.concat(["failed"]), set: { reconciliationState: "required" }, source: "webhook", reason: "Captured webhook amount/currency mismatch" });
    throw new PermanentWebhookError("Captured webhook did not match the authoritative payment amount or currency", "amount_mismatch");
  }

  const duplicateOrReplay = async (current) => {
    if (current.gatewayPaymentId === entity.id) {
      if (attempt) await markAttemptCaptured({ paymentId: current._id, gatewayOrderId: attempt.gatewayOrderId, gatewayPaymentId: entity.id });
      return finishCapture({ payment: current, won: false });
    }
    // A DIFFERENT provider payment was captured for this payment: real money that
    // must neither be dropped nor allowed to fulfil twice.
    await preserveUnapplicableCapture({ payment: current, attempt, entity, source: "webhook", disposition: "duplicate_capture" });
    return "duplicate_capture_reconciliation";
  };

  if (isCaptureConfirmed(payment)) return duplicateOrReplay(payment);

  const state = effectiveState(payment);
  if (state === "cancelled" || state === "expired") {
    await preserveUnapplicableCapture({ payment, attempt, entity, source: "webhook", disposition: `capture_on_${state}` });
    if (state === "expired") {
      await transitionPayment({ paymentId: payment._id, to: "reconciliation_required", from: ["expired"], set: { reconciliationState: "required" }, source: "webhook", reason: "Provider capture arrived for an expired payment" });
    }
    return "capture_on_unpayable";
  }

  const claim = await claimPaymentCapture({
    payment, attempt, gatewayPaymentId: entity.id, source: "webhook", reason: "Gateway reported payment.captured",
    paidAt: new Date((entity.created_at || Math.floor(Date.now() / 1000)) * 1000),
  });
  if (!claim.won) {
    if (claim.payment && isCaptureConfirmed(claim.payment)) return duplicateOrReplay(claim.payment);
    await preserveUnapplicableCapture({ payment, attempt, entity, source: "webhook", disposition: "capture_rejected_state" });
    return "capture_on_unpayable";
  }
  if (attempt) {
    await markAttemptCaptured({ paymentId: payment._id, gatewayOrderId: attempt.gatewayOrderId, gatewayPaymentId: entity.id });
    await supersedeOpenAttempts({ paymentId: payment._id, exceptGatewayOrderId: attempt.gatewayOrderId });
  }
  return finishCapture({ payment: claim.payment, won: true });
};

const handleFailed = async (entity) => {
  const resolved = await resolveGatewayOrder({ provider: "razorpay", orderId: entity.order_id });
  if (resolved.kind === "orphan_attempt") throw new PermanentWebhookError("Payment attempt references a missing payment record", "orphan_attempt");

  if (resolved.kind === "none") {
    const subscription = await subscriptionService.findByGatewayOrder(entity.order_id);
    if (!subscription) return "ignored_unknown_order";
    await subscriptionService.markPaymentFailed({ subscription, gatewayPaymentId: entity.id, reason: "Gateway reported payment.failed", source: "webhook" });
    return "subscription_failed";
  }
  return applyGatewayFailure({ resolved, orderId: entity.order_id, entity, source: "webhook" });
};

/**
 * Pure event dispatcher. Returns an outcome string; throws
 * PermanentWebhookError for non-retryable problems and any other Error for
 * transient ones. Exported because retry/self-healing share it.
 */
export const processEvent = async (event) => {
  validateEventShape(event);
  const entity = event.payload?.payment?.entity || event.payload?.refund?.entity || event.payload?.subscription?.entity;
  switch (event.event) {
    case "payment.captured":
      return handleCaptured(entity);
    case "payment.failed":
      return handleFailed(entity);
    case "refund.processed":
    case "refund.failed": {
      // A refund THIS app initiated and is waiting on converges on the same
      // finalize step as the immediate path, so money movement happens once.
      const owned = entity?.id
        ? await RefundRequest.findOne({ gatewayRefundId: entity.id, refundState: { $in: ["gateway_processing", "reconciliation_required"] } }).select("_id").lean()
        : null;
      if (owned) {
        const { settlePendingGatewayRefund } = await import("../controllers/refundController.js");
        await settlePendingGatewayRefund({ refundRequestId: owned._id, refund: entity, source: "webhook" });
        return "refund_settled";
      }
      if (event.event === "refund.failed") {
        await Payment.findOneAndUpdate({ paymentId: entity.payment_id }, { refundStatus: REFUND_STATUS.FAILED });
        return "refund_failed_recorded";
      }
      // F-003: out-of-band provider refund through the canonical finalizer.
      const { settleOutOfBandGatewayRefund } = await import("../controllers/refundController.js");
      await settleOutOfBandGatewayRefund({ gatewayPaymentId: entity.payment_id, refund: entity, source: "webhook" });
      return "refund_out_of_band";
    }
    case "subscription.charged":
      await subscriptionService.markCharged(entity.subscription_id);
      return "subscription_charged";
    case "subscription.cancelled":
      await subscriptionService.cancel(entity.id);
      return "subscription_cancelled";
    default:
      return "ignored_unsupported";
  }
};

// ------------------------------------------------------------ event lifecycle
export const buildEventClaimFilter = ({ eventId, now = new Date(), force = false, ignoreBackoff = false }) => {
  const due = ignoreBackoff ? {} : { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] };
  const failedClause = force ? { status: "failed" } : { status: "failed", retryable: { $ne: false }, ...due };
  return {
    _id: eventId,
    ...(force ? {} : { attempts: { $lt: MAX_WEBHOOK_ATTEMPTS } }),
    $or: [{ status: "received" }, failedClause, { status: "processing", leaseExpiresAt: { $lt: now } }],
  };
};

export const claimWebhookEvent = (eventId, { now = new Date(), force = false, ignoreBackoff = false, owner = crypto.randomUUID() } = {}) =>
  WebhookEvent.findOneAndUpdate(
    buildEventClaimFilter({ eventId, now, force, ignoreBackoff }),
    { $set: { status: "processing", leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + WEBHOOK_LEASE_MS) }, $inc: { attempts: 1 } },
    { returnDocument: "after" },
  ).then((doc) => (doc ? { doc, owner } : null));

/**
 * Canonical processing of ONE stored event. Returns
 * { state: 'processed'|'failed'|'skipped'|'stale', retryable?, outcome?, error? }.
 * Completion is fenced by the lease owner, so a worker whose lease expired
 * cannot overwrite the result written by the worker that took over.
 */
export const processWebhookEventRecord = async (eventId, opts = {}) => {
  const claim = await claimWebhookEvent(eventId, opts);
  if (!claim) return { state: "skipped" };
  const { doc, owner } = claim;
  try {
    const outcome = await processEvent(doc.payload);
    const done = await WebhookEvent.findOneAndUpdate(
      { _id: doc._id, leaseOwner: owner, status: "processing" },
      { $set: { status: "processed", processedAt: new Date(), outcome: String(outcome).slice(0, 100), retryable: false }, $unset: { failureReason: "", failureCode: "", leaseOwner: "", leaseExpiresAt: "", nextAttemptAt: "" } },
      { returnDocument: "after" },
    );
    return done ? { state: "processed", outcome } : { state: "stale", outcome };
  } catch (error) {
    const permanent = error instanceof PermanentWebhookError || error?.retryable === false;
    const exhausted = doc.attempts >= MAX_WEBHOOK_ATTEMPTS && !opts.force;
    const retryable = !permanent && !exhausted;
    const failed = await WebhookEvent.findOneAndUpdate(
      { _id: doc._id, leaseOwner: owner, status: "processing" },
      {
        $set: {
          status: "failed", retryable,
          failureReason: String(error?.message || "Unknown processing error").slice(0, 300),
          failureCode: String(error?.code || (permanent ? "permanent" : "transient")).slice(0, 60),
          nextAttemptAt: retryable ? new Date(Date.now() + backoffMs(doc.attempts)) : undefined,
        },
        $unset: { leaseOwner: "", leaseExpiresAt: "" },
      },
      { returnDocument: "after" },
    );
    if (failed && (doc.attempts === 1 || !retryable)) {
      await paymentDeps.emit(TRIGGER_TYPES.WEBHOOK_FAILED, { eventId: doc.eventId, eventType: doc.eventType, failureReason: failed.failureReason }).catch(() => {});
    }
    return { state: failed ? "failed" : "stale", retryable, error };
  }
};

export const razorpayWebhookHandler = async (req, res, next) => {
  try {
    if (!webhookConfig.secret()) {
      // Fail closed without leaking configuration details.
      return res.status(503).json({ success: false, message: "Webhook endpoint is not available" });
    }
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
      return res.status(400).json({ success: false, message: "Invalid webhook payload" });
    }
    const signature = req.headers["x-razorpay-signature"];
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ success: false, message: "Invalid webhook payload" });
    }
    const eventId = deriveEventId(event, req.headers["x-razorpay-event-id"], rawBody);
    const eventType = isNonEmptyString(event?.event) ? event.event : "unknown";

    // The unique eventId makes the insert itself the dedupe gate (no
    // find-then-create race between two simultaneous deliveries).
    let stored;
    try {
      stored = await WebhookEvent.create({
        eventId, eventType, payload: sanitizeWebhookPayload(event),
        // The signature proved authenticity once; only a short digest is kept.
        signature: crypto.createHash("sha256").update(String(signature)).digest("hex").slice(0, 16),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await WebhookEvent.findOne({ eventId }).select("status retryable").lean();
      if (!existing || ["processed", "duplicate"].includes(existing.status)) {
        return res.status(200).json({ success: true, message: "Duplicate webhook ignored" });
      }
      if (existing.status === "failed" && existing.retryable === false) {
        return res.status(200).json({ success: true, message: "Webhook was rejected earlier and will not be retried" });
      }
      stored = existing; // received / processing / retryable failed: attempt the (leased) claim below
    }

    // A provider redelivery IS a retry signal, so backoff is not applied here.
    const result = await processWebhookEventRecord(stored._id, { ignoreBackoff: true });
    if (result.state === "failed" && result.retryable) {
      // Transient: the event is durably stored and recoverable, but a non-2xx lets the provider redeliver too.
      return res.status(500).json({ success: false, message: "Webhook could not be processed yet" });
    }
    if (result.state === "failed") {
      return res.status(200).json({ success: true, message: "Webhook acknowledged but rejected" });
    }
    return res.status(200).json({ success: true, message: result.state === "processed" ? "Webhook processed" : "Webhook already being handled" });
  } catch (error) {
    return next(error);
  }
};

/**
 * Self-healing / admin retry of a stored FAILED event. Same claim, same
 * processing path as a real delivery; throws the processing error so the
 * caller (self-healing engine) records an honest failure.
 */
export async function retryWebhookEvent(webhookEventId) {
  const webhookEvent = await WebhookEvent.findById(webhookEventId);
  if (!webhookEvent) throw new Error("Webhook event not found");
  if (webhookEvent.status !== "failed") throw new Error(`Webhook event is not in a failed state (status=${webhookEvent.status})`);
  const result = await processWebhookEventRecord(webhookEvent._id, { force: true });
  if (result.state === "failed") throw result.error || new Error("Webhook retry failed");
  if (result.state === "skipped") throw new Error("Webhook event is already being processed");
  return { ok: true, webhookEventId: String(webhookEvent._id), outcome: result.outcome };
}

/**
 * Recovery job: events stuck in received (crash before processing), expired
 * processing leases (crash during processing) and retryable failures that are
 * due. Bounded batch; per-event isolation.
 */
export const recoverWebhookEvents = async ({ now = new Date(), limit = 50, receivedGraceMs = 30 * 1000 } = {}) => {
  const candidates = await WebhookEvent.find({
    attempts: { $lt: MAX_WEBHOOK_ATTEMPTS },
    $or: [
      { status: "received", createdAt: { $lt: new Date(now.getTime() - receivedGraceMs) } },
      { status: "processing", leaseExpiresAt: { $lt: now } },
      { status: "failed", retryable: { $ne: false }, nextAttemptAt: { $lte: now } },
    ],
  }).select("_id").sort({ _id: 1 }).limit(limit).lean();
  const results = [];
  for (const { _id } of candidates) {
    try {
      results.push({ id: _id, ...(await processWebhookEventRecord(_id, { now })) });
    } catch (error) {
      results.push({ id: _id, state: "error", message: error?.message });
    }
  }
  return results;
};

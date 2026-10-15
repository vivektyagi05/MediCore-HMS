// Phase 01 — PaymentAttempt is the immutable record of every gateway order.
// Payment.razorpayOrderId only points at the LATEST order; a late capture for
// an older order can only be correlated through its attempt.
//
// Crash-safe order creation ("attempt first"):
//   1. reserveAttempt()   inserts the attempt with a placeholder order id. The
//                         unique (paymentId, attemptNumber) index is the
//                         arbiter, so attempt numbers never collide.
//   2. gateway.createOrder() receipt is deterministic per attempt, so an
//                         ambiguous result (timeout) can be looked up later
//                         instead of blindly creating a second order.
//   3. bindOrderToAttempt() swaps placeholder -> real order id (CAS).
// A crash anywhere leaves a recognisable placeholder attempt that
// recoverOrphanAttempts() adopts or cancels. Nothing is ever deleted.
import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import PaymentAttempt from "../models/PaymentAttempt.js";
import { paymentGateway } from "./paymentGateway.js";
import { logger } from "../utils/logger.js";

export const ATTEMPT_PLACEHOLDER_PREFIX = "pending:";
export const PAYMENT_PLACEHOLDER_PREFIX = "pending_order_";
export const OPEN_ATTEMPT_STATUSES = Object.freeze(["created", "checkout_started", "authorized", "verification_pending"]);
export const ORPHAN_GRACE_MS = 5 * 60 * 1000;
export const ORPHAN_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export const isPlaceholderOrderId = (id) =>
  typeof id === "string" && (id.startsWith(ATTEMPT_PLACEHOLDER_PREFIX) || id.startsWith(PAYMENT_PLACEHOLDER_PREFIX));

/** The authoritative gateway amount (rupees) for any attempt of this payment. */
export const authoritativeGatewayAmount = (payment) => Number(payment.gatewayAmount || payment.totalAmount);

export const attemptReceipt = (paymentId, attemptNumber) => `pay_${paymentId}_${attemptNumber}`;

export const reserveAttempt = async ({ payment, gateway = paymentGateway.mode(), maxTries = 6 }) => {
  const amount = authoritativeGatewayAmount(payment);
  for (let i = 0; i < maxTries; i += 1) {
    const last = await PaymentAttempt.findOne({ paymentId: payment._id }).sort({ attemptNumber: -1 }).select("attemptNumber").lean();
    const attemptNumber = (last?.attemptNumber || 0) + 1;
    const _id = new mongoose.Types.ObjectId();
    try {
      return await PaymentAttempt.create({
        _id, paymentId: payment._id, attemptNumber, gateway,
        gatewayOrderId: `${ATTEMPT_PLACEHOLDER_PREFIX}${_id}`,
        status: "created", amount, currency: payment.currency, startedAt: new Date(),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error; // another worker took this number: re-read and take the next
    }
  }
  const error = new Error("Could not reserve a payment attempt number"); error.statusCode = 409; throw error;
};

const isDefinitiveProviderRejection = (error) => {
  const code = Number(error?.statusCode || error?.response?.status);
  return code >= 400 && code < 500;
};

/**
 * Creates the provider order for a reserved attempt and binds it. Returns
 * { order, attempt, orphan }. `orphan: true` means the order was created but the
 * attempt had already been cancelled/adopted by recovery; the order is reported,
 * never used.
 */
export const openGatewayOrder = async ({ payment, attempt, notes = {}, receipt = attemptReceipt(payment._id, attempt.attemptNumber) }) => {
  let order;
  try {
    order = await paymentGateway.createOrder({
      amount: attempt.amount,
      currency: attempt.currency,
      receipt,
      notes: { ...notes, paymentId: String(payment._id), attemptNumber: String(attempt.attemptNumber), module: "hms_finance" },
    });
  } catch (error) {
    if (isDefinitiveProviderRejection(error)) {
      await PaymentAttempt.updateOne(
        { _id: attempt._id, status: "created", gatewayOrderId: attempt.gatewayOrderId },
        { $set: { status: "cancelled", completedAt: new Date(), failureReason: "Gateway rejected order creation", failureCode: String(error?.statusCode || "rejected").slice(0, 100) } },
      );
    }
    // Ambiguous failure (timeout/network): the placeholder is intentionally kept
    // so recoverOrphanAttempts() can look the order up by its deterministic receipt.
    throw error;
  }
  const bound = await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "created", gatewayOrderId: attempt.gatewayOrderId },
    { $set: { gatewayOrderId: order.id } },
    { returnDocument: "after" },
  );
  if (!bound) {
    logger.warn("Gateway order created for an attempt that was already closed; orphan order", { paymentId: String(payment._id), orderId: order.id });
    return { order, attempt: null, orphan: true };
  }
  return { order, attempt: bound, orphan: false };
};

/**
 * Resolves a provider order id to its attempt and payment. Attempt lookup
 * comes first (it knows every historical order); the Payment pointer is the
 * fallback for legacy payments created before attempts existed.
 */
export const resolveGatewayOrder = async ({ provider = "razorpay", orderId }) => {
  if (!orderId || typeof orderId !== "string") return { kind: "none" };
  const attempt = await PaymentAttempt.findOne({ gateway: provider, gatewayOrderId: orderId });
  if (attempt) {
    const payment = await Payment.findById(attempt.paymentId).select("+signature");
    if (!payment) return { kind: "orphan_attempt", attempt };
    const isCurrent = payment.gatewayOrderId === orderId || payment.razorpayOrderId === orderId;
    return { kind: "payment", attempt, payment, isCurrent };
  }
  const legacy = await Payment.findOne({ $or: [{ gatewayOrderId: orderId }, { razorpayOrderId: orderId }] }).select("+signature");
  if (legacy) return { kind: "payment", attempt: null, payment: legacy, isCurrent: true };
  return { kind: "none" };
};

/** Does the attempt's stored allocation still match the payment's authoritative amount/currency? */
export const attemptMatchesAllocation = (attempt, payment) =>
  Boolean(attempt) &&
  Math.round(Number(attempt.amount) * 100) === Math.round(authoritativeGatewayAmount(payment) * 100) &&
  String(attempt.currency).toUpperCase() === String(payment.currency).toUpperCase();

/**
 * Recovery for attempts left with a placeholder order id by a crash/timeout.
 * Adopts the provider order when the deterministic receipt finds one; the
 * adopted order was never exposed to a browser (the pointer commit happens
 * after the bind), so it is closed as superseded. Never deletes anything and
 * never touches the Payment document.
 */
export const recoverOrphanAttempts = async ({ now = new Date(), limit = 50 } = {}) => {
  const older = new Date(now.getTime() - ORPHAN_GRACE_MS);
  const giveUp = new Date(now.getTime() - ORPHAN_GIVE_UP_MS);
  const stuck = await PaymentAttempt.find({
    status: "created", gatewayOrderId: { $regex: `^${ATTEMPT_PLACEHOLDER_PREFIX}` }, startedAt: { $lt: older },
  }).sort({ _id: 1 }).limit(limit).lean();
  const results = [];
  for (const attempt of stuck) {
    try {
      let found = null;
      if (typeof paymentGateway.findOrderByReceipt === "function") {
        found = await paymentGateway.findOrderByReceipt({ receipt: attemptReceipt(attempt.paymentId, attempt.attemptNumber) });
      }
      if (found?.id) {
        const closed = await PaymentAttempt.updateOne(
          { _id: attempt._id, status: "created", gatewayOrderId: attempt.gatewayOrderId },
          { $set: { gatewayOrderId: found.id, status: "superseded", completedAt: new Date(), failureReason: "Orphan order adopted by recovery; never exposed to checkout" } },
        );
        results.push({ attemptId: attempt._id, action: closed.modifiedCount ? "adopted" : "skipped", orderId: found.id });
      } else if (new Date(attempt.startedAt) < giveUp) {
        await PaymentAttempt.updateOne(
          { _id: attempt._id, status: "created", gatewayOrderId: attempt.gatewayOrderId },
          { $set: { status: "cancelled", completedAt: new Date(), failureReason: "No provider order found for this reserved attempt" } },
        );
        results.push({ attemptId: attempt._id, action: "cancelled" });
      } else {
        results.push({ attemptId: attempt._id, action: "waiting" });
      }
    } catch (error) {
      logger.warn("Orphan attempt recovery failed for one attempt", { attemptId: String(attempt._id), message: error?.message });
      results.push({ attemptId: attempt._id, action: "error" });
    }
  }
  return results;
};

/**
 * Ambiguous order creation (timeout) check: if the deterministic receipt finds
 * an order at the provider, bind it to the placeholder attempt instead of
 * creating a second order. Returns { order, attempt } or null.
 */
export const adoptExistingOrder = async ({ attempt }) => {
  if (!attempt || !isPlaceholderOrderId(attempt.gatewayOrderId)) return null;
  const found = await paymentGateway.findOrderByReceipt({ receipt: attemptReceipt(attempt.paymentId, attempt.attemptNumber) });
  if (!found?.id) return null;
  const bound = await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "created", gatewayOrderId: attempt.gatewayOrderId },
    { $set: { gatewayOrderId: found.id } },
    { returnDocument: "after" },
  );
  return bound ? { order: found, attempt: bound } : null;
};

import crypto from "crypto";
import EmailDelivery from "../models/EmailDelivery.js";
import { emailService } from "./emailService.js";
import { logger } from "../utils/logger.js";

export const MAX_EMAIL_ATTEMPTS = 5;
export const STALE_SENDING_MS = 10 * 60 * 1000;
// 2, 4, 8, 16 minutes between attempts.
export const backoffMs = (attempts) => Math.pow(2, Math.max(1, attempts)) * 60 * 1000;

/** Idempotent enqueue. A replayed event (scheduler twice, webhook replay) is a no-op. */
export const enqueueEmail = async ({ eventKey, to, subject, html, recipientId, entityType = "appointment", entityId }) => {
  if (!to || !eventKey) return { enqueued: false, reason: "missing_recipient_or_key" };
  try {
    await EmailDelivery.create({ eventKey, to, subject, html, recipientId, entityType, entityId });
    return { enqueued: true };
  } catch (error) {
    if (error?.code === 11000) return { enqueued: false, reason: "duplicate" };
    logger.warn("enqueueEmail failed (never blocks the business flow)", { message: error?.message, eventKey });
    return { enqueued: false, reason: "error" };
  }
};

const failureCategory = (error) => error?.statusCategory || (error?.name === "BrevoConfigurationError" ? "not_configured" : "unknown");

/** Pure: what happens to a row after a failed attempt (exported for tests). */
export const decideFailureOutcome = ({ attempts, category }) => {
  const permanent = attempts >= MAX_EMAIL_ATTEMPTS || category === "rejected";
  return permanent ? { status: "failed" } : { status: "retrying", delayMs: backoffMs(attempts) };
};

/**
 * Claims and sends due emails. Each row is claimed with an atomic conditional
 * update (queued|retrying -> sending) that mints a fencing token; the outcome
 * write is conditional on that token. Two concurrent workers can never send the
 * same row, and a worker whose lease was reclaimed cannot overwrite the newer
 * worker's outcome. Delivery is at-least-once: a crash after the provider accepts
 * but before "sent" is recorded re-sends after the lease expires (the provider
 * gives no idempotency key here) - that window is documented, not hidden.
 */
export const processEmailOutbox = async ({ now = new Date(), batchSize = 50 } = {}) => {
  // Reclaim rows stuck in "sending" (crashed worker): back to retrying, no attempt lost.
  // The token is cleared so the dead worker's late write can no longer match.
  await EmailDelivery.updateMany(
    { status: "sending", claimedAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    { $set: { status: "retrying", nextAttemptAt: now }, $unset: { claimToken: 1 } },
  );
  const stats = { sent: 0, retrying: 0, failed: 0, fencedOut: 0 };
  for (let i = 0; i < batchSize; i += 1) {
    const token = crypto.randomUUID();
    const row = await EmailDelivery.findOneAndUpdate(
      { status: { $in: ["queued", "retrying"] }, nextAttemptAt: { $lte: now } },
      { $set: { status: "sending", claimedAt: now, claimToken: token }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
    );
    if (!row) break;
    const fence = { _id: row._id, status: "sending", claimToken: token };
    try {
      const { messageId } = await emailService.sendTransactional({ to: row.to, subject: row.subject, html: row.html });
      const done = await EmailDelivery.updateOne(fence, { $set: { status: "sent", sentAt: new Date(), providerMessageId: messageId }, $unset: { lastErrorCategory: 1, claimToken: 1 } });
      if (done.modifiedCount === 1) stats.sent += 1; else stats.fencedOut += 1;
    } catch (error) {
      const category = failureCategory(error);
      const outcome = decideFailureOutcome({ attempts: row.attempts, category });
      const set = outcome.status === "failed"
        ? { status: "failed", lastErrorCategory: category, lastErrorAt: new Date() }
        : { status: "retrying", lastErrorCategory: category, lastErrorAt: new Date(), nextAttemptAt: new Date(Date.now() + outcome.delayMs) };
      const res = await EmailDelivery.updateOne(fence, { $set: set, $unset: { claimToken: 1 } });
      if (res.modifiedCount === 1) stats[outcome.status] += 1; else stats.fencedOut += 1;
      logger.warn("email delivery attempt failed", { eventKey: row.eventKey, category, attempts: row.attempts, permanent: outcome.status === "failed" });
    }
  }
  return stats;
};

/** Admin visibility: counts by status plus the exhausted (dead-letter) rows. No html bodies. */
export const getOutboxHealth = async ({ now = new Date(), limit = 25, page = 1, entityType } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const failedFilter = { status: "failed", ...(entityType ? { entityType } : {}) };
  const [byStatus, failedTotal, failed, stuckSending] = await Promise.all([
    EmailDelivery.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    EmailDelivery.countDocuments(failedFilter),
    EmailDelivery.find(failedFilter)
      .select("eventKey entityType entityId status attempts lastErrorCategory lastErrorAt requeueCount updatedAt createdAt")
      .sort({ updatedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    EmailDelivery.countDocuments({ status: "sending", claimedAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  return { counts: { queued: 0, sending: 0, retrying: 0, sent: 0, failed: 0, ...counts }, stuckSending, failed, pagination: { page: safePage, limit: safeLimit, total: failedTotal, pages: Math.max(Math.ceil(failedTotal / safeLimit), 1) } };
};

/**
 * Operator re-queue of an EXHAUSTED row. Conditional on status "failed" so a
 * double click / concurrent requeue is a no-op, attempts reset so it gets a full
 * retry budget. Re-sending an email moves no money.
 */
export const requeueFailedEmail = async ({ id, now = new Date() }) => {
  const row = await EmailDelivery.findOneAndUpdate(
    { _id: id, status: "failed" },
    { $set: { status: "queued", attempts: 0, nextAttemptAt: now, requeuedAt: now }, $unset: { lastErrorCategory: 1, claimToken: 1 }, $inc: { requeueCount: 1 } },
    { returnDocument: "after" },
  ).select("eventKey entityType entityId status requeueCount").lean();
  return row ? { requeued: true, row } : { requeued: false };
};

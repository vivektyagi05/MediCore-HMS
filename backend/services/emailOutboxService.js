import EmailDelivery from "../models/EmailDelivery.js";
import { emailService } from "./emailService.js";
import { logger } from "../utils/logger.js";

export const MAX_EMAIL_ATTEMPTS = 5;
const STALE_SENDING_MS = 10 * 60 * 1000;
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

/**
 * Claims and sends due emails. Each row is claimed with an atomic conditional
 * update (queued|retrying → sending), so two concurrent workers can never send
 * the same email twice. Bounded by batchSize; safe to run on any schedule.
 */
export const processEmailOutbox = async ({ now = new Date(), batchSize = 50 } = {}) => {
  // Reclaim rows stuck in "sending" (crashed worker): back to retrying, no attempt lost.
  await EmailDelivery.updateMany(
    { status: "sending", claimedAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    { $set: { status: "retrying", nextAttemptAt: now } },
  );
  const stats = { sent: 0, retrying: 0, failed: 0 };
  for (let i = 0; i < batchSize; i += 1) {
    const row = await EmailDelivery.findOneAndUpdate(
      { status: { $in: ["queued", "retrying"] }, nextAttemptAt: { $lte: now } },
      { $set: { status: "sending", claimedAt: now }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
    );
    if (!row) break;
    try {
      const { messageId } = await emailService.sendTransactional({ to: row.to, subject: row.subject, html: row.html });
      await EmailDelivery.updateOne({ _id: row._id }, { $set: { status: "sent", sentAt: new Date(), providerMessageId: messageId, lastErrorCategory: undefined } });
      stats.sent += 1;
    } catch (error) {
      const category = failureCategory(error);
      const permanent = row.attempts >= MAX_EMAIL_ATTEMPTS || category === "rejected";
      await EmailDelivery.updateOne({ _id: row._id }, { $set: permanent
        ? { status: "failed", lastErrorCategory: category }
        : { status: "retrying", lastErrorCategory: category, nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)) } });
      stats[permanent ? "failed" : "retrying"] += 1;
      logger.warn("email delivery attempt failed", { eventKey: row.eventKey, category, attempts: row.attempts, permanent });
    }
  }
  return stats;
};

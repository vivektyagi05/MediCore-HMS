import { SUBSCRIPTION_STATUS as S } from "../models/Subscription.js";

// Pure lifecycle rules (no I/O) so they can be unit-tested.
export const UNPAID_STATES = Object.freeze([S.PENDING_PAYMENT, S.PAYMENT_PROCESSING, S.PAYMENT_FAILED]);
export const RENEWAL_STATES = Object.freeze([S.RENEWAL_PENDING, S.RENEWAL_FAILED]);
// States from which a provider-confirmed capture may activate / extend.
export const ACTIVATABLE_STATES = Object.freeze([...UNPAID_STATES, ...RENEWAL_STATES]);
// Entitlement-bearing states (paid access). Renewal states only count inside the paid period.
export const PAID_ACCESS_STATES = Object.freeze([S.ACTIVE, S.PAST_DUE, ...RENEWAL_STATES]);

export const addInterval = (from, interval) => {
  const end = new Date(from);
  end.setMonth(end.getMonth() + (interval === "yearly" ? 12 : 1));
  return end;
};

/** Initial purchase starts now; a renewal extends from the end of the paid period so no paid time is lost. */
export const computeNextPeriod = ({ interval, currentPeriodEnd, now = new Date(), isRenewal }) => {
  const start = isRenewal && currentPeriodEnd && new Date(currentPeriodEnd) > now ? new Date(currentPeriodEnd) : new Date(now);
  return { periodStart: start, periodEnd: addInterval(start, interval) };
};

/** Entitlement is derived from paid state + period only; a cron run alone can never grant it. */
export const hasPaidAccess = (subscription, now = new Date()) => {
  if (!subscription) return false;
  if (subscription.status === S.ACTIVE || subscription.status === S.PAST_DUE) return true; // legacy rows keep existing behaviour
  if (RENEWAL_STATES.includes(subscription.status)) return Boolean(subscription.currentPeriodEnd) && new Date(subscription.currentPeriodEnd) > now;
  return false;
};

export const MAX_RENEWAL_ORDER_ATTEMPTS = 3;

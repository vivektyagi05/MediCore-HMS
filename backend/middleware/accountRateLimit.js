// Phase P15 — the project already has IP-based rate limiting on every
// /api/auth route (see app.js's authLimiter: 20 requests / 15 min / IP).
// That alone doesn't stop one attacker email-bombing a single victim's
// inbox from many IPs, or a distributed brute force against one victim's
// OTP. This adds a second, account-keyed limiter on top — it does NOT
// replace the IP limiter, and it does NOT create a second incompatible
// rate-limiting system (no new library, no new store): same in-process
// sliding-window approach the rest of small internal throttles use.
//
// NOTE: this is in-memory and per-process, matching the project's existing
// authLimiter (also in-memory, via express-rate-limit's default store).
// That's an accepted, documented limitation for a single-instance
// deployment — not a new one introduced by this file.
const buckets = new Map();

const prune = (timestamps, windowMs, now) => timestamps.filter((ts) => now - ts < windowMs);

/**
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max
 * @param {(req: import('express').Request) => string} options.keyFn
 * @param {string} options.message
 */
export const accountRateLimit = ({ windowMs, max, keyFn, message }) => (req, res, next) => {
  const identity = keyFn(req);
  if (!identity) return next();

  const key = `${req.baseUrl}${req.path}:${identity}`;
  const now = Date.now();
  const existing = prune(buckets.get(key) || [], windowMs, now);

  if (existing.length >= max) {
    res.status(429).json({ success: false, message });
    return;
  }

  existing.push(now);
  buckets.set(key, existing);
  next();
};

export const normalizeEmailKey = (req) => {
  const email = req.body?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
};

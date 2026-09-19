// Phase P15 — password recovery uses two layers: a dedicated IP limiter
// in app.js and this account-keyed limiter. The account layer stops one
// email address from being hammered across many client IPs, while the IP
// layer limits overall recovery traffic from one network.
//
// NOTE: this is in-memory and per-process, matching the project's existing
// authLimiter (also in-memory, via express-rate-limit's default store).
// That's an accepted, documented limitation for a single-instance
// deployment — not a new one introduced by this file.
const buckets = new Map();

const prune = (timestamps, windowMs, now) => timestamps.filter((ts) => now - ts < windowMs);

// The limiter is intentionally process-local for the current single-instance
// deployment, but its key space must still be bounded. Previously an attacker
// could submit many distinct email addresses and leave one Map entry behind
// for each address until process restart. Sweep expired buckets periodically.
const SWEEP_INTERVAL_MS = 60_000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of buckets) {
    const latest = timestamps[timestamps.length - 1];
    if (!latest || now - latest >= 15 * 60 * 1000) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

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
    const oldest = existing[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      message,
      retryAfterSeconds,
    });
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

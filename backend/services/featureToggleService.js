// ─────────────────────────────────────────────────────────────────────────
// Feature toggle READ + ENFORCEMENT — the one place any code checks whether
// a feature is turned on.
//
// Before this file existed, FeatureToggle rows were written and read back
// by the admin CRUD screen and nothing else, except "registrations_paused"
// (controllers/authController.js) and the automation action executor's
// generic "set a toggle" action. Five named, seeded toggles --
// wallet_system, subscriptions, reviews, chat, ai_features -- had zero
// runtime consumer: switching any of them off in the admin UI changed
// nothing about what a patient or doctor could actually do. rolloutPercentage
// was likewise stored and shown in the UI but never consulted anywhere.
//
// isFeatureEnabled() now does both checks a toggle can express:
//   1. isEnabled -- the on/off switch.
//   2. rolloutPercentage -- a deterministic, per-user gradual rollout (the
//      SAME user always lands on the same side of the line for a given
//      feature and percentage, rather than a coin flip on every request).
// A toggle that has never been created at all (not seeded, not yet visited
// by an admin) is treated as ENABLED -- the absence of a row must never
// silently disable a feature nobody has configured yet.
// ─────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import FeatureToggle from "../models/FeatureToggle.js";
import { AppError } from "../middleware/errorMiddleware.js";

// Toggle reads happen on hot paths (every booking, every chat send). A
// short in-process cache avoids a DB round trip per request while staying
// correct within a few seconds of an admin flipping a switch.
const CACHE_TTL_MS = 5000;
const cache = new Map(); // key -> { value, at }

export function clearFeatureToggleCacheForTesting() {
  cache.clear();
}

async function readToggle(key) {
  const normalizedKey = String(key).toLowerCase();
  const cached = cache.get(normalizedKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const doc = await FeatureToggle.findOne({ key: normalizedKey }).select("isEnabled rolloutPercentage").lean();
  const value = doc ? { isEnabled: doc.isEnabled, rolloutPercentage: doc.rolloutPercentage } : null;
  cache.set(normalizedKey, { value, at: Date.now() });
  return value;
}

/** Deterministic 0-99 bucket for (userId, featureKey) -- stable across requests. */
export function rolloutBucket(userId, key) {
  const hash = crypto.createHash("sha1").update(`${key}:${userId}`).digest();
  return hash.readUInt16BE(0) % 100;
}

/**
 * @param {string} key
 * @param {{ userId?: string }} [context]  needed only for a partial (<100%) rollout
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(key, context = {}) {
  const toggle = await readToggle(key);
  if (!toggle) return true; // no row at all -> never configured -> not restricted
  if (!toggle.isEnabled) return false;

  const percentage = toggle.rolloutPercentage;
  if (percentage === null || percentage === undefined || percentage >= 100) return true;
  if (percentage <= 0) return false;
  if (!context.userId) return true; // no user to bucket (e.g. a public/anonymous check) -> don't restrict
  return rolloutBucket(context.userId, key) < percentage;
}

/**
 * Express middleware: 503 (feature genuinely unavailable, not a client
 * error) when the toggle is off or the caller's rollout bucket excludes
 * them. Use on the write/entry action for a feature, not necessarily every
 * read of data that feature already created.
 */
export const requireFeatureEnabled = (key, label = key) => async (req, _res, next) => {
  try {
    const enabled = await isFeatureEnabled(key, { userId: req.user?._id?.toString() });
    if (!enabled) throw new AppError(`${label} is currently unavailable`, 503);
    next();
  } catch (error) {
    next(error);
  }
};

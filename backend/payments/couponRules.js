// Phase 03: pure coupon rule validation + usage summary (no I/O, unit-testable).
import { toPaise } from "./money.js";

const CODE_RE = /^[A-Z0-9_-]{3,30}$/;

/**
 * Validates admin input. `existing` (update) lets us enforce cross-field rules
 * against the stored coupon, e.g. usageLimit may never drop below current usage.
 * Returns an array of { field, message }; empty = valid.
 */
export const validateCouponRules = (input, { existing = null, now = new Date(), isCreate = false } = {}) => {
  const errors = [];
  const merged = { ...(existing || {}), ...input };
  const push = (field, message) => errors.push({ field, message });

  if (isCreate) {
    const code = String(input.code || "").trim().toUpperCase();
    if (!CODE_RE.test(code)) push("code", "Code must be 3-30 characters: letters, digits, underscore or hyphen");
    if (!["percentage", "fixed"].includes(input.type)) push("type", "Type must be percentage or fixed");
  }
  if (input.value !== undefined || isCreate) {
    const value = Number(merged.value);
    if (!Number.isFinite(value) || value <= 0) push("value", "Discount value must be greater than zero");
    else if (merged.type === "percentage" && value > 100) push("value", "A percentage discount cannot exceed 100");
    else if (merged.type === "fixed" && toPaise(value) !== Math.round(value * 100)) push("value", "Fixed discount can have at most 2 decimal places");
  }
  if (input.maxDiscount !== undefined && input.maxDiscount !== null && input.maxDiscount !== "") {
    const max = Number(input.maxDiscount);
    if (!Number.isFinite(max) || max <= 0) push("maxDiscount", "Maximum discount must be greater than zero");
    if (merged.type === "fixed") push("maxDiscount", "Maximum discount only applies to percentage coupons");
  }
  if (input.expiresAt !== undefined || isCreate) {
    const expires = new Date(merged.expiresAt);
    if (Number.isNaN(expires.getTime())) push("expiresAt", "A valid expiry date is required");
    else if (isCreate && expires <= now) push("expiresAt", "Expiry must be in the future");
  }
  if (input.usageLimit !== undefined || isCreate) {
    const limit = Number(merged.usageLimit ?? 1);
    if (!Number.isInteger(limit) || limit < 1) push("usageLimit", "Usage limit must be a whole number of at least 1");
    else if (existing && limit < Number(existing.usedCount || 0)) push("usageLimit", `Usage limit cannot be lower than current usage (${existing.usedCount})`);
  }
  return errors;
};

/** Pure: reserved / redeemed / legacy split of a coupon's usage entries. */
export const summarizeCouponUsage = (coupon) => {
  const entries = coupon?.usedBy || [];
  const reserved = entries.filter((e) => e.state === "reserved").length;
  const redeemed = entries.filter((e) => e.state === "redeemed").length;
  // Entries written before the lifecycle existed carry no state: reported as-is, never reclassified.
  const legacyUnclassified = entries.filter((e) => !e.state).length;
  return {
    reserved, redeemed, legacyUnclassified,
    activeUses: entries.length, usedCount: coupon?.usedCount || 0,
    released: coupon?.releasedCount || 0,
    remaining: Math.max((coupon?.usageLimit || 0) - (coupon?.usedCount || 0), 0),
    consistent: entries.length === (coupon?.usedCount || 0),
  };
};

/** Pure discount calculation in integer paise; server-authoritative, never client-supplied. */
export const computeCouponDiscount = ({ coupon, amount }) => {
  const amountPaise = toPaise(amount);
  const rawPaise = coupon.type === "percentage" ? Math.round(amountPaise * Number(coupon.value) / 100) : toPaise(coupon.value);
  const cap = coupon.maxDiscount ? toPaise(coupon.maxDiscount) : rawPaise;
  return Math.max(Math.min(rawPaise, cap, amountPaise), 0) / 100;
};

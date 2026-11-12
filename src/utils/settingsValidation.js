// Client-side mirror of backend/utils/settingsValidation.js (instant feedback only; the server is the authority).
// A parity test (backend/tests/settingsValidationParity.test.mjs) fails if the two ever disagree.
const RISK_TIERS = ["low", "medium", "high", "critical"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+()\-\s\d]{6,20}$/;

const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const isValidTimezone = (tz) => {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

/** @returns {Record<string,string>} field path -> message (empty object = valid). Only validates keys that are present. */
export const validateSettingsUpdate = (u = {}) => {
  const e = {};
  if (u.hospitalName !== undefined) {
    const v = typeof u.hospitalName === "string" ? u.hospitalName.trim() : "";
    if (v.length < 2 || v.length > 120) e.hospitalName = "Hospital name must be 2-120 characters";
  }
  if (u.supportEmail !== undefined && !(typeof u.supportEmail === "string" && EMAIL.test(u.supportEmail.trim()) && u.supportEmail.length <= 160)) e.supportEmail = "Enter a valid email address";
  if (u.phone !== undefined && u.phone !== "" && !(typeof u.phone === "string" && PHONE.test(u.phone.trim()))) e.phone = "Enter a valid phone number (digits, +, -, spaces)";
  if (u.logoUrl !== undefined && u.logoUrl !== "" && !(typeof u.logoUrl === "string" && /^https?:\/\/[^\s]+$/i.test(u.logoUrl.trim()) && u.logoUrl.length <= 500)) e.logoUrl = "Logo URL must start with http:// or https://";
  if (u.timezone !== undefined && !isValidTimezone(u.timezone)) e.timezone = "Enter a valid timezone such as Asia/Kolkata";

  if (u.appointmentLimits !== undefined) {
    const a = u.appointmentLimits || {};
    if (a.dailyPerDoctor !== undefined && !(isInt(a.dailyPerDoctor) && a.dailyPerDoctor >= 1 && a.dailyPerDoctor <= 500)) e["appointmentLimits.dailyPerDoctor"] = "Whole number from 1 to 500";
    if (a.bookingWindowDays !== undefined && !(isInt(a.bookingWindowDays) && a.bookingWindowDays >= 1 && a.bookingWindowDays <= 365)) e["appointmentLimits.bookingWindowDays"] = "Whole number from 1 to 365";
  }
  if (u.paymentSettings !== undefined) {
    const p = u.paymentSettings || {};
    if (p.currency !== undefined && !(typeof p.currency === "string" && /^[A-Za-z]{3}$/.test(p.currency.trim()))) e["paymentSettings.currency"] = "Use a 3-letter currency code such as INR";
    if (p.taxRate !== undefined && !(isNum(p.taxRate) && p.taxRate >= 0 && p.taxRate <= 100)) e["paymentSettings.taxRate"] = "A number from 0 to 100";
    if (p.refundsEnabled !== undefined && typeof p.refundsEnabled !== "boolean") e["paymentSettings.refundsEnabled"] = "Must be on or off";
  }
  if (u.operationsCapacity !== undefined) {
    const o = u.operationsCapacity || {};
    if (o.maxOpenItemsPerAdmin !== undefined && !(isInt(o.maxOpenItemsPerAdmin) && o.maxOpenItemsPerAdmin >= 1 && o.maxOpenItemsPerAdmin <= 200)) e["operationsCapacity.maxOpenItemsPerAdmin"] = "Whole number from 1 to 200";
    if (o.overloadThresholdPct !== undefined && !(isInt(o.overloadThresholdPct) && o.overloadThresholdPct >= 1 && o.overloadThresholdPct <= 100)) e["operationsCapacity.overloadThresholdPct"] = "Whole number from 1 to 100";
  }
  if (u.governancePolicy !== undefined) {
    for (const [key, value] of Object.entries(u.governancePolicy || {})) {
      if (!Array.isArray(value) || value.some((t) => !RISK_TIERS.includes(t)) || new Set(value).size !== value.length) e[`governancePolicy.${key}`] = "Choose from low, medium, high, critical";
    }
  }
  return e;
};

/** Normalise accepted values (trim strings, uppercase currency) AFTER validation. */
export const normaliseSettingsUpdate = (u) => {
  const out = { ...u };
  for (const k of ["hospitalName", "supportEmail", "phone", "logoUrl", "timezone"]) if (typeof out[k] === "string") out[k] = out[k].trim();
  if (out.paymentSettings && typeof out.paymentSettings.currency === "string") out.paymentSettings = { ...out.paymentSettings, currency: out.paymentSettings.currency.trim().toUpperCase() };
  return out;
};

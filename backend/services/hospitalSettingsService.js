// ─────────────────────────────────────────────────────────────────────────
// Canonical, cached reader for admin-editable business settings
// (models/HospitalSetting.js) — the ONE place billing/business logic reads
// a setting an admin can change from the dashboard.
//
// Before this file existed, the tax rate an admin configured in
// paymentSettings.taxRate (HospitalSetting) was purely decorative: it was
// only ever read back for public display (controllers/publicController.js).
// The rate actually used to compute what a patient is CHARGED
// (controllers/paymentController.js) and what an INVOICE shows
// (services/invoiceService.js) came from a completely disconnected
// environment variable, CONSULTATION_TAX_RATE, defaulting to 0% if unset --
// so by default, regardless of what an admin configured, no tax was ever
// actually charged or invoiced.
//
// invoiceService.js additionally had a UNIT bug independent of the source:
// its TAX_RATE was validated as a 0-100 PERCENTAGE (env var semantics) but
// then multiplied directly against the subtotal as if it were already a
// FRACTION (`subtotal * TAX_RATE`) -- so CONSULTATION_TAX_RATE=18 (the
// exact value .env.example documents) would have produced an 1800% tax
// line on every generated invoice PDF. getTaxRatePercent() below always
// returns a 0-100 percentage; every caller now divides by 100 itself,
// consistently, matching payments/money.js#calculateBill (which already
// did this correctly).
// ─────────────────────────────────────────────────────────────────────────
import HospitalSetting from "../models/HospitalSetting.js";

const CACHE_TTL_MS = 5000;
let cached = null; // { value, at }

export function clearHospitalSettingsCacheForTesting() {
  cached = null;
}

async function readSettings() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  // NOTE (Appointment Engine Remediation, 2026-09-24): added
  // "appointmentLimits" to this select. It was previously not read by this
  // service at all -- HospitalSetting.appointmentLimits.{dailyPerDoctor,
  // bookingWindowDays} were admin-editable but only ever read back for
  // public display (controllers/publicController.js), never enforced
  // anywhere. See getAppointmentLimits() below, the fix for that gap.
  const doc = await HospitalSetting.findOne({ singletonKey: "global" })
    .select("paymentSettings appointmentLimits")
    .lean();
  cached = { value: doc, at: Date.now() };
  return doc;
}

const DEFAULT_TAX_RATE_PERCENT = HospitalSetting.schema.path("paymentSettings.taxRate")?.defaultValue ?? 18;
const DAILY_PER_DOCTOR_PATH = HospitalSetting.schema.path("appointmentLimits.dailyPerDoctor");
const BOOKING_WINDOW_DAYS_PATH = HospitalSetting.schema.path("appointmentLimits.bookingWindowDays");
const DEFAULT_DAILY_PER_DOCTOR = DAILY_PER_DOCTOR_PATH?.defaultValue ?? 30;
const DEFAULT_BOOKING_WINDOW_DAYS = BOOKING_WINDOW_DAYS_PATH?.defaultValue ?? 30;
// Schema-declared bounds (min: 1/max: 500 and min: 1/max: 365 respectively)
// read from the schema itself rather than re-hardcoded here, so this file
// can never drift out of sync with models/HospitalSetting.js if those
// bounds ever change.
const DAILY_PER_DOCTOR_MIN = DAILY_PER_DOCTOR_PATH?.options?.min ?? 1;
const DAILY_PER_DOCTOR_MAX = DAILY_PER_DOCTOR_PATH?.options?.max ?? 500;
const BOOKING_WINDOW_DAYS_MIN = BOOKING_WINDOW_DAYS_PATH?.options?.min ?? 1;
const BOOKING_WINDOW_DAYS_MAX = BOOKING_WINDOW_DAYS_PATH?.options?.max ?? 365;

/** @returns {Promise<number>} a percentage in [0, 100], never a fraction. */
export async function getTaxRatePercent() {
  const settings = await readSettings();
  const configured = Number(settings?.paymentSettings?.taxRate);
  return Number.isFinite(configured) && configured >= 0 && configured <= 100 ? configured : DEFAULT_TAX_RATE_PERCENT;
}

/** @returns {Promise<boolean>} */
export async function areRefundsEnabled() {
  const settings = await readSettings();
  return settings?.paymentSettings?.refundsEnabled !== false;
}

// ─────────────────────────────────────────────────────────────────────────
// Appointment Engine Remediation (2026-09-24) — canonical reader for the
// two admin-editable appointment limits. Previously decorative (read only
// by publicController.js for display); now the single source of truth
// consumed by services/appointmentBookingPolicyService.js. Any future
// caller must read through here rather than querying HospitalSetting
// directly, so there is exactly one place these two numbers come from.
// @returns {Promise<{dailyPerDoctor: number, bookingWindowDays: number}>}
export async function getAppointmentLimits() {
  const settings = await readSettings();
  const dailyPerDoctorRaw = Number(settings?.appointmentLimits?.dailyPerDoctor);
  const bookingWindowDaysRaw = Number(settings?.appointmentLimits?.bookingWindowDays);
  return {
    dailyPerDoctor:
      Number.isFinite(dailyPerDoctorRaw) &&
      dailyPerDoctorRaw >= DAILY_PER_DOCTOR_MIN &&
      dailyPerDoctorRaw <= DAILY_PER_DOCTOR_MAX
        ? Math.floor(dailyPerDoctorRaw)
        : DEFAULT_DAILY_PER_DOCTOR,
    bookingWindowDays:
      Number.isFinite(bookingWindowDaysRaw) &&
      bookingWindowDaysRaw >= BOOKING_WINDOW_DAYS_MIN &&
      bookingWindowDaysRaw <= BOOKING_WINDOW_DAYS_MAX
        ? Math.floor(bookingWindowDaysRaw)
        : DEFAULT_BOOKING_WINDOW_DAYS,
  };
}

// Regression test for a real, confirmed billing-accuracy bug: the tax rate
// an admin configures in Admin > Settings (HospitalSetting.paymentSettings.
// taxRate) was purely decorative -- what a patient was actually CHARGED
// (paymentController.js) and what an INVOICE showed (invoiceService.js)
// both came from a disconnected env var, CONSULTATION_TAX_RATE, defaulting
// to 0% if unset. invoiceService.js additionally had a unit bug: its rate
// was validated as a 0-100 percentage but multiplied directly against the
// subtotal with no /100 -- CONSULTATION_TAX_RATE=18 (the exact value
// .env.example documented) would have produced an 1800% tax line on every
// invoice.
import assert from "node:assert/strict";
import fs from "node:fs";
import HospitalSetting from "../models/HospitalSetting.js";
import { calculateBill } from "../payments/money.js";
import {
  areRefundsEnabled,
  clearHospitalSettingsCacheForTesting,
  getTaxRatePercent,
} from "../services/hospitalSettingsService.js";
import { calculateInvoiceAmounts } from "../services/invoiceService.js";

console.log("canonicalTaxRate.test.mjs");

let settingsDoc = null;
HospitalSetting.findOne = () => ({ select: () => ({ lean: async () => settingsDoc }) });

// ── getTaxRatePercent reads the admin-configured value, not an env var ──
clearHospitalSettingsCacheForTesting();
settingsDoc = { paymentSettings: { taxRate: 18, refundsEnabled: true } };
assert.equal(await getTaxRatePercent(), 18);
clearHospitalSettingsCacheForTesting();
settingsDoc = { paymentSettings: { taxRate: 5 } };
assert.equal(await getTaxRatePercent(), 5, "changing the admin setting must change what getTaxRatePercent returns");
console.log("PASS: getTaxRatePercent reflects the admin-configured HospitalSetting value");

// ── sensible fallback when nothing is configured yet ─────────────────────
clearHospitalSettingsCacheForTesting();
settingsDoc = null;
assert.equal(await getTaxRatePercent(), 18, "must fall back to the schema default, not silently 0%");
clearHospitalSettingsCacheForTesting();
settingsDoc = { paymentSettings: { taxRate: 150 } }; // out of the schema's valid 0-100 range
assert.equal(await getTaxRatePercent(), 18, "an out-of-range stored value must fall back to the default, not be used verbatim");
console.log("PASS: a missing or invalid setting falls back to the real default (18%), never silently to 0%");

// ── refunds toggle ────────────────────────────────────────────────────────
clearHospitalSettingsCacheForTesting();
settingsDoc = { paymentSettings: { refundsEnabled: false } };
assert.equal(await areRefundsEnabled(), false);
clearHospitalSettingsCacheForTesting();
settingsDoc = { paymentSettings: {} };
assert.equal(await areRefundsEnabled(), true, "must default to enabled when unset");
console.log("PASS: areRefundsEnabled reflects the admin setting with a safe default");

// ── the unit bug: invoiceService must divide by 100, matching calculateBill ──
clearHospitalSettingsCacheForTesting();
settingsDoc = { paymentSettings: { taxRate: 18 } };
const invoiceAmounts = await calculateInvoiceAmounts(1000);
assert.equal(invoiceAmounts.taxAmount, 180, "18% of 1000 must be 180, not 18000 (the old *TAX_RATE-with-no-/100 bug)");
assert.equal(invoiceAmounts.totalAmount, 1180);

const bill = calculateBill({ subtotal: 1000, discount: 0, taxRate: 18 });
assert.equal(bill.tax, invoiceAmounts.taxAmount, "the invoice's tax figure must agree with what calculateBill actually charges");
console.log("PASS: invoiceService's tax calculation is percentage-correct and agrees with the real charge (calculateBill)");

// ── source-level: the disconnected env var is gone from both call sites ──
const root = new URL("../", import.meta.url).pathname;
const paymentControllerSrc = fs.readFileSync(`${root}controllers/paymentController.js`, "utf8");
const invoiceServiceSrc = fs.readFileSync(`${root}services/invoiceService.js`, "utf8");
assert.doesNotMatch(paymentControllerSrc, /process\.env\.CONSULTATION_TAX_RATE/);
assert.doesNotMatch(invoiceServiceSrc, /process\.env\.CONSULTATION_TAX_RATE/);
assert.match(paymentControllerSrc, /getTaxRatePercent\(\)/);
assert.match(invoiceServiceSrc, /getTaxRatePercent\(\)/);
console.log("PASS: neither call site reads the disconnected CONSULTATION_TAX_RATE env var anymore");

const envExample = fs.readFileSync(`${root}.env.example`, "utf8");
assert.doesNotMatch(envExample, /^CONSULTATION_TAX_RATE=/m, ".env.example must not document a variable that is no longer read");
console.log("PASS: .env.example no longer documents the obsolete env var");

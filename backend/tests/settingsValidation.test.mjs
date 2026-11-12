import assert from "node:assert/strict";
import { validateSettingsUpdate as v, normaliseSettingsUpdate as n, isValidTimezone } from "../utils/settingsValidation.js";
let c = 0; const ok = (m) => { c += 1; console.log("PASS:", m); };

assert.deepEqual(v({}), {}); assert.deepEqual(v({ hospitalName: "City Hospital", supportEmail: "a@b.co", phone: "+91 98765-43210", timezone: "Asia/Kolkata", logoUrl: "https://x.test/l.png",
  appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 }, paymentSettings: { currency: "inr", taxRate: 18, refundsEnabled: true }, operationsCapacity: { maxOpenItemsPerAdmin: 12, overloadThresholdPct: 85 },
  governancePolicy: { approvalRequiredTiers: ["high"], simulationRequiredTiers: [] } }), {}); ok("a normal settings payload is valid");

// the autosave bug: Number("") === 0 reached the server as a tax rate of 0, and 'NaN' became null
assert.ok(v({ paymentSettings: { taxRate: NaN } })["paymentSettings.taxRate"]);
assert.ok(v({ paymentSettings: { taxRate: "" } })["paymentSettings.taxRate"], "an empty string is not a number");
assert.ok(v({ paymentSettings: { taxRate: -1 } })["paymentSettings.taxRate"]); assert.ok(v({ paymentSettings: { taxRate: 100.5 } })["paymentSettings.taxRate"]);
assert.deepEqual(v({ paymentSettings: { taxRate: 0 } }), {}, "a deliberate 0% is allowed"); ok("tax rate: NaN/''/negative/>100 rejected, 0 and 100 allowed");

for (const bad of [0, 501, 2.5, "5", null, NaN, Infinity]) assert.ok(v({ appointmentLimits: { dailyPerDoctor: bad } })["appointmentLimits.dailyPerDoctor"], `daily ${bad}`);
for (const bad of [0, 366, 1.5]) assert.ok(v({ appointmentLimits: { bookingWindowDays: bad } })["appointmentLimits.bookingWindowDays"]);
for (const bad of [0, 101, 85.5]) assert.ok(v({ operationsCapacity: { overloadThresholdPct: bad } })["operationsCapacity.overloadThresholdPct"]);
for (const bad of [0, 201]) assert.ok(v({ operationsCapacity: { maxOpenItemsPerAdmin: bad } })["operationsCapacity.maxOpenItemsPerAdmin"]); ok("integer ranges enforced (daily, window, overload %, open items)");

for (const bad of ["", " ", "a", "x".repeat(121), null, 5]) assert.ok(v({ hospitalName: bad }).hospitalName, `name ${bad}`);
for (const bad of ["", "nope", "a@b", "a b@c.de", "@x.com"]) assert.ok(v({ supportEmail: bad }).supportEmail, `email ${bad}`);
for (const bad of ["abc", "123", "1".repeat(30)]) assert.ok(v({ phone: bad }).phone); assert.deepEqual(v({ phone: "" }), {}, "phone is optional");
for (const bad of ["ftp://x", "javascript:alert(1)", "x.png"]) assert.ok(v({ logoUrl: bad }).logoUrl, `logo ${bad}`); assert.deepEqual(v({ logoUrl: "" }), {}); ok("name, email, phone, logo url");

assert.equal(isValidTimezone("Asia/Kolkata"), true); assert.equal(isValidTimezone("Mars/Base"), false); assert.equal(isValidTimezone(""), false); assert.equal(isValidTimezone(null), false);
for (const bad of ["", "IN", "INRR", "12$", null]) assert.ok(v({ paymentSettings: { currency: bad } })["paymentSettings.currency"], `currency ${bad}`);
assert.ok(v({ paymentSettings: { refundsEnabled: "yes" } })["paymentSettings.refundsEnabled"]); ok("timezone, currency, refundsEnabled type");

assert.ok(v({ governancePolicy: { approvalRequiredTiers: ["high", "root"] } })["governancePolicy.approvalRequiredTiers"]);
assert.ok(v({ governancePolicy: { approvalRequiredTiers: ["high", "high"] } })["governancePolicy.approvalRequiredTiers"]);
assert.ok(v({ governancePolicy: { approvalRequiredTiers: "high" } })["governancePolicy.approvalRequiredTiers"]); ok("governance tiers: unknown, duplicate, non-array rejected");

const norm = n({ hospitalName: "  City  ", paymentSettings: { currency: " inr ", taxRate: 5 } });
assert.equal(norm.hospitalName, "City"); assert.equal(norm.paymentSettings.currency, "INR"); assert.equal(norm.paymentSettings.taxRate, 5); ok("normalisation trims and uppercases currency");
console.log(`\n${c} settings validation groups passed`);

import assert from "node:assert/strict";
import * as server from "../utils/settingsValidation.js";
import * as client from "../../src/utils/settingsValidation.js";
const cases = [
  {}, { hospitalName: "" }, { hospitalName: "Ok Hospital" }, { supportEmail: "bad" }, { supportEmail: "a@b.co" }, { phone: "abc" }, { phone: "+91 99999 99999" }, { logoUrl: "javascript:1" }, { logoUrl: "https://a.b/c.png" },
  { timezone: "Mars/Base" }, { timezone: "Asia/Kolkata" }, { appointmentLimits: { dailyPerDoctor: 0, bookingWindowDays: 400 } }, { appointmentLimits: { dailyPerDoctor: 5, bookingWindowDays: 7 } },
  { paymentSettings: { currency: "x", taxRate: NaN, refundsEnabled: "y" } }, { paymentSettings: { currency: "inr", taxRate: 0, refundsEnabled: false } },
  { operationsCapacity: { maxOpenItemsPerAdmin: 0, overloadThresholdPct: 101 } }, { operationsCapacity: { maxOpenItemsPerAdmin: 10, overloadThresholdPct: 90 } },
  { governancePolicy: { approvalRequiredTiers: ["x"], simulationRequiredTiers: ["low", "low"] } }, { governancePolicy: { approvalRequiredTiers: ["high"] } },
];
for (const c of cases) assert.deepEqual(client.validateSettingsUpdate(c), server.validateSettingsUpdate(c), JSON.stringify(c));
assert.deepEqual(client.normaliseSettingsUpdate({ hospitalName: " A ", paymentSettings: { currency: "inr" } }), server.normaliseSettingsUpdate({ hospitalName: " A ", paymentSettings: { currency: "inr" } }));
console.log(`settingsValidationParity: ${cases.length} cases identical on client and server`);

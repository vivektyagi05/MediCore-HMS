// S2 regression: buildSmartAlerts only needs counts, so it must use countDocuments (no full-document find()) with the
// same filters as before, and the alert output (keys, counts, priority thresholds) must not change.
import assert from "assert";
import Doctor from "../models/Doctor.js";
import RefundRequest from "../models/RefundRequest.js";
import Insurance from "../models/Insurance.js";
import MedicalReport from "../models/MedicalReport.js";
import Payment from "../models/Payment.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { buildSmartAlerts } from "../controllers/admin/missionControlAdminController.js";

const models = { Doctor, RefundRequest, Insurance, MedicalReport, Payment, NotificationDelivery };
const originals = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, { find: m.find, countDocuments: m.countDocuments }]));
const counts = {};
const filters = {};
const finds = [];

const install = (values) => {
  finds.length = 0;
  for (const [name, model] of Object.entries(models)) {
    counts[name] = values[name] ?? 0;
    model.find = (...args) => { finds.push(name); throw new Error(`${name}.find must not be used by buildSmartAlerts (got ${JSON.stringify(args)})`); };
    model.countDocuments = async (filter) => { filters[name] = filter; return counts[name]; };
  }
};
const restore = () => { for (const [name, model] of Object.entries(models)) Object.assign(model, originals[name]); };
const alertByKey = (result, key) => result.alerts.find((a) => a.key === key);

try {
  // 1. No data -> none of the six data-driven alerts (the DB-warning alert depends on the test process, ignore it).
  install({});
  let result = await buildSmartAlerts();
  const dataKeys = ["doctor-verification-backlog", "refund-backlog", "insurance-expiring", "payment-failures", "critical-reports", "unread-critical-notifications"];
  for (const key of dataKeys) assert.strictEqual(alertByKey(result, key), undefined, `${key} must be absent at count 0`);
  assert.deepStrictEqual(finds, [], "no find() calls");
  console.log("PASS: zero counts raise no data alerts and no find() is issued");

  // 2. Counts flow straight into alert.count, with unchanged keys/priorities/links.
  install({ Doctor: 3, RefundRequest: 2, Insurance: 4, Payment: 5, MedicalReport: 6, NotificationDelivery: 7 });
  result = await buildSmartAlerts();
  assert.deepStrictEqual(
    dataKeys.map((key) => { const a = alertByKey(result, key); return [key, a.count, a.priority, a.link]; }),
    [
      ["doctor-verification-backlog", 3, "high", "/admin/doctors"],
      ["refund-backlog", 2, "critical", "/admin/refunds"],
      ["insurance-expiring", 4, "medium", "/admin/patients"],
      ["payment-failures", 5, "medium", "/admin/payments"],
      ["critical-reports", 6, "critical", "/admin/patients"],
      ["unread-critical-notifications", 7, "critical", "/admin/notifications"],
    ],
  );
  console.log("PASS: counts, priorities and links are unchanged");

  // 3. Payment-failure priority threshold stays at > 5.
  install({ Payment: 6 });
  assert.strictEqual(alertByKey(await buildSmartAlerts(), "payment-failures").priority, "high");
  console.log("PASS: payment-failures priority threshold unchanged (>5 is high)");

  // 4. Filters are exactly the ones the old find() calls used.
  install({});
  await buildSmartAlerts();
  assert.deepStrictEqual({ verificationStatus: filters.Doctor.verificationStatus, hasLte: filters.Doctor.createdAt.$lte instanceof Date }, { verificationStatus: "pending", hasLte: true });
  assert.deepStrictEqual({ status: filters.RefundRequest.status, hasLte: filters.RefundRequest.createdAt.$lte instanceof Date }, { status: "pending", hasLte: true });
  assert.deepStrictEqual(filters.Insurance.claimStatus, { $nin: ["approved", "rejected"] });
  assert.ok(filters.Insurance.validTill.$gte instanceof Date && filters.Insurance.validTill.$lte instanceof Date);
  assert.deepStrictEqual(filters.MedicalReport, { severity: "critical", reviewedAt: null });
  assert.deepStrictEqual(filters.NotificationDelivery, { severity: "critical", readAt: null });
  const doctorWindow = Date.now() - filters.Doctor.createdAt.$lte.getTime();
  const refundWindow = Date.now() - filters.RefundRequest.createdAt.$lte.getTime();
  assert.ok(Math.abs(doctorWindow - 2 * 86400000) < 5000, "doctor backlog window stays 2 days");
  assert.ok(Math.abs(refundWindow - 7 * 86400000) < 5000, "refund backlog window stays 7 days");
  console.log("PASS: count filters and time windows match the previous queries");
} finally {
  restore();
}
console.log("ALL SMART-ALERT COUNT-QUERY TESTS PASSED");

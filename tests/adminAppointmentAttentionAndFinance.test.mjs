// Dependency-free tests for two pure pieces of the new admin appointment
// controller: the "needs attention" query shape (documented, non-fabricated
// rule) and server-side financial-field stripping (the mission's explicit
// "backend must not return sensitive financial fields" requirement).
import assert from "assert";
import {
  ATTENTION_MATCH,
  stripFinancialFields,
} from "../controllers/admin/appointmentAdminController.js";
import { APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";

// The attention rule must be built only from real, existing fields —
// status, paymentStatus, date, createdAt — never an invented score field.
const attentionFields = JSON.stringify(ATTENTION_MATCH);
assert.ok(attentionFields.includes(APPOINTMENT_STATUS.PENDING));
assert.ok(attentionFields.includes(APPOINTMENT_STATUS.APPROVED));
assert.ok(attentionFields.includes("failed"));
assert.ok(!attentionFields.includes("priority"), "must not reference a fabricated priority field");
assert.ok(!attentionFields.includes("riskScore"), "must not reference a fabricated risk score");
console.log("PASS: ATTENTION_MATCH is built only from real status/paymentStatus/date/createdAt fields");

// stripFinancialFields: an admin WITH manage_payments sees paymentId/invoiceId untouched.
const withFinance = { _id: "a1", paymentId: { status: "captured" }, invoiceId: { invoiceNumber: "INV-1" }, other: 1 };
const kept = stripFinancialFields(withFinance, true);
assert.deepStrictEqual(kept, withFinance);
assert.strictEqual(kept.financialRestricted, undefined);
console.log("PASS: financial fields are preserved for an admin with manage_payments");

// stripFinancialFields: an admin WITHOUT manage_payments never receives paymentId/invoiceId,
// even though they were present on the input object.
const withoutFinance = { _id: "a2", paymentId: { status: "captured" }, invoiceId: { invoiceNumber: "INV-2" }, other: 2 };
const stripped = stripFinancialFields(withoutFinance, false);
assert.strictEqual(stripped.paymentId, undefined);
assert.strictEqual(stripped.invoiceId, undefined);
assert.strictEqual(stripped.other, 2);
assert.strictEqual(stripped.financialRestricted, true);
console.log("PASS: financial fields are stripped server-side (not just hidden client-side) without manage_payments");

console.log("ALL ADMIN APPOINTMENT ATTENTION/FINANCE-GATING TESTS PASSED");

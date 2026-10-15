import assert from "assert";
import EmailDelivery from "../models/EmailDelivery.js";
import { financialEmails } from "../services/financialEmails.js";
// Validation-only: build documents the outbox would create and make sure they satisfy the schema.
const captured = [];
EmailDelivery.create = async (doc) => { const d = new EmailDelivery(doc); await d.validate(); captured.push(doc); return d; };
const user = { _id: "507f1f77bcf86cd799439011", email: "a@example.com", name: "<b>Dr X</b>" };
const oid = "507f1f77bcf86cd799439012";
await financialEmails.paymentReceipt({ payment: { _id: oid, totalAmount: 500, currency: "INR" }, invoice: { invoiceNumber: "INV-1" }, user });
await financialEmails.refundProcessed({ payment: { _id: oid, currency: "INR" }, refundId: "rfnd_1", amount: 100, user });
await financialEmails.subscriptionActivated({ subscription: { _id: oid, gatewayPaymentId: "pay_1", amount: 2999, currency: "INR", planName: "Premium" }, user });
await financialEmails.withdrawalManuallySettled({ withdrawal: { _id: oid, processedAmount: 100, settlementReference: "UTR1" }, user });
assert.strictEqual(captured.length, 4);
assert.ok(captured.every((d) => d.eventKey && d.to && d.entityType), "every financial mail has an idempotency key, recipient and entity");
assert.ok(!captured[0].html.includes("<b>Dr X"), "user-controlled text must be HTML-escaped");
assert.ok(captured[3].html.includes("manual settlement"), "manual settlement is never worded as a bank transfer confirmation");
assert.strictEqual(new Set(captured.map((d) => d.eventKey)).size, 4);
console.log("PASS: financial emails are schema-valid, keyed, escaped and truthfully worded");
process.exit(0);

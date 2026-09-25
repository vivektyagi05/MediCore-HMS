// Regression test for the P0 analytics bug: Payment.status is a rich
// lifecycle enum (created/order_created/checkout_started/pending/authorized/
// captured/verification_pending/post_processing/completed/
// post_processing_failed/reconciliation_required/failed/cancelled/expired/
// refunded/partially_refunded) that NEVER contains the string "paid". Two
// sites compared Payment.status to "paid" directly, so doctor revenue and
// the "paid" revenue-funnel bucket were always zero. "paid" IS a legal value
// of the separate, deliberately simpler Appointment.paymentStatus enum
// (pending/paid/failed/refunded) used for booking-flow gating -- the two
// must never be confused.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAYMENT_STATUS, CAPTURED_LIKE_PAYMENT_STATUSES } from "../models/Payment.js";

console.log("paymentStatusCanonical.test.mjs");

assert.deepEqual(CAPTURED_LIKE_PAYMENT_STATUSES, [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.PARTIALLY_REFUNDED]);
assert.ok(!Object.values(PAYMENT_STATUS).includes("paid"), "sanity: 'paid' really is not a Payment.status value");
console.log("PASS: the canonical captured-like group is exactly captured/refunded/partially_refunded");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (["node_modules", "tests"].includes(e.name)) return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
});

// Any comparison of a *Payment* document's .status field to the literal
// "paid" is the exact bug class. This deliberately does NOT flag
// appointment.paymentStatus === "paid" (or PAYMENT_STATUS.PAID from
// constants/appointmentStatus.js), which is legitimate.
const paymentDotStatusPaid = /\bpayment\.status\s*===?\s*"paid"|status:\s*"paid"[^}]*(?:Payment\.|payment)|p\.status\s*===\s*"paid"/i;
const offenders = walk(root)
  .filter((f) => !f.endsWith("Payment.js")) // the model file itself only *defines* the enum, never compares to "paid"
  .map((f) => ({ f, src: fs.readFileSync(f, "utf8") }))
  .filter(({ src }) => paymentDotStatusPaid.test(src))
  .map(({ f }) => path.relative(root, f));
assert.deepEqual(offenders, [], `Payment.status must never be compared to the literal "paid": ${offenders.join(", ")}`);
console.log("PASS: no code compares a Payment document's status to the non-existent value 'paid'");

// No second, drifted definition of the captured-like group.
const duplicateDefinition = /const\s+CAPTURED_LIKE\s*=\s*\[/;
const dupOffenders = walk(root).filter((f) => duplicateDefinition.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
assert.deepEqual(dupOffenders, [], `a local duplicate of the captured-like group must not be redefined: ${dupOffenders.join(", ")}`);
console.log("PASS: exactly one definition of the captured-like payment status group exists");

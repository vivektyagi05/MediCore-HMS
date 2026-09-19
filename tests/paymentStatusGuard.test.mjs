// Verifies the exact guard logic added to completePaymentPostProcessing:
// PAYMENT_COMPLETED must only be applied when it's a legal transition from
// the appointment's CURRENT status, per STATUS_TRANSITIONS. This is a
// dependency-free re-check of that decision table (no DB needed).
import { STATUS_TRANSITIONS, APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import assert from "assert";

const isLegal = (currentStatus) =>
  (STATUS_TRANSITIONS[currentStatus] || []).includes(APPOINTMENT_STATUS.PAYMENT_COMPLETED);

assert.strictEqual(isLegal(APPOINTMENT_STATUS.PAYMENT_PENDING), true);
console.log("PASS: payment_pending -> payment_completed is legal (the normal path)");

assert.strictEqual(isLegal(APPOINTMENT_STATUS.CANCELLED), false);
console.log("PASS: cancelled -> payment_completed is illegal (must NOT resurrect a cancelled appointment)");

assert.strictEqual(isLegal(APPOINTMENT_STATUS.APPROVED), false);
console.log("PASS: approved -> payment_completed is illegal (must go through payment_pending first)");

assert.strictEqual(isLegal(APPOINTMENT_STATUS.PAYMENT_COMPLETED), false);
console.log("PASS: payment_completed -> payment_completed is illegal (already there, no-op expected, not a re-write)");

console.log("ALL PAYMENT STATUS GUARD TESTS PASSED");

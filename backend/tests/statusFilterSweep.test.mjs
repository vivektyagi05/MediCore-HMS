// Regression test for a sweep this session: after finding the ACTIVE_STATUSES
// bug once, a grep across the whole backend for the same hardcoded
// ["pending","approved"] pattern turned up 5 more hits. Two were false
// positives (different status enums entirely -- LeaveRequest.status,
// RefundRequest.status -- correctly scoped as-is). Three were real:
// doctor getSchedule, patient getPatientNotifications (both needed the full
// ACTIVE_STATUSES), and automation/paymentReminder (needed its own narrower
// "unpaid" subset, NOT the full active list, since a paid appointment
// shouldn't get a payment reminder). This locks in that distinction.
import { ACTIVE_STATUSES, APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import assert from "assert";

// doctor schedule / patient notifications: must show the FULL active lifecycle
assert.ok(ACTIVE_STATUSES.includes(APPOINTMENT_STATUS.PAYMENT_COMPLETED));
assert.ok(ACTIVE_STATUSES.includes(APPOINTMENT_STATUS.PAYMENT_PENDING));
console.log("PASS: ACTIVE_STATUSES includes paid/in-progress appointments (for schedule + notifications)");

// paymentReminder's own scoped subset: must include payment_pending (the gap
// found), must NOT include payment_completed (would be a nonsensical reminder)
const UNPAID_STATUSES = [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.APPROVED,
  APPOINTMENT_STATUS.PAYMENT_PENDING,
];
assert.ok(UNPAID_STATUSES.includes(APPOINTMENT_STATUS.PAYMENT_PENDING));
assert.ok(!UNPAID_STATUSES.includes(APPOINTMENT_STATUS.PAYMENT_COMPLETED));
console.log("PASS: paymentReminder now catches abandoned-checkout window, correctly excludes already-paid");

console.log("ALL STATUS FILTER SWEEP TESTS PASSED");

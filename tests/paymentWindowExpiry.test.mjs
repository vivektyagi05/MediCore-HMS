// Regression test for the payment-window expiry gap found this session:
// nothing ever auto-cancelled a PAYMENT_PENDING appointment whose patient
// never paid, so the slot stayed permanently blocked. Verifies the legal
// transition this relies on, and the cancelReason field actually persists
// (the bug where it silently vanished on save).
import { STATUS_TRANSITIONS, APPOINTMENT_STATUS } from "../constants/appointmentStatus.js";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import assert from "assert";

assert.ok(
  (STATUS_TRANSITIONS[APPOINTMENT_STATUS.PAYMENT_PENDING] || []).includes(APPOINTMENT_STATUS.CANCELLED),
  "payment_pending -> cancelled must be a legal transition for auto-expiry to be allowed to fire",
);
console.log("PASS: payment_pending -> cancelled is a legal transition");

// Schema-level check: cancelReason must actually be a declared path, or
// Mongoose silently drops it on save (the exact bug that was found).
const cancelReasonPath = Appointment.schema.path("cancelReason");
assert.ok(cancelReasonPath, "cancelReason must be declared on the Appointment schema or it silently vanishes on save");
assert.strictEqual(cancelReasonPath.instance, "String");
console.log("PASS: cancelReason is a real, persisted schema field");

console.log("ALL PAYMENT WINDOW EXPIRY TESTS PASSED");

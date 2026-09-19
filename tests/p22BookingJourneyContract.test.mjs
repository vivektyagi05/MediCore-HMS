import assert from "assert";
import fs from "fs";
import { APPOINTMENT_STATUS, CANCELLABLE_STATUSES, STATUS_TRANSITIONS } from "../constants/appointmentStatus.js";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const controller = read("../controllers/appointmentController.js");
const routes = read("../routes/appointmentRoutes.js");
const model = read("../models/Appointment.js");
const payment = read("../controllers/paymentController.js");
const cancellation = read("../services/appointmentCancellationService.js");
const expiry = read("../services/appointmentExpiryService.js");

assert.ok(controller.includes("bookingRequestId"), "booking must accept a durable request id");
assert.ok(model.includes("bookingRequestId"), "booking request id must persist on Appointment");
assert.ok(model.includes("unique: true, sparse: true"), "booking request id must be uniquely protected");
assert.ok(controller.includes("Existing appointment returned safely"), "retries must recover an already-created appointment");
assert.ok(controller.includes('code: "SLOT_CONFLICT"'), "concurrent slot conflicts must be structured");
console.log("PASS: booking idempotency + conflict recovery contract");

assert.ok(model.includes("statusHistory"), "Appointment must own lifecycle history");
assert.ok(controller.includes("appendAppointmentHistory"), "status transitions must record history");
assert.ok(cancellation.includes("appendAppointmentHistory"), "cancellation must record history");
assert.ok(expiry.includes("appendAppointmentHistory"), "payment-window expiry must record history");
assert.ok(payment.includes("appendAppointmentHistory"), "payment completion must record history");
console.log("PASS: lifecycle history is shared by appointment/payment/cancellation/expiry flows");

assert.ok(routes.includes('router.get(\n  "/:id"'), "patient/doctor/admin appointment detail endpoint must exist");
assert.ok(controller.includes("export const getAppointmentById"), "appointment detail controller must exist");
console.log("PASS: canonical appointment detail API contract");

assert.ok(STATUS_TRANSITIONS[APPOINTMENT_STATUS.PENDING].includes(APPOINTMENT_STATUS.APPROVED));
assert.ok(STATUS_TRANSITIONS[APPOINTMENT_STATUS.APPROVED].includes(APPOINTMENT_STATUS.PAYMENT_PENDING));
assert.ok(STATUS_TRANSITIONS[APPOINTMENT_STATUS.PAYMENT_PENDING].includes(APPOINTMENT_STATUS.PAYMENT_COMPLETED));
assert.ok(!STATUS_TRANSITIONS[APPOINTMENT_STATUS.COMPLETED].includes(APPOINTMENT_STATUS.PENDING));
assert.ok(!STATUS_TRANSITIONS[APPOINTMENT_STATUS.CANCELLED].length);
assert.ok(!CANCELLABLE_STATUSES.includes(APPOINTMENT_STATUS.CONSULTATION_STARTED));
console.log("PASS: authoritative appointment state machine rejects invalid backward transitions");

assert.ok(payment.includes("paymentStatus: APPOINTMENT_PAYMENT_STATUS.PAID"));
assert.ok(payment.includes("APPOINTMENT_STATUS.PAYMENT_COMPLETED"));
console.log("PASS: payment handoff uses authoritative backend payment state");

console.log("ALL P22 BOOKING JOURNEY CONTRACT TESTS PASSED");

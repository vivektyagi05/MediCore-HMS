import assert from "assert";
import { validateAppointmentCreate } from "../validations/appointmentValidation.js";

// 1. Existing minimal payload still passes (backward compatibility)
let result = validateAppointmentCreate({ doctorId: "507f1f77bcf86cd799439011", date: "2026-08-01", timeSlot: "09:00-09:30" });
assert.strictEqual(result.isValid, true, "minimal legacy payload should still validate");
console.log("PASS: legacy minimal payload still validates");

// 2. Valid full Appointment Journey payload passes
result = validateAppointmentCreate({
  doctorId: "507f1f77bcf86cd799439011",
  date: "2026-08-01",
  timeSlot: "09:00-09:30",
  consultationMode: "online",
  reason: "Follow-up visit",
  symptoms: ["Fever", "Cough"],
  painLevel: 4,
  existingConditions: ["Diabetes"],
  currentMedications: ["Metformin"],
  allergies: ["Penicillin"],
  specialAssistance: "Wheelchair access",
  emergencyContact: { name: "Jane", phone: "9999999999" },
  insuranceId: "507f1f77bcf86cd799439012",
  reportIds: ["507f1f77bcf86cd799439013"],
});
assert.strictEqual(result.isValid, true, "full valid Appointment Journey payload should validate");
console.log("PASS: full visit-intake payload validates");

// 3. Invalid consultationMode rejected
result = validateAppointmentCreate({ doctorId: "x", date: "2026-08-01", timeSlot: "09:00-09:30", consultationMode: "telepathy" });
assert.strictEqual(result.isValid, false);
assert.ok(result.errors.consultationMode);
console.log("PASS: invalid consultationMode rejected");

// 4. Out-of-range painLevel rejected
result = validateAppointmentCreate({ doctorId: "x", date: "2026-08-01", timeSlot: "09:00-09:30", painLevel: 15 });
assert.strictEqual(result.isValid, false);
assert.ok(result.errors.painLevel);
console.log("PASS: out-of-range painLevel rejected");

// 5. Non-array symptoms rejected
result = validateAppointmentCreate({ doctorId: "x", date: "2026-08-01", timeSlot: "09:00-09:30", symptoms: "Fever" });
assert.strictEqual(result.isValid, false);
assert.ok(result.errors.symptoms);
console.log("PASS: non-array symptoms rejected");

// 6. Invalid insuranceId format rejected
result = validateAppointmentCreate({ doctorId: "x", date: "2026-08-01", timeSlot: "09:00-09:30", insuranceId: "not-an-object-id" });
assert.strictEqual(result.isValid, false);
assert.ok(result.errors.insuranceId);
console.log("PASS: malformed insuranceId rejected");

// 7. Invalid reportIds entries rejected
result = validateAppointmentCreate({ doctorId: "x", date: "2026-08-01", timeSlot: "09:00-09:30", reportIds: ["not-an-object-id"] });
assert.strictEqual(result.isValid, false);
assert.ok(result.errors.reportIds);
console.log("PASS: malformed reportIds rejected");

// 8. Reason over 300 chars rejected
result = validateAppointmentCreate({ doctorId: "x", date: "2026-08-01", timeSlot: "09:00-09:30", reason: "a".repeat(301) });
assert.strictEqual(result.isValid, false);
assert.ok(result.errors.reason);
console.log("PASS: overlong reason rejected");

console.log("ALL APPOINTMENT JOURNEY VALIDATION TESTS PASSED");

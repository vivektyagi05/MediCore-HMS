import assert from "assert";
import {
  DOCTOR_CONSULTATION_MODES,
  APPOINTMENT_CONSULTATION_MODES,
  canonicalizeConsultationMode,
  isKnownDoctorConsultationMode,
  isKnownAppointmentConsultationMode,
} from "../constants/consultationMode.js";
import { validateAppointmentCreate } from "../validations/appointmentValidation.js";

// 1. Canonicalization contract — the exact bug from the runtime log:
//    a doctor with consultationMode "offline" must map to "in_person",
//    the value every other Appointment consumer already reads/writes.
assert.strictEqual(canonicalizeConsultationMode("offline"), "in_person");
assert.strictEqual(canonicalizeConsultationMode("online"), "online");
assert.strictEqual(canonicalizeConsultationMode("home_visit"), "home_visit");
console.log("PASS: offline canonicalizes to in_person, online/home_visit pass through unchanged");

// 2. Unknown/garbage Doctor-side values must never silently canonicalize —
//    no fake fallback that makes an unavailable mode bookable.
assert.strictEqual(canonicalizeConsultationMode("both"), undefined);
assert.strictEqual(canonicalizeConsultationMode(""), undefined);
assert.strictEqual(canonicalizeConsultationMode(undefined), undefined);
console.log("PASS: unknown doctor-side values do not canonicalize to anything");

// 3. Producer/consumer vocabularies match exactly what the rest of the
//    codebase depends on (Doctor.js model, Appointment.js model).
assert.deepStrictEqual([...DOCTOR_CONSULTATION_MODES], ["online", "offline", "home_visit"]);
assert.deepStrictEqual([...APPOINTMENT_CONSULTATION_MODES], ["online", "in_person", "home_visit"]);
console.log("PASS: producer/consumer vocabularies match Doctor/Appointment schemas");

// 4. isKnown* guards
assert.strictEqual(isKnownDoctorConsultationMode("offline"), true);
assert.strictEqual(isKnownDoctorConsultationMode("in_person"), false); // in_person is Appointment-side only
assert.strictEqual(isKnownAppointmentConsultationMode("in_person"), true);
assert.strictEqual(isKnownAppointmentConsultationMode("offline"), false); // offline is Doctor-side only
console.log("PASS: isKnownDoctorConsultationMode/isKnownAppointmentConsultationMode stay scoped to their own vocabulary");

// 5. validateAppointmentCreate now validates the CANONICAL vocabulary
//    (post-canonicalization), including the previously-unreachable
//    "home_visit" value, and still rejects anything else.
const base = { doctorId: "507f1f77bcf86cd799439011", date: "2099-01-01", timeSlot: "09:00-09:30" };
assert.strictEqual(validateAppointmentCreate({ ...base, consultationMode: "in_person" }).isValid, true);
assert.strictEqual(validateAppointmentCreate({ ...base, consultationMode: "home_visit" }).isValid, true);
assert.strictEqual(validateAppointmentCreate({ ...base, consultationMode: "online" }).isValid, true);
assert.strictEqual(validateAppointmentCreate({ ...base, consultationMode: "" }).isValid, true);
const rejected = validateAppointmentCreate({ ...base, consultationMode: "offline" });
assert.strictEqual(rejected.isValid, false);
assert.ok(typeof rejected.errors.consultationMode === "string");
console.log("PASS: validateAppointmentCreate accepts the canonical vocabulary (incl. home_visit), rejects raw doctor-side values");

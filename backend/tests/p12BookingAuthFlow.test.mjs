import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (file) => fs.readFileSync(
  file.startsWith("../src/") ? path.resolve(__dirname, "..", "..", file.slice(3)) : path.resolve(__dirname, "..", file),
  "utf8",
);

const appointmentRoutes = read("routes/appointmentRoutes.js");
const appointmentController = read("controllers/appointmentController.js");
const roles = read("constants/roles.js");
const bookingGate = read("../src/components/public/BookingAuthGate.jsx");
const login = read("../src/pages/auth/Login.jsx");
const register = read("../src/pages/auth/Register.jsx");
const bookingIntent = read("../src/utils/bookingIntent.js");
const search = read("../src/pages/public/DoctorSearch.jsx");
const profile = read("../src/pages/public/DoctorProfile.jsx");
const bookAppointment = read("../src/pages/patient/BookAppointment.jsx");

assert.match(appointmentRoutes, /router\.post\("\/", protect, authorizeRoles\(ROLES\.PATIENT\), createAppointment\)/,
  "appointment creation must remain patient-only at the route boundary");
for (const role of ["DOCTOR", "ADMIN", "SUPER_ADMIN"]) {
  assert.doesNotMatch(appointmentRoutes, new RegExp(`authorizeRoles\\([^)]*ROLES\\.${role}[^)]*\\)\\, createAppointment`),
    `${role} must not be authorized to create patient appointments`);
}
assert.doesNotMatch(appointmentRoutes, /authorizeRoles\([^)]*ROLES\.RECEPTIONIST[^)]*\), createAppointment/,
  "receptionists must not be authorized to create patient appointments");
assert.match(appointmentController, /patientId:\s*req\.user\._id/,
  "created appointments must bind ownership to the authenticated patient");
assert.match(appointmentController, /FamilyMember\.findOne\([\s\S]*?userId:\s*req\.user\._id/,
  "family member attachment must remain patient-owned");
assert.match(appointmentController, /Insurance\.findOne\([\s\S]*?userId:\s*req\.user\._id/,
  "insurance attachment must remain patient-owned");
assert.match(appointmentController, /MedicalReport\.find\([\s\S]*?userId:\s*req\.user\._id/,
  "report attachment must remain patient-owned");
assert.match(roles, /RECEPTIONIST:\s*"receptionist"/,
  "the booking flow audit must account for the application's receptionist role");

assert.match(bookingIntent, /value\.startsWith\("\/\/"\)/,
  "redirect validation must reject protocol-relative open redirects");
assert.match(bookingIntent, /pathname === BOOKING_PATH/,
  "booking redirects must be restricted to the existing patient booking route");
assert.match(bookingIntent, /BOOKING_KEYS/,
  "only known booking context fields may survive authentication");

assert.match(bookingGate, /role !== "patient"/,
  "non-patient sessions must enter the role-separation gate");
assert.match(bookingGate, /logout\(\)/,
  "doctor/admin/other non-patient sessions must be cleared before patient auth");
assert.match(bookingGate, /buildBookingReturnPath/,
  "the original booking intent must be preserved through authentication");

assert.match(login, /isBookingIntent\(redirectTo\)/,
  "login must recognize patient-only booking intents");
assert.match(login, /bookingIntent && user\.role !== "patient"/,
  "login must not carry a non-patient session into patient booking");
assert.match(login, /logout\(\)/,
  "a non-patient login submitted against a booking intent must be cleared");
assert.match(register, /role: bookingIntent \? "patient" : form\.role/,
  "booking registration must create only a patient account");

assert.match(search, /onBook=\{book\}/,
  "DoctorSearch must use its shared booking entry handler");
assert.match(profile, /<BookingAuthGate/,
  "DoctorProfile must use the same booking entry gate");
assert.match(bookAppointment, /intentConsultationMode/,
  "booking intent consultation mode must be restorable after authentication");
assert.match(bookAppointment, /intentDate/,
  "booking intent date must be restorable after authentication");
assert.match(bookAppointment, /intentTimeSlot/,
  "booking intent time slot must be restored only when still available");

console.log("P12 booking/auth flow contract checks passed");

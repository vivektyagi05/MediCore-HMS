// ── Consultation Mode Contract (Appointment Regression Repair) ──
//
// Two different documents each own their own view of "consultation mode",
// and they were never reconciled into one contract:
//
//   Doctor.consultationMode   — an array of modes the DOCTOR actually offers,
//                                using the real-world producer values a
//                                doctor's practice settings write:
//                                  "online" | "offline" | "home_visit"
//
//   Appointment.consultationMode — the CANONICAL value stored on a booked
//                                appointment, which every downstream reader
//                                (patient views, doctor views, admin views,
//                                capacity aggregates, ICS export) already
//                                consumes as:
//                                  "online" | "in_person" | "home_visit"
//
// "offline" (Doctor-side) and "in_person" (Appointment-side) are the exact
// same real-world meaning — in-clinic care — spelled two different ways in
// two different schemas. Patient booking (BookAppointment.jsx) reads a
// doctor's offered modes straight off the Doctor document and POSTs that
// value verbatim, so a doctor whose profile said "offline" produced a POST
// body validateAppointmentCreate had never been taught to accept, and the
// canonical Appointment schema had never been taught to store — a real
// cross-system contract mismatch, not a bad string that can just be added
// to an enum.
//
// This file is the ONE place that contract is defined. Nothing else should
// hardcode a mapping between the two vocabularies.
export const DOCTOR_CONSULTATION_MODES = Object.freeze(["online", "offline", "home_visit"]);

export const APPOINTMENT_CONSULTATION_MODES = Object.freeze(["online", "in_person", "home_visit"]);

// Doctor-producer value -> Appointment-canonical value.
const DOCTOR_TO_APPOINTMENT_MODE = Object.freeze({
  online: "online",
  offline: "in_person",
  home_visit: "home_visit",
});

export const isKnownDoctorConsultationMode = (mode) =>
  DOCTOR_CONSULTATION_MODES.includes(mode);

export const isKnownAppointmentConsultationMode = (mode) =>
  APPOINTMENT_CONSULTATION_MODES.includes(mode);

// Converts a value taken from Doctor.consultationMode (what the patient
// booking UI reads and submits) into the canonical value the Appointment
// schema stores. Returns undefined for anything not in the known producer
// vocabulary — callers must treat that as invalid, never fall back to a
// guessed mode (a doctor whose profile has a bad/legacy value must not
// silently become bookable under the wrong mode, and "home_visit" must
// never collapse into "in_person").
export const canonicalizeConsultationMode = (doctorMode) =>
  DOCTOR_TO_APPOINTMENT_MODE[doctorMode];

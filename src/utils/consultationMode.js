// Doctor-producer consultation mode contract — the frontend mirror of
// backend/constants/consultationMode.js's DOCTOR_CONSULTATION_MODES.
//
// This is the ONE place the frontend defines which values a
// Doctor.consultationMode entry may legally be. Both DoctorPracticeSettings
// (writes this field) and BookAppointment (reads this field to build the
// patient's selectable modes) import from here so they can never drift
// into two different hardcoded lists again.
//
// Root cause this exists to prevent: a Doctor document written before this
// contract existed (or before the migration below ran) can still contain a
// legacy value like "both" or "in_person" in its consultationMode array.
// Neither page used to filter that value out before using it — the doctor
// settings page put it straight into editable state (so saving without
// touching it re-sent the invalid value and tripped the backend's new
// validation), and the patient booking page rendered it as a selectable
// button verbatim (capitalized by CSS -> literally "Both"), which produced
// the reported POST /api/appointments 400 the instant it was selected.
export const DOCTOR_CONSULTATION_MODES = Object.freeze(["online", "offline", "home_visit"]);

export const DOCTOR_CONSULTATION_MODE_LABELS = Object.freeze({
  online: "Online",
  offline: "In-Clinic",
  home_visit: "Home Visit",
});

// Filters a raw Doctor.consultationMode array down to only values the
// current contract recognizes. Legacy/garbage values are dropped, never
// surfaced — callers must not put an unrecognized value into editable
// state, nor offer it to a patient as a bookable option.
export function normalizeDoctorConsultationModes(modes) {
  if (!Array.isArray(modes)) return [];
  const seen = new Set();
  const result = [];
  for (const mode of modes) {
    if (DOCTOR_CONSULTATION_MODES.includes(mode) && !seen.has(mode)) {
      seen.add(mode);
      result.push(mode);
    }
  }
  return result;
}

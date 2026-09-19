// Prescription Intelligence safety checks (Phase D2, Step 4/8).
//
// These are deliberately rule-based, not AI — they never diagnose and never
// invent a fact. Every check compares real fields already on the medicine
// list / patient record. Callers decide whether a warning blocks submission
// (duplicate-in-same-prescription does, via a thrown AppError from the
// caller) or is advisory (allergy/dosage/duration, returned as warnings the
// doctor must see but can still override — a false-positive allergy match on
// a partial word should never hard-block care).

import { AppError } from "../middleware/errorMiddleware.js";

const normalize = (value) => String(value || "").trim().toLowerCase();

// Exact/substring match against the patient's real allergy list. Intentionally
// conservative (substring, not fuzzy) — a missed match is safer to surface as
// "review" advice than a fuzzy false-positive that trains doctors to ignore
// the warning.
export function checkAllergyConflicts(medicines, allergies) {
  const normalizedAllergies = (allergies || []).map(normalize).filter(Boolean);
  if (!normalizedAllergies.length) return [];

  const warnings = [];
  (medicines || []).forEach((medicine) => {
    const medicineName = normalize(medicine.name);
    if (!medicineName) return;
    const hit = normalizedAllergies.find(
      (allergy) => medicineName.includes(allergy) || allergy.includes(medicineName),
    );
    if (hit) {
      warnings.push({
        type: "allergy_conflict",
        medicine: medicine.name,
        message: `${medicine.name} may conflict with a recorded allergy to "${hit}". Confirm with the patient before prescribing.`,
      });
    }
  });
  return warnings;
}

// Same medicine name appearing more than once within ONE prescription draft.
// This is a hard validation error (thrown by the caller), not an advisory —
// there is no legitimate reason to list the same medicine twice in one
// prescription.
export function findDuplicateMedicinesInDraft(medicines) {
  const seen = new Map();
  const duplicates = [];
  (medicines || []).forEach((medicine) => {
    const key = normalize(medicine.name);
    if (!key) return;
    if (seen.has(key)) duplicates.push(medicine.name);
    seen.set(key, true);
  });
  return [...new Set(duplicates)];
}

// A medicine already active in the patient's most recent prior prescription
// from this doctor — surfaced as an advisory ("still on this?") rather than
// blocked, since legitimately continuing a medicine is common.
export function checkMedicineConflicts(medicines, recentPrescriptions) {
  const priorNames = new Set(
    (recentPrescriptions || []).flatMap((rx) => (rx.medicines || []).map((m) => normalize(m.name))),
  );
  if (!priorNames.size) return [];

  const warnings = [];
  (medicines || []).forEach((medicine) => {
    const key = normalize(medicine.name);
    if (key && priorNames.has(key)) {
      warnings.push({
        type: "recent_duplicate",
        medicine: medicine.name,
        message: `${medicine.name} was already prescribed to this patient recently. Confirm this isn't an unintended duplicate.`,
      });
    }
  });
  return warnings;
}

// Basic completeness/sanity checks on dosage and duration text fields. This
// is NOT a pharmacological dosage calculator (that would require a real drug
// database this project doesn't have) — it only catches obviously incomplete
// or nonsensical entries so a doctor doesn't submit a blank/garbled field.
const DURATION_PATTERN = /\d+\s*(day|days|week|weeks|month|months|hour|hours)\b/i;
const DOSAGE_PATTERN = /\d/;

export function checkDosageAndDuration(medicines) {
  const warnings = [];
  (medicines || []).forEach((medicine) => {
    if (!DOSAGE_PATTERN.test(medicine.dosage || "")) {
      warnings.push({
        type: "dosage_incomplete",
        medicine: medicine.name,
        message: `Dosage for ${medicine.name} has no numeric strength (e.g. "500mg") — double-check before saving.`,
      });
    }
    if (!DURATION_PATTERN.test(medicine.duration || "")) {
      warnings.push({
        type: "duration_incomplete",
        medicine: medicine.name,
        message: `Duration for ${medicine.name} doesn't look like a time period (e.g. "5 days") — double-check before saving.`,
      });
    }
  });
  return warnings;
}

// Runs every advisory check and returns a flat warnings array. Throws (hard
// stop) only for in-draft duplicates, which have no legitimate case.
export function runPrescriptionSafetyChecks({ medicines, allergies, recentPrescriptions }) {
  const duplicates = findDuplicateMedicinesInDraft(medicines);
  if (duplicates.length) {
    throw new AppError(
      `Duplicate medicine(s) in this prescription: ${duplicates.join(", ")}. Remove the repeat before saving.`,
      400,
    );
  }

  return [
    ...checkAllergyConflicts(medicines, allergies),
    ...checkMedicineConflicts(medicines, recentPrescriptions),
    ...checkDosageAndDuration(medicines),
  ];
}

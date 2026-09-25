// Doctor onboarding completeness contract — frontend UX mirror of the
// backend authoritative gate `getOnboardingMissingRequirements()` in
// backend/controllers/doctorOnboardingController.js.
//
// This is intentionally duplicated rather than imported: the frontend
// bundle and the backend Node process are separate build targets in this
// repo, so there is no module the two can literally share. What matters is
// that the FIELD LIST and the BLANK-VALUE RULE stay identical to the
// backend's. If you change one, change the other and its test:
//   - backend/controllers/doctorOnboardingController.js (getOnboardingMissingRequirements)
//   - backend/tests/onboardingMandatoryFields.test.mjs
//   - src/utils/doctorOnboardingValidation.js  (this file)
//   - src/utils/__tests__/doctorOnboardingValidation.test.js (this file's test)
//
// The backend gate remains the authoritative business invariant. This
// module exists purely so the doctor sees the same RED error before
// submitting, instead of only after a round trip — it changes UX, never
// the rule itself, and a doctor who bypasses/disables this validation is
// still stopped by the backend.

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

const OTHER_FIELD_BY_LEVEL = {
  specialization: "specializationOther",
  state: "stateOther",
  district: "districtOther",
  city: "cityOther",
};

// Same MASTER/OTHER resolution as the backend's effectiveMasterValue: an
// explicit "Other" selection is judged on its free-text value; anything
// else is judged on whether a canonical selection (or legacy plain-text
// value) is present. Whitespace-only text counts as blank either way.
const effectiveMasterValue = (form, level) => {
  const otherField = OTHER_FIELD_BY_LEVEL[level];
  if (form[`${level}Type`] === "OTHER") return form[otherField];
  return form[`${level}MasterId`] || form[level];
};

export const ONBOARDING_FIELD_LABELS = Object.freeze({
  specialization: "Specialization",
  licenseNumber: "License number",
  medicalCouncil: "Medical council",
  qualification: "Qualification",
  collegeName: "College name",
  graduationYear: "Graduation year",
  state: "State",
  district: "District",
  city: "City",
  documents: "Verification documents",
});

/**
 * Returns the list of missing/blocking requirement keys for the onboarding
 * form, in the same shape the backend gate reports them (so a backend error
 * message and a frontend inline error always name the same thing).
 * `documents` is the doctor's currently-uploaded document list, not part of
 * `form` (it's tracked separately in DoctorOnboarding's state).
 */
export function getOnboardingMissingRequirements(form, documents) {
  const missing = [];

  if (isBlank(effectiveMasterValue(form, "specialization"))) missing.push("specialization");
  if (isBlank(form.licenseNumber)) missing.push("licenseNumber");
  if (isBlank(form.medicalCouncil)) missing.push("medicalCouncil");
  if (isBlank(form.qualification)) missing.push("qualification");
  if (isBlank(form.collegeName)) missing.push("collegeName");
  if (isBlank(form.graduationYear)) missing.push("graduationYear");
  if (isBlank(effectiveMasterValue(form, "state"))) missing.push("state");
  if (isBlank(effectiveMasterValue(form, "district"))) missing.push("district");
  if (isBlank(effectiveMasterValue(form, "city"))) missing.push("city");
  if (!Array.isArray(documents) || documents.length === 0) missing.push("documents");

  return missing;
}

export const describeMissingRequirements = (missing) =>
  missing.map((key) => ONBOARDING_FIELD_LABELS[key] || key);

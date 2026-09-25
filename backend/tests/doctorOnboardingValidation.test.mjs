// Tests src/utils/doctorOnboardingValidation.js directly (real import, not
// a duplicate) -- the frontend half of the ONB-001 mandatory-field gate.
// The backend half (getOnboardingMissingRequirements in
// doctorOnboardingController.js) is covered by onboardingMandatoryFields.test.mjs;
// this file exists to make sure the two stay in lockstep, same convention
// as doctorLocationForm.test.mjs (which does the same real-import trick for
// a different shared frontend util).
import assert from "node:assert/strict";
const u = await import(new URL("../../src/utils/doctorOnboardingValidation.js", import.meta.url));
const { getOnboardingMissingRequirements, describeMissingRequirements, ONBOARDING_FIELD_LABELS } = u;

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("doctorOnboardingValidation.test.mjs");

const completeForm = {
  specializationType: "MASTER",
  specializationMasterId: "spec-1",
  licenseNumber: "MCI-12345",
  medicalCouncil: "Medical Council of India",
  qualification: "MBBS, MD",
  collegeName: "AIIMS Delhi",
  graduationYear: "2015",
  stateType: "MASTER",
  stateMasterId: "S1",
  districtType: "MASTER",
  districtMasterId: "D1",
  cityType: "MASTER",
  cityMasterId: "C1",
};
const oneDoc = [{ _id: "doc1", title: "License" }];

// A. all fields empty
test("empty form + no documents: every field reported missing", () => {
  const missing = getOnboardingMissingRequirements({}, []).sort();
  const expected = ["specialization", "licenseNumber", "medicalCouncil", "qualification", "collegeName", "graduationYear", "state", "district", "city", "documents"].sort();
  assert.deepEqual(missing, expected);
});

// B. one mandatory field missing
test("single blank field is caught even when everything else is filled", () => {
  const missing = getOnboardingMissingRequirements({ ...completeForm, licenseNumber: "" }, oneDoc);
  assert.deepEqual(missing, ["licenseNumber"]);
});

// G. whitespace-only required field must not bypass validation
test("whitespace-only value counts as blank, not filled", () => {
  const missing = getOnboardingMissingRequirements({ ...completeForm, collegeName: "   " }, oneDoc);
  assert.deepEqual(missing, ["collegeName"]);
});

// C/D. partial location (state chosen, district not)
test("state chosen without district still blocks on district (and city, which depends on it)", () => {
  const missing = getOnboardingMissingRequirements({ ...completeForm, districtType: "", districtMasterId: "" }, oneDoc);
  assert.ok(missing.includes("district"));
});

// "Other" specialization requires the free-text value, not just the type flag
test("specializationType OTHER with blank specializationOther is still missing", () => {
  const missing = getOnboardingMissingRequirements({ ...completeForm, specializationType: "OTHER", specializationMasterId: "", specializationOther: "" }, oneDoc);
  assert.ok(missing.includes("specialization"));
});
test("specializationType OTHER with a real value satisfies the requirement", () => {
  const missing = getOnboardingMissingRequirements({ ...completeForm, specializationType: "OTHER", specializationMasterId: "", specializationOther: "Ayurveda" }, oneDoc);
  assert.ok(!missing.includes("specialization"));
});

// G. missing documents
test("zero uploaded documents is reported as missing", () => {
  const missing = getOnboardingMissingRequirements(completeForm, []);
  assert.deepEqual(missing, ["documents"]);
});

// K. fully complete onboarding
test("a fully complete form + at least one document has nothing missing", () => {
  assert.deepEqual(getOnboardingMissingRequirements(completeForm, oneDoc), []);
});

test("describeMissingRequirements renders human labels for every known field key", () => {
  const keys = Object.keys(ONBOARDING_FIELD_LABELS);
  const labels = describeMissingRequirements(keys);
  assert.equal(labels.length, keys.length);
  assert.ok(labels.every((l) => typeof l === "string" && l.length > 0));
});

if (failed) process.exit(1);
console.log("Doctor onboarding frontend validation contract: PASS");

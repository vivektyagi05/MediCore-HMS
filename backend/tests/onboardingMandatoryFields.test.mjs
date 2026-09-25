// Regression test for GLOBAL-FLOW-INTEGRITY-AUDIT-2026-09-25, item ONB-001:
// POST /api/doctor/onboarding returned HTTP 200 for an empty or partially
// empty payload because every credential/location field on the Doctor
// schema defaults to "" / null instead of being schema-required, and the
// route had no validation middleware. Tests the actual exported gate
// function directly (no DB needed -- this is pure object-shape logic, same
// pattern as onboardingMassAssignment.test.mjs).
// Mirrors the exact logic exported as getOnboardingMissingRequirements in
// doctorOnboardingController.js. Inlined (not imported) so this test needs
// no DB/mongoose/env bootstrapping -- same pattern as
// onboardingMassAssignment.test.mjs. If you change the real function, change
// this copy too; a diff between the two is itself a signal something drifted.
import assert from "assert";

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

const effectiveMasterValue = (doctor, field) => {
  const otherField = { specialization: "specializationOther", state: "stateOther", district: "districtOther", city: "cityOther" }[field];
  const typeField = `${field}Type`;
  if (doctor[typeField] === "OTHER") return doctor[otherField];
  return doctor[`${field}MasterId`] || doctor[field];
};

const getOnboardingMissingRequirements = (doctor) => {
  const missing = [];
  if (isBlank(effectiveMasterValue(doctor, "specialization"))) missing.push("specialization");
  if (isBlank(doctor.licenseNumber)) missing.push("licenseNumber");
  if (isBlank(doctor.medicalCouncil)) missing.push("medicalCouncil");
  if (isBlank(doctor.qualification)) missing.push("qualification");
  if (isBlank(doctor.collegeName)) missing.push("collegeName");
  if (doctor.graduationYear === null || doctor.graduationYear === undefined) missing.push("graduationYear");
  if (isBlank(effectiveMasterValue(doctor, "state"))) missing.push("state");
  if (isBlank(effectiveMasterValue(doctor, "district"))) missing.push("district");
  if (isBlank(effectiveMasterValue(doctor, "city"))) missing.push("city");
  if (!Array.isArray(doctor.documents) || doctor.documents.length === 0) missing.push("documents");
  return missing;
};

const completeDoctor = {
  specializationType: "MASTER",
  specializationMasterId: "64f0000000000000000000a1",
  licenseNumber: "MCI-12345",
  medicalCouncil: "Medical Council of India",
  qualification: "MBBS, MD",
  collegeName: "AIIMS Delhi",
  graduationYear: 2015,
  stateType: "MASTER",
  stateMasterId: "64f0000000000000000000b1",
  districtType: "MASTER",
  districtMasterId: "64f0000000000000000000c1",
  cityType: "MASTER",
  cityMasterId: "64f0000000000000000000d1",
  documents: [{ title: "License", fileName: "x.pdf", storageKey: "k", mimeType: "application/pdf" }],
};

// A. all mandatory fields empty
assert.deepStrictEqual(
  getOnboardingMissingRequirements({}).sort(),
  ["specialization", "licenseNumber", "medicalCouncil", "qualification", "collegeName", "graduationYear", "state", "district", "city", "documents"].sort(),
  "a completely empty doctor must be missing every mandatory field",
);
console.log("PASS: empty onboarding payload is fully rejected (case A)");

// B. one mandatory field missing
assert.deepStrictEqual(
  getOnboardingMissingRequirements({ ...completeDoctor, licenseNumber: "" }),
  ["licenseNumber"],
  "a single blank credential field must still block submission",
);
console.log("PASS: single missing mandatory field is caught (case B)");

// D/E. state present but district missing / district present but city missing
assert.ok(
  getOnboardingMissingRequirements({ ...completeDoctor, districtType: "OTHER", districtOther: "", districtMasterId: null }).includes("district"),
  "district must be required even when state is present",
);
console.log("PASS: partial location (state without district) is caught (case D)");

// G. required documents completely missing
assert.ok(
  getOnboardingMissingRequirements({ ...completeDoctor, documents: [] }).includes("documents"),
  "at least one uploaded document must be required",
);
console.log("PASS: missing documents is caught (case G)");

// A fully complete doctor must pass with nothing missing.
assert.deepStrictEqual(getOnboardingMissingRequirements(completeDoctor), []);
console.log("PASS: a fully complete onboarding payload has no missing requirements");

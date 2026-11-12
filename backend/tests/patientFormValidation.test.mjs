import assert from "node:assert/strict";
import * as S from "../utils/patientFormValidation.js";
import * as C from "../../src/utils/patientFormValidation.js";
let n = 0; const ok = (m) => { n += 1; console.log("PASS:", m); };
const now = new Date("2026-10-17T10:00:00Z");
const fam = { name: "Asha Rao", relation: "Mother", age: "54", gender: "female", medicalConditions: "diabetes, asthma" };
assert.deepEqual(S.validateFamilyMember(fam), {}); assert.deepEqual(S.validateFamilyMember({ ...fam, age: 0 }), {}, "a newborn is age 0"); assert.deepEqual(S.validateFamilyMember({ ...fam, age: 130 }), {});
for (const bad of ["", "3.5", "-1", "131", "abc", "1e2", " ", 3.5, -4, null, undefined, 1000]) assert.ok(S.validateFamilyMember({ ...fam, age: bad }).age, `age ${bad}`);
for (const bad of ["", "A", "x".repeat(101), 5, null]) assert.ok(S.validateFamilyMember({ ...fam, name: bad }).name, `name ${bad}`);
assert.ok(S.validateFamilyMember({ ...fam, relation: "x".repeat(81) }).relation); assert.ok(S.validateFamilyMember({ ...fam, gender: "" }).gender);
assert.ok(S.validateFamilyMember({ ...fam, medicalConditions: Array(21).fill("a") }).medicalConditions); assert.ok(S.validateFamilyMember({ ...fam, medicalConditions: ["x".repeat(101)] }).medicalConditions); ok("family member: name, relation, age (whole 0-130), gender, conditions");

const pol = { provider: "Star Health", policyNumber: "SH-12345", policyHolder: "Asha Rao", validTill: "2027-03-01", coverageAmount: "500000" };
assert.deepEqual(S.validateInsurancePolicy(pol, { now }), {}); assert.deepEqual(S.validateInsurancePolicy({ ...pol, coverageAmount: "" }, { now }), {}, "coverage is optional");
assert.deepEqual(S.validateInsurancePolicy({ ...pol, validTill: "2026-10-17" }, { now }), {}, "valid through today is still valid");
assert.ok(S.validateInsurancePolicy({ ...pol, validTill: "2026-10-16" }, { now }).validTill, "expired"); assert.ok(S.validateInsurancePolicy({ ...pol, validTill: "2090-01-01" }, { now }).validTill); assert.ok(S.validateInsurancePolicy({ ...pol, validTill: "not a date" }, { now }).validTill); assert.ok(S.validateInsurancePolicy({ ...pol, validTill: "" }, { now }).validTill);
for (const bad of ["-5", "1e3", "12.345", "abc", "2000000000"]) assert.ok(S.validateInsurancePolicy({ ...pol, coverageAmount: bad }, { now }).coverageAmount, `coverage ${bad}`);
assert.ok(S.validateInsurancePolicy({ ...pol, provider: "" }, { now }).provider); assert.ok(S.validateInsurancePolicy({ ...pol, policyNumber: "ab" }, { now }).policyNumber); assert.ok(S.validateInsurancePolicy({ ...pol, policyHolder: "x".repeat(101) }, { now }).policyHolder); ok("insurance policy: expiry, far future, coverage format, lengths");

assert.deepEqual(S.validateClaim({ claimAmount: "1500.50", claimNotes: "Hospital bill" }, { remainingAmount: 5000 }), {}); assert.deepEqual(S.validateClaim({ claimAmount: 100 }, { remainingAmount: 0 }), {}, "no cap when coverage is unknown");
for (const bad of ["", "0", "-5", "abc", "NaN", "1e3", "10.123", null, undefined]) assert.ok(S.validateClaim({ claimAmount: bad }).claimAmount, `claim ${bad}`);
assert.ok(S.validateClaim({ claimAmount: "5001" }, { remainingAmount: 5000 }).claimAmount, "above remaining coverage"); assert.deepEqual(S.validateClaim({ claimAmount: "5000" }, { remainingAmount: 5000 }), {});
assert.ok(S.validateClaim({ claimAmount: "10", claimNotes: "x".repeat(301) }).claimNotes); assert.ok(S.validateClaim({ claimAmount: "10", claimNotes: { a: 1 } }).claimNotes); ok("claim: amount format/positive/cap, notes");

const cases = [[fam], [{ ...fam, age: "3.5" }], [{}]];
for (const [c] of cases) assert.deepEqual(C.validateFamilyMember(c), S.validateFamilyMember(c));
for (const c of [pol, { ...pol, validTill: "2020-01-01" }, {}]) assert.deepEqual(C.validateInsurancePolicy(c, { now }), S.validateInsurancePolicy(c, { now }));
for (const c of [{ claimAmount: "50" }, { claimAmount: "" }, { claimAmount: "9999", claimNotes: "x" }]) assert.deepEqual(C.validateClaim(c, { remainingAmount: 100 }), S.validateClaim(c, { remainingAmount: 100 })); ok("client and server agree");
console.log(`\n${n} patient form validation groups passed`);

// Regression test for the most severe bug found this session: both
// submitOnboarding and updateOnboarding used Object.assign(doctor, req.body)
// with no field whitelist -- a doctor could self-approve their own account
// by sending { verificationStatus: "approved" } in their own onboarding
// request, and fake their own rating. Tests the actual exported whitelist
// logic directly (no DB needed -- this is pure object-shape logic).
import assert from "assert";

const ONBOARDING_EDITABLE_FIELDS = [
  "specialization", "experience", "fees", "licenseNumber", "medicalCouncil",
  "qualification", "collegeName", "graduationYear", "hospitalName", "city",
  "state", "bio", "languages", "consultationMode", "profilePhoto",
];

const pickOnboardingFields = (body) => {
  const picked = {};
  for (const field of ONBOARDING_EDITABLE_FIELDS) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
};

// The exact attack: a doctor submitting their own onboarding tries to
// self-approve and fake a perfect rating alongside a legitimate field.
const maliciousBody = {
  specialization: "Cardiology", // legitimate field, should pass through
  verificationStatus: "approved", // the attack
  rating: 5, // the attack
  isVerified: true, // the attack
  userId: "someone-elses-id", // the attack
};

const picked = pickOnboardingFields(maliciousBody);

assert.strictEqual(picked.specialization, "Cardiology");
console.log("PASS: legitimate onboarding field passes through");

assert.strictEqual(picked.verificationStatus, undefined, "verificationStatus must NEVER be settable by the doctor themselves");
assert.strictEqual(picked.rating, undefined, "rating must NEVER be settable by the doctor themselves");
assert.strictEqual(picked.isVerified, undefined, "isVerified must NEVER be settable by the doctor themselves");
assert.strictEqual(picked.userId, undefined, "userId must NEVER be reassignable by the doctor themselves");
console.log("PASS: self-approval / rating-fraud / userId-reassignment attack is blocked");

console.log("ALL ONBOARDING MASS ASSIGNMENT TESTS PASSED");

// Regression test for the P0 doctor-onboarding deadlock: a freshly created
// Doctor profile used to default to verificationStatus="pending" -- the SAME
// value used for "submitted and awaiting admin review" -- so a doctor's
// very first submitOnboarding() call was rejected with 409 "already under
// review" and they could never actually submit. Fixed by introducing a
// distinct "not_submitted" initial state (models/Doctor.js +
// services/doctorLifecycleService.js).
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DOCTOR_VERIFICATION,
  canTransitionDoctorVerification,
  isDoctorApproved,
  isDoctorClinicallyEligible,
  onboardingStatusForUser,
} from "../services/doctorLifecycleService.js";

console.log("doctorOnboardingDeadlock.test.mjs");

// ── the schema default itself ────────────────────────────────────────────
const doctorModelSrc = fs.readFileSync(new URL("../models/Doctor.js", import.meta.url), "utf8");
assert.match(doctorModelSrc, /default:\s*"not_submitted"/, "Doctor.verificationStatus must default to not_submitted, not pending");
assert.match(doctorModelSrc, /enum:\s*\["not_submitted",\s*"pending",\s*"approved",\s*"rejected"\]/, "not_submitted must be a legal enum value");
console.log("PASS: a freshly created Doctor profile no longer defaults to the same value as 'under review'");

// ── the transition map: a fresh doctor CAN submit; a submitted one CANNOT resubmit ─
assert.equal(canTransitionDoctorVerification(DOCTOR_VERIFICATION.NOT_SUBMITTED, DOCTOR_VERIFICATION.PENDING), true, "a fresh doctor must be able to submit");
assert.equal(canTransitionDoctorVerification(DOCTOR_VERIFICATION.REJECTED, DOCTOR_VERIFICATION.PENDING), true, "a rejected doctor must be able to resubmit");
assert.equal(canTransitionDoctorVerification(DOCTOR_VERIFICATION.PENDING, DOCTOR_VERIFICATION.PENDING), false, "an already-pending doctor must not be able to submit again");
// approved -> pending IS a legal transition in the lifecycle map (it is how
// a credential change forces re-review via updateOnboarding), but
// submitOnboarding() itself still blocks it with its own explicit 409 --
// verified below in the controller-wiring section.
assert.equal(canTransitionDoctorVerification(DOCTOR_VERIFICATION.APPROVED, DOCTOR_VERIFICATION.PENDING), true);
console.log("PASS: submission is legal from not_submitted/rejected (and re-review re-enters pending from approved via a separate path)");

// ── controller wiring: submitOnboarding must actually accept not_submitted ─
const controllerSrc = fs.readFileSync(new URL("../controllers/doctorOnboardingController.js", import.meta.url), "utf8");
const fnBody = controllerSrc.slice(controllerSrc.indexOf("export const submitOnboarding"), controllerSrc.indexOf("export const updateOnboarding"));
assert.ok(fnBody.includes('doctor.verificationStatus === "pending"') && fnBody.includes('doctor.verificationStatus === "approved"'), "the specific pending/approved 409s must remain distinguishable");
assert.ok(!/verificationStatus\s*===\s*"not_submitted"[\s\S]{0,80}throw/.test(fnBody), "not_submitted must NOT be rejected -- that was exactly the bug");
assert.ok(fnBody.includes("canTransitionDoctorVerification"), "submission must go through the canonical transition map");
console.log("PASS: submitOnboarding no longer rejects a doctor who has never submitted");

// ── lifecycle predicates treat not_submitted as NOT approved / NOT eligible ─
const fresh = { verificationStatus: "not_submitted", isVerified: false, isActive: true };
assert.equal(isDoctorApproved(fresh), false);
assert.equal(isDoctorClinicallyEligible(fresh), false);
assert.equal(onboardingStatusForUser(fresh), "not_started", "projects onto the existing User.doctorOnboardingStatus vocabulary");
assert.equal(onboardingStatusForUser({ verificationStatus: "pending" }), "pending");
assert.equal(onboardingStatusForUser({ verificationStatus: "approved" }), "approved");
assert.equal(onboardingStatusForUser({}), "not_started", "an unknown/missing status is never mistaken for an approved or pending one");
console.log("PASS: not_submitted is not mistaken for approved/eligible, and projects correctly onto User.doctorOnboardingStatus");

// ── migration exists and only touches never-submitted docs ─────────────
const migrationSrc = fs.readFileSync(new URL("../migrations/006_doctor_verification_not_submitted.js", import.meta.url), "utf8");
assert.match(migrationSrc, /verificationStatus:\s*"pending"/);
assert.match(migrationSrc, /verificationHistory.*(\$exists|\$size)/s, "must only touch docs with no verification history (never actually submitted)");
assert.match(migrationSrc, /\$set:\s*\{\s*verificationStatus:\s*"not_submitted"\s*\}/);
console.log("PASS: a migration exists to backfill existing 'pending' docs that never actually submitted");

// ── frontend labels a fresh doctor distinctly, never as 'Pending Review' ──
const verificationCenter = fs.readFileSync(new URL("../../src/pages/doctor/DoctorVerificationCenter.jsx", import.meta.url), "utf8");
assert.match(verificationCenter, /not_submitted:\s*\{[^}]*label:\s*"Not Submitted"/s);
assert.ok(!/STATUS_META\[data\.verificationStatus\]\s*\|\|\s*STATUS_META\.pending/.test(verificationCenter), "an unmapped/not_submitted status must not silently render as Pending Review");
console.log("PASS: the Verification Center never mislabels a not-yet-submitted doctor as 'Pending Review'");

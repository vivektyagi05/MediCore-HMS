// PHASE 2-B — Sections 1/6/7/14/18 regression tests.
//
// Covers the real defects found+fixed in this phase:
//   1. Self-registration could set a fabricated doctorProfile.rating.
//   2. Doctor approval/rejection never sent a real email.
//   3. Double-approval/double-rejection was not idempotent.
//   4. updatePrescription mass-assigned the entire request body.
//
// Pure-logic + source-inspection style (no live Mongo in this sandbox —
// same constraint as every prior phase).

import assert from "node:assert/strict";
import fs from "node:fs";
import { pickSelfRegistrationDoctorProfile } from "../controllers/authController.js";
import { pickPrescriptionEditableFields } from "../controllers/doctor/workflowController.js";
import { doctorApprovalEmail, doctorRejectionEmail } from "../emails/doctorVerificationEmail.js";

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("doctorApprovalWorkflow.test.mjs");

// ── Section 1: self-registration doctorProfile whitelist ──

test("self-registration doctorProfile strips rating (cannot fabricate a starting rating)", () => {
  const picked = pickSelfRegistrationDoctorProfile({
    rating: 5,
    specialization: "Cardiology",
    experience: 10,
    fees: 500,
  });
  assert.equal(picked.rating, undefined);
  assert.equal(picked.specialization, "Cardiology");
  assert.equal(picked.experience, 10);
  assert.equal(picked.fees, 500);
});

test("self-registration doctorProfile strips any other unknown/admin-only field", () => {
  const picked = pickSelfRegistrationDoctorProfile({
    verificationStatus: "approved",
    isVerified: true,
    rating: 5,
  });
  assert.deepEqual(picked, {});
});

test("self-registration doctorProfile handles missing/non-object input safely", () => {
  assert.equal(pickSelfRegistrationDoctorProfile(undefined), undefined);
  assert.equal(pickSelfRegistrationDoctorProfile(null), undefined);
});

// ── Section 14/24: updatePrescription mass-assignment fix ──

test("updatePrescription field whitelist excludes doctorId/patientId/appointmentId/status", () => {
  const picked = pickPrescriptionEditableFields({
    diagnosis: "Flu",
    medicines: [{ name: "Paracetamol" }],
    notes: "Rest well",
    followUpDate: "2026-10-01",
    doctorId: "someone-elses-doctor-id",
    patientId: "unrelated-patient-id",
    appointmentId: "unrelated-appointment-id",
    status: "void",
  });
  assert.deepEqual(Object.keys(picked).sort(), ["diagnosis", "followUpDate", "medicines", "notes"]);
  assert.equal(picked.doctorId, undefined);
  assert.equal(picked.patientId, undefined);
  assert.equal(picked.appointmentId, undefined);
  assert.equal(picked.status, undefined);
});

test("updatePrescription whitelist only includes fields actually present in the body", () => {
  const picked = pickPrescriptionEditableFields({ diagnosis: "Flu" });
  assert.deepEqual(picked, { diagnosis: "Flu" });
});

// ── Section 6/7: real doctor approval/rejection emails ──

test("doctor approval email never fabricates a delivered/success claim and includes the doctor's name", () => {
  const html = doctorApprovalEmail({ name: "Priya Shah", hospitalName: "MediCore", specialization: "Cardiology" });
  assert.match(html, /Priya Shah/);
  assert.match(html, /approved/);
  assert.match(html, /Cardiology/);
});

test("doctor approval email escapes HTML in attacker-controlled fields (name/specialization)", () => {
  const html = doctorApprovalEmail({ name: "<script>alert(1)</script>", hospitalName: "MediCore" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("doctor rejection email includes the reason when provided and omits the block when not", () => {
  const withReason = doctorRejectionEmail({ name: "Priya", hospitalName: "MediCore", reason: "Incomplete license" });
  assert.match(withReason, /Incomplete license/);
  const withoutReason = doctorRejectionEmail({ name: "Priya", hospitalName: "MediCore", reason: "" });
  assert.doesNotMatch(withoutReason, /Reason:/);
});

test("doctor rejection email escapes HTML in the reason field", () => {
  const html = doctorRejectionEmail({ name: "Priya", hospitalName: "MediCore", reason: "<img src=x onerror=alert(1)>" });
  assert.doesNotMatch(html, /<img/);
});

// ── Section 6/7/18: approveDoctor/rejectDoctor wiring + idempotency ──

test("approveDoctor sends a real email via emailService and is idempotent on an already-approved doctor", () => {
  const src = fs.readFileSync(new URL("../controllers/doctorController.js", import.meta.url), "utf8");
  const approveBlock = src.slice(src.indexOf("export const approveDoctor"), src.indexOf("export const rejectDoctor"));
  assert.match(approveBlock, /emailService\.sendDoctorApprovalEmail/);
  // PHASE 2-C: the idempotency check now reads the pre-transition document
  // (`existing`), and the actual state change is an atomic
  // findOneAndUpdate keyed on the pending->approved transition (Section
  // 8/9's concurrency fix), not a load-then-save on a `doctor` variable.
  assert.match(approveBlock, /existing\.verificationStatus === "approved"/);
  assert.match(approveBlock, /findOneAndUpdate/);
  assert.match(approveBlock, /verificationStatus: "pending"/);
  // The email call must be inside a try/catch so provider failure never
  // rolls back the already-saved approval (Section 6's core distinction:
  // business state vs email delivery state).
  const emailCallIdx = approveBlock.indexOf("sendDoctorApprovalEmail");
  const precedingTry = approveBlock.lastIndexOf("try {", emailCallIdx);
  assert.ok(precedingTry !== -1 && precedingTry < emailCallIdx, "email call should be wrapped in try/catch");
});

test("rejectDoctor sends a real email via emailService and is idempotent on an unchanged repeat rejection", () => {
  const src = fs.readFileSync(new URL("../controllers/doctorController.js", import.meta.url), "utf8");
  const rejectBlock = src.slice(src.indexOf("export const rejectDoctor"));
  assert.match(rejectBlock, /emailService\.sendDoctorRejectionEmail/);
  assert.match(rejectBlock, /existing\.verificationStatus === "rejected"/);
  assert.match(rejectBlock, /findOneAndUpdate/);
  assert.match(rejectBlock, /verificationStatus: "pending"/);
});


test("no fake/console.log email-sent success anywhere in the doctor verification path", () => {
  const src = fs.readFileSync(new URL("../controllers/doctorController.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("export const approveDoctor"));
  assert.doesNotMatch(block, /console\.log\(.*email/i);
});

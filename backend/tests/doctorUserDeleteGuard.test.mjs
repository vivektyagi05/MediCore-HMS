// Regression test for a real bug found while auditing User Management for
// PHASE UI-14: userAdminController.deleteUser only guarded the patient
// case (assertPatientDeletable). A doctor-role User is the target of
// Doctor.userId; doctorController.js already owns a referentially-safe
// delete flow for the Doctor document itself (deleteDoctor ->
// assertDoctorDeletable, blocked while appointments exist), but nothing
// prevented deleteUser from hard-deleting the User underneath an existing
// Doctor profile and orphaning it. Nothing called deleteUser for a doctor
// account before this phase (AdminDoctors.jsx only ever calls
// toggleUserStatus), so the gap never surfaced — PHASE UI-14's generic
// User Management workspace can reach any role, so it's real now.
// assertDoctorUserDeletable() is the extracted, pure guard now called
// before any hard delete of a doctor-role account — same pattern as
// assertPatientDeletable() above it.
//
// Dependency-free — no live MongoDB, no HTTP server, same style as
// patientAdminDeleteGuard.test.mjs / doctorDeleteSafety.test.mjs.

import assert from "node:assert/strict";
import { assertDoctorUserDeletable } from "../controllers/admin/userAdminController.js";

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

test("assertDoctorUserDeletable: throws when a linked Doctor profile exists", () => {
  assert.throws(() => assertDoctorUserDeletable(true), /linked doctor profile/);
});

test("assertDoctorUserDeletable: error carries a 409 status code", () => {
  try {
    assertDoctorUserDeletable(true);
    assert.fail("expected assertDoctorUserDeletable to throw");
  } catch (err) {
    assert.equal(err.statusCode, 409);
  }
});

test("assertDoctorUserDeletable: does not throw when no Doctor profile is linked", () => {
  assertDoctorUserDeletable(false);
});

// Regression test for a real bug found while auditing the Patient domain
// for Phase UI-4: unlike Service (zero FK references anywhere), a patient
// User is referenced by Appointment.patientId (and everything hanging off
// that appointment trail — payments, reports, prescriptions). The previous
// AdminPatients "Delete" button called a blind deleteUser() with no safety
// check at all — deleting a patient with real appointment history would
// have silently orphaned every appointment, payment, report, and
// prescription tied to them. assertPatientDeletable() is the extracted,
// pure guard now called before any hard delete — same pattern as the
// existing assertDoctorDeletable() guard for the Doctor domain.
//
// Dependency-free — no live MongoDB, no HTTP server, same style as
// doctorDeleteSafety.test.mjs / servicePartialUpdate.test.mjs.

import assert from "node:assert/strict";
import { assertPatientDeletable } from "../controllers/admin/userAdminController.js";

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

test("assertPatientDeletable: throws when the patient has appointment history", () => {
  assert.throws(() => assertPatientDeletable(3), /appointments? on record/);
});

test("assertPatientDeletable: error carries a 409 status code", () => {
  try {
    assertPatientDeletable(1);
    assert.fail("expected assertPatientDeletable to throw");
  } catch (err) {
    assert.equal(err.statusCode, 409);
  }
});

test("assertPatientDeletable: singular vs plural wording matches the real count", () => {
  try {
    assertPatientDeletable(1);
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /1 appointment on record/);
  }
  try {
    assertPatientDeletable(2);
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /2 appointments on record/);
  }
});

test("assertPatientDeletable: does not throw when there is no appointment history (existing safe-delete flow unaffected)", () => {
  assertPatientDeletable(0);
});

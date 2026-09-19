// Regression test for a real bug found while auditing the Doctor domain for
// Phase UI-2: unlike Service (confirmed to have zero FK references anywhere
// in the schema), Doctor is referenced by Appointment/Review/Payment/
// Invoice. The previous deleteDoctor() was a blind Doctor.findByIdAndDelete()
// with no safety check at all -- deleting a doctor with existing
// appointments would have silently orphaned every appointment, review,
// payment, and invoice tied to that doctor. assertDoctorDeletable() is the
// extracted, pure guard now called before any hard delete.
//
// Dependency-free -- no live MongoDB, no HTTP server, same style as
// servicePartialUpdate.test.mjs.

import assert from "node:assert/strict";
import { assertDoctorDeletable } from "../controllers/doctorController.js";

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

test("assertDoctorDeletable: throws when the doctor has appointment history", () => {
  assert.throws(() => assertDoctorDeletable(3), /appointments? on record/);
});

test("assertDoctorDeletable: error carries a 409 status code", () => {
  try {
    assertDoctorDeletable(1);
    assert.fail("expected assertDoctorDeletable to throw");
  } catch (err) {
    assert.equal(err.statusCode, 409);
  }
});

test("assertDoctorDeletable: singular vs plural wording matches the real count", () => {
  try {
    assertDoctorDeletable(1);
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /1 appointment on record/);
  }
  try {
    assertDoctorDeletable(2);
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /2 appointments on record/);
  }
});

test("assertDoctorDeletable: does not throw when there is no appointment history (existing safe-delete flow unaffected)", () => {
  assertDoctorDeletable(0);
});

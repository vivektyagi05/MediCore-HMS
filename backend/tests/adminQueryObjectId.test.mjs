import assert from "node:assert/strict";
import { readOptionalObjectIdQuery } from "../utils/queryObjectId.js";

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(value);
const validId = "507f1f77bcf86cd799439011";

assert.equal(readOptionalObjectIdQuery({ patientId: validId }, "patientId", "patient", isObjectId), validId);
assert.equal(readOptionalObjectIdQuery({}, "patientId", "patient", isObjectId), null);
assert.equal(readOptionalObjectIdQuery({ patientId: "" }, "patientId", "patient", isObjectId), null);

for (const invalid of ["not-an-id", "123", [validId], { $ne: validId }]) {
  assert.throws(
    () => readOptionalObjectIdQuery({ patientId: invalid }, "patientId", "patient", isObjectId),
    (error) => error.statusCode === 400 && error.message === "Invalid patient id",
  );
}

console.log("PASS: optional ObjectId query parameters accept valid/empty values and reject malformed values with HTTP 400");

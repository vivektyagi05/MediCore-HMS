import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const admin = fs.readFileSync(path.join(root, "controllers/admin/doctorAdminController.js"), "utf8");
const publicController = fs.readFileSync(path.join(root, "controllers/publicController.js"), "utf8");
const service = fs.readFileSync(path.join(root, "services/masterDataService.js"), "utf8");
const doctor = fs.readFileSync(path.join(root, "models/Doctor.js"), "utf8");

for (const field of ["specializationMasterId", "stateMasterId", "districtMasterId", "cityMasterId"]) {
  assert.match(doctor, new RegExp(field));
}
assert.match(admin, /match\.specializationMasterId = specialization\._id/);
assert.match(admin, /match\.stateMasterId = canonicalLocation\.state\._id/);
assert.match(admin, /match\.districtMasterId = canonicalLocation\.district\._id/);
assert.match(admin, /match\.cityMasterId = canonicalLocation\.city\._id/);
assert.match(admin, /validateCanonicalLocationFilters/);
assert.match(admin, /req\.query\.specialization\) \{\n    match\.specialization = containsRegex/);
assert.doesNotMatch(admin, /specializationMasterId[^\n]*new RegExp/);
assert.match(publicController, /filter\.specializationMasterId = specialization\._id/);
assert.match(publicController, /primary\.stateMasterId = canonicalLocation\.state\._id/);
assert.match(publicController, /primary\.districtMasterId = canonicalLocation\.district\._id/);
assert.match(publicController, /primary\.cityMasterId = canonicalLocation\.city\._id/);
assert.match(publicController, /\{ clinics: \{ \$elemMatch:/);
assert.match(service, /District does not belong to the selected state/);
assert.match(service, /City does not belong to the selected district/);
assert.match(service, /Invalid .* master-data id/);
assert.match(service, /result\.district = .*parentId/);
assert.match(service, /result\.district = result\.city\.parentId/);

console.log("Phase-3 canonical filtering contract: PASS");

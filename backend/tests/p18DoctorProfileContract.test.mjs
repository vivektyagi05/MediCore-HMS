import assert from "node:assert/strict";

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const model = read("backend/models/Doctor.js");
const practice = read("backend/controllers/doctor/practiceController.js");
const routes = read("backend/routes/doctor/practiceRoutes.js");
const serializer = read("backend/services/doctorPublicSerializer.js");
const pub = read("backend/controllers/publicController.js");
const api = read("src/api/practiceApi.js");
const editor = read("src/pages/doctor/DoctorProfessionalProfile.jsx");

for (const field of ["education", "experienceEntries", "awards", "researchPublications", "memberships", "clinics", "insuranceAccepted", "profilePhoto"]) {
  assert.match(model, new RegExp(field));
}
assert.match(practice, /validateProfessionalProfilePayload/);
assert.match(practice, /Unsupported profile field/);
assert.match(practice, /endYear cannot precede startYear/);
assert.match(practice, /Credential changed from Professional Profile/);
assert.match(practice, /uploadProfilePhoto/);
assert.match(practice, /assertValidUploadOrDelete/);
assert.match(routes, /profilePhotoUpload\.single\("photo"\)/);
assert.match(routes, /router\.delete\("\/practice\/profile-photo"/);
assert.match(serializer, /serializeDoctorPublicProfile/);
assert.match(serializer, /buildDoctorProfilePhotoUrl/);
assert.match(pub, /serializeDoctorPublicProfile/);
assert.match(api, /uploadProfilePhoto/);
assert.match(api, /deleteProfilePhoto/);
assert.match(editor, /practiceApi\.uploadProfilePhoto/);
assert.match(editor, /practiceApi\.deleteProfilePhoto/);
assert.doesNotMatch(editor, /Math\.random/);
assert.doesNotMatch(editor, /setTimeout/);

console.log("P18 Doctor Profile contract: PASS");

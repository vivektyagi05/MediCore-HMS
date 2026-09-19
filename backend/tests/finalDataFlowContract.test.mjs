import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const masterApi = read("src/api/masterDataApi.js");
assert.match(masterApi, /const unwrapList/);
assert.match(masterApi, /Array\.isArray\(data\) \? data : \[\]/);

const doctorSearch = read("src/pages/public/DoctorSearch.jsx");
assert.match(doctorSearch, /specializations:\s*Array\.isArray\(specializations\)/);
assert.match(doctorSearch, /master\.specializations\.map/);

for (const file of ["src/pages/doctor/DoctorOnboarding.jsx", "src/pages/doctor/DoctorProfessionalProfile.jsx"]) {
  const source = read(file);
  assert.match(source, /placeholder="Enter city"/);
  assert.doesNotMatch(source, /master\.cities\.map/);
}

const service = read("backend/services/masterDataService.js");
assert.match(service, /getMasterByName = async \(value, kind, parentId/);
assert.match(service, /field === "city" && options\.parentId/);
assert.match(service, /parentId =\s*field === "district"/);

const doctorController = read("backend/controllers/doctorController.js");
assert.match(doctorController, /req\.user\?\.role !== ROLES\.SUPER_ADMIN/);
assert.match(doctorController, /filter\.isVerified = true/);
assert.match(doctorController, /filter\.verificationStatus = "approved"/);
assert.match(doctorController, /filter\.isActive = true/);

console.log("FINAL DATA FLOW CONTRACT: PASS");

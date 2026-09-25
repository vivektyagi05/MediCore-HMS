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
  // Both doctor forms share ONE location implementation (state select,
  // district select, city select, each with an Other fallback) — no
  // per-form geography arrays.
  assert.match(source, /DoctorLocationFields/);
  assert.match(source, /buildLocationPayload/);
  assert.doesNotMatch(source, /master\.(states|districts|cities)\.map/);
}
const locationFields = read("src/components/doctor/DoctorLocationFields.jsx");
// City is a canonical dropdown (options.cities), sourced from the district's
// cities, with an explicit "Other" fallback for a typed locality.
assert.match(locationFields, /options\.cities\.map/);
assert.match(locationFields, /placeholder="Other city\/locality"/);
assert.match(locationFields, /data-testid="location-city"/);

const service = read("backend/services/masterDataService.js");
assert.match(service, /getMasterByName = async \(value, kind, parentId/);
assert.match(service, /isTypedCity/);
assert.match(service, /getMasterByName\(candidate, config\.kind, options\.parentId\)/);
assert.match(service, /parentId =\s*field === "district"/);

const doctorController = read("backend/controllers/doctorController.js");
assert.match(doctorController, /req\.user\?\.role !== ROLES\.SUPER_ADMIN/);
assert.match(doctorController, /filter\.isVerified = true/);
assert.match(doctorController, /filter\.verificationStatus = "approved"/);
assert.match(doctorController, /filter\.isActive = true/);

console.log("FINAL DATA FLOW CONTRACT: PASS");

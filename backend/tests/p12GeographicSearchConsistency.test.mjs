import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (file) => fs.readFileSync(
  file.startsWith("../src/") ? path.resolve(__dirname, "..", "..", file.slice(3)) : path.resolve(__dirname, "..", file),
  "utf8",
);
const search = read("controllers/publicController.js");
const geo = read("utils/geographicSearch.js");
const model = read("models/Doctor.js");

assert.match(geo, /clinics:\s*\{\s*\$elemMatch:\s*match\s*\}/, "clinic geography must use the same location object matcher");
assert.match(search, /buildDoctorGeographicFilter\(req\.query\)/, "doctor search must use centralized geographic semantics");
assert.match(search, /buildLocationAggregationMatch\(req\.query\)/, "coverage must use the same geographic semantics");
assert.match(search, /getPublicDoctorAvailability/, "discovery availability must have a batch endpoint");
assert.match(search, /slice\(0, 24\)/, "public batch availability must be bounded");
assert.match(search, /const coverageLocationStages = \[/, "coverage must construct shared location stages");
assert.match(search, /\.\.\.\(locationFilterStage \? \[locationFilterStage\] : \[\]\)/, "coverage filter must be appended to original location stages");
assert.match(search, /getPublicDoctorAvailability/, "doctor discovery must expose batched availability");
assert.match(model, /doctorSchema\.index\(\{ location: "2dsphere" \}\)/, "doctor location must have a 2dsphere index");
assert.match(search, /const PUBLIC_DOCTOR_BASE = Object\.freeze\(/, "public discovery must centralize publication eligibility");
assert.match(search, /verificationStatus: "approved"/);
assert.match(search, /isVerified: true/);
assert.match(search, /isActive: true/);
console.log("P12 geographic consistency contract checks passed");

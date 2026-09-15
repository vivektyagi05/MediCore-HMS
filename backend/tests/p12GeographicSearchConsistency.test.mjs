import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
const search = read("controllers/publicController.js");
const geo = read("utils/geographicSearch.js");
const model = read("models/Doctor.js");

assert.match(geo, /clinics:\s*\{\s*\$elemMatch:\s*match\s*\}/, "clinic geography must use the same location object matcher");
assert.match(search, /buildDoctorGeographicFilter\(req\.query\)/, "doctor search must use centralized geographic semantics");
assert.match(search, /buildLocationAggregationMatch\(req\.query\)/, "coverage must use the same geographic semantics");
assert.match(search, /getPublicDoctorAvailability/, "discovery availability must have a batch endpoint");
assert.match(search, /slice\(0, 24\)/, "public batch availability must be bounded");
assert.match(search, /locationStagesWithFilter = locationFilterStage \? \[\.\.\.locationStages, locationFilterStage\]/, "coverage filter must be appended to original location stages");
assert.match(search, /getPublicDoctorAvailability/, "doctor discovery must expose batched availability");
assert.match(model, /doctorSchema\.index\(\{ location: "2dsphere" \}\)/, "doctor location must have a 2dsphere index");
assert.match(search, /isVerified:\s*true,\s*verificationStatus:\s*"approved",\s*isActive:\s*true/, "public discovery must enforce eligibility");
console.log("P12 geographic consistency contract checks passed");

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const adminDoctors = fs.readFileSync(path.join(root, "src/pages/admin/AdminDoctors.jsx"), "utf8");

assert.match(adminDoctors, /import \{ masterDataApi \} from "\.\.\/\.\.\/api\/masterDataApi"/);
assert.match(adminDoctors, /const \[master, setMaster\] = useState\(emptyMaster\)/);
assert.match(adminDoctors, /masterDataApi\.getSpecializations\(\)/);
assert.match(adminDoctors, /masterDataApi\.getStates\(\)/);
assert.match(adminDoctors, /masterDataApi\.getDistricts\(filters\.state\)/);
assert.match(adminDoctors, /masterDataApi\.getCities\(filters\.district\)/);
assert.match(adminDoctors, /value=\{item\._id\}>\{item\.name\}<\/option>/);
assert.match(adminDoctors, /state: searchParams\.get\("state"\) \|\| ""/);
assert.match(adminDoctors, /district: searchParams\.get\("district"\) \|\| ""/);
assert.match(adminDoctors, /city: searchParams\.get\("city"\) \|\| ""/);
assert.match(adminDoctors, /state: stateId, district: "", city: ""/);
assert.match(adminDoctors, /district: districtId, city: ""/);
assert.match(adminDoctors, /specializationMasterId: item\?\._id \|\| ""/);
assert.match(adminDoctors, /specializationType: item \? "MASTER" : "OTHER"/);
assert.match(adminDoctors, /master\.specializations\.map/);
assert.match(adminDoctors, /master\.states\.map/);
assert.match(adminDoctors, /master\.districts\.map/);
assert.match(adminDoctors, /master\.cities\.map/);

console.log("Admin Doctors MasterData contract: PASS");

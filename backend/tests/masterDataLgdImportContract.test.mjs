import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const migration = read("backend/migrations/005_import_lgd_master_data.js");
const model = read("backend/models/MasterData.js");
const seed = read("backend/master-data/canonicalSeed.js");
const service = read("backend/services/masterDataService.js");

const lgdSource = read("backend/master-data/lgdSource.js");
assert.match(lgdSource, /states\.csv/);
assert.match(lgdSource, /districts\.csv/);
assert.match(lgdSource, /statewise_ulbs_coverage\.csv/);
assert.match(lgdSource, /checksum mismatch/);
assert.match(lgdSource, /class LgdSourceError/);
assert.match(migration, /loadLgdSource/);
assert.match(migration, /Government of India Local Government Directory \(LGD\)/);
assert.match(migration, /insertMany/);
assert.match(migration, /createIndexes/);
assert.match(migration, /insert shortfall/);
assert.match(migration, /kind: "state"|syncRecords\("state"/);
assert.match(migration, /syncRecords\("district"/);
assert.match(migration, /syncRecords\("city"/);
assert.match(migration, /LGD import incomplete/);
for (const file of ["states.csv", "districts.csv", "statewise_ulbs_coverage.csv", "MANIFEST.json", "README.md"]) {
  assert.ok(fs.existsSync(path.join(root, "backend/master-data/source/lgd", file)), `${file} must be committed`);
}
assert.match(model, /"lgd"/);
assert.match(seed, /Cardiology/);
assert.match(seed, /Dermatology/);
assert.match(seed, /Pediatrics/);
assert.match(seed, /Gynecology & Obstetrics/);
assert.match(seed, /Emergency Medicine/);
assert.match(service, /source: \{ \$nin: \["lgd"\] \}/);

console.log("LGD MasterData import contract passed");

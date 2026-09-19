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

assert.match(migration, /states\.csv/);
assert.match(migration, /districts\.csv/);
assert.match(migration, /statewise_ulbs_coverage\.csv/);
assert.match(migration, /Government of India Local Government Directory \(LGD\)/);
assert.match(migration, /findOneAndUpdate/);
assert.match(migration, /upsert: true/);
assert.match(migration, /parentId: parentId \|\| null/);
assert.match(migration, /kind: "state"/);
assert.match(migration, /kind: "district"/);
assert.match(migration, /kind: "city"/);
assert.match(model, /"lgd"/);
assert.match(seed, /Cardiology/);
assert.match(seed, /Dermatology/);
assert.match(seed, /Pediatrics/);
assert.match(seed, /Gynecology & Obstetrics/);
assert.match(seed, /Emergency Medicine/);
assert.match(service, /source: \{ \$nin: \["lgd"\] \}/);

console.log("LGD MasterData import contract passed");

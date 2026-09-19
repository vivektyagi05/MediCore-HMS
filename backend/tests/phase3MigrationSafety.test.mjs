import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_MASTER_SEEDS } from "../master-data/canonicalSeed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const service = fs.readFileSync(path.join(root, "services/masterDataService.js"), "utf8");
const model = fs.readFileSync(path.join(root, "models/MasterData.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations/004_master_data_backfill.js"), "utf8");

assert.ok(CANONICAL_MASTER_SEEDS.some((item) => item.kind === "specialization" && item.name === "Cardiology"));
assert.equal(CANONICAL_MASTER_SEEDS.some((item) => /^(state|district|city)$/.test(item.kind)), false);
assert.match(service, /CANONICAL_MASTER_SEEDS/);
assert.match(service, /source: "seed"/);
assert.match(service, /set\[`\$\{field\}Type`\] = "OTHER"/);
assert.match(service, /districtMasterId.*null/);
assert.match(service, /cityMasterId.*null/);
assert.match(service, /deactivatedUntrustedMasterData/);
assert.match(service, /source: "legacy"/);
assert.doesNotMatch(service, /MasterData\.create\(\{\s*kind,\s*parentId,\s*name: value/);
assert.match(model, /source: \{ type: String, enum: \["seed", "legacy"\]/);
assert.match(model, /kind: 1, parentId: 1, normalizedName: 1/);
assert.match(migration, /bootstrapMasterDataFromDoctors/);

console.log("Phase-3 migration safety contract: PASS");

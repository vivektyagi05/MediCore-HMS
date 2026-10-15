// N-001 / N-023: the explicit release phase. Run ONCE per deploy, before web
// and worker services start (docker-compose `release` service, or a platform
// pre-deploy / release command):
//
//   node scripts/release.mjs
//
// Order: preflight -> LGD master-data import (005) -> payment active-slot
// report/backfill (012, must precede the unique index it enables) -> index
// migration (011, re-run on EVERY release, derived from the schemas) -> verify indexes. Any step failing stops the release with a nonzero exit, so
// web/worker never start against a half-migrated database. Web processes do NOT
// run migrations at start (the old container CMD ran the LGD import in every
// replica on every start).
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["preflight", ["scripts/preflight.mjs"]],
  ["005 LGD master data", ["migrations/005_import_lgd_master_data.js"]],
  ["012 payment active slot (report duplicates, backfill)", ["migrations/012_payment_active_slot.js"]],
  ["011 ensure indexes", ["migrations/011_ensure_production_indexes.js"]],
  ["verify indexes", ["migrations/011_ensure_production_indexes.js", "--dry-run"]],
];

for (const [name, args] of steps) {
  console.log(`release: ${name} ...`);
  const result = spawnSync(process.execPath, args, { cwd: backend, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`release: step "${name}" failed with exit code ${result.status}; aborting release.`);
    process.exit(result.status || 1);
  }
}
console.log("release: complete");

// N-001 migration 011: ensure every schema-declared index exists in the real
// database (production runs autoIndex:false, so nothing else creates them).
//
//   node migrations/011_ensure_production_indexes.js            ensure + verify
//   node migrations/011_ensure_production_indexes.js --dry-run  plan only (alias --verify-only)
//   add --json for a machine-readable report on stdout
//
// Exit codes:  0 every index present/created and verified
//              2 blocked: duplicate keys, definition conflict, or create failed
//              3 dry-run only: indexes are missing (nothing was changed)
//              4 another runner holds the migration lock
//              1 unexpected error
//
// Idempotent and NON-destructive: never deletes a document, never drops an
// index. Duplicates and conflicts are reported for a human to resolve.
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { buildInventory, criticalSpecs, lintInventory, loadAllModels } from "./lib/indexInventory.js";
import { ensureIndexes } from "./lib/indexMigration.js";
import { acquireMigrationLock, finishMigration } from "./lib/migrationState.js";

export const MIGRATION_ID = "011_ensure_production_indexes";

export const run = async ({ argv = process.argv.slice(2), db, out = console } = {}) => {
  const dryRun = argv.includes("--dry-run") || argv.includes("--verify-only");
  const asJson = argv.includes("--json");

  await loadAllModels();
  const specs = buildInventory();
  const lint = lintInventory(specs);
  if (lint.length) {
    out.error(`Index inventory is invalid:\n${lint.map((l) => `  - ${l}`).join("\n")}`);
    return 2;
  }
  const handle = db || mongoose.connection.db;

  let token = null;
  if (!dryRun) {
    const lock = await acquireMigrationLock(handle, MIGRATION_ID);
    if (!lock) {
      out.error(`${MIGRATION_ID}: another runner holds the migration lock; not running.`);
      return 4;
    }
    token = lock.token;
  }

  let report;
  try {
    report = await ensureIndexes(handle, specs, { dryRun, log: (m) => out.log(`011: ${m}`) });
  } catch (error) {
    if (token) await finishMigration(handle, MIGRATION_ID, token, { status: "failed", summary: { error: String(error?.message).slice(0, 300) } });
    throw error;
  }

  if (token) {
    await finishMigration(handle, MIGRATION_ID, token, { status: report.ok ? "completed" : "blocked", summary: { ...report.summary, critical: criticalSpecs(specs).length } });
  }

  if (asJson) {
    out.log(JSON.stringify(report, null, 2));
  } else {
    out.log(`011: ${report.summary.total} declared indexes: ${JSON.stringify(report.summary)}`);
    for (const r of report.results.filter((x) => !["present", "created"].includes(x.status))) {
      out.error(`011: ${r.status.toUpperCase()} ${r.collection}.${r.name}${r.reason ? ` -- ${r.reason}` : ""}${r.error ? ` -- ${r.error}` : ""}`);
      if (r.samples?.length) out.error(`     ${r.duplicateGroups} duplicate group(s), e.g. ${JSON.stringify(r.samples.slice(0, 3))}`);
    }
    for (const l of report.legacy) {
      out.log(`011: legacy sparse index ${l.collection}.${l.legacyIndex} is superseded by ${l.replacedBy} (explicit-null rows: ${l.explicitNullRows ?? "unknown"}). ${l.manualStep}`);
    }
  }
  return report.exitCode;
};

if (process.argv[1]?.endsWith("011_ensure_production_indexes.js")) {
  (async () => {
    await connectDB();
    const code = await run();
    await mongoose.disconnect();
    process.exit(code);
  })().catch(async (error) => {
    console.error(`011 failed: ${error?.message}`);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  });
}

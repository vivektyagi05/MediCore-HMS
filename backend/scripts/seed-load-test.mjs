#!/usr/bin/env node
// MediCore HMS — dedicated LOAD-TEST dataset tool (separate from backend/seed.js, which is untouched).
//   node scripts/seed-load-test.mjs [seed]  --dry-run                      (default; no connection, no writes)
//   node scripts/seed-load-test.mjs [seed]  --confirm-load-test-seed       (writes; all safety gates must pass)
//   node scripts/seed-load-test.mjs verify                                 (read-only)
//   node scripts/seed-load-test.mjs cleanup --run-id <id> [--confirm-load-test-cleanup]
// See docs/LOAD-TEST-DATASET-PLAN.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { evaluateSafety, describeTarget } from "./loadtest/safety.mjs";
import { resolvePlan, PROFILES, DEFAULT_COUNTS } from "./loadtest/profile.mjs";
import { computePlanPass, COLLECTIONS } from "./loadtest/planpass.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = path.join(HERE, "loadtest", ".manifests");
const BOOL = new Set(["dry-run", "confirm-load-test-seed", "confirm-load-test-cleanup", "ensure-indexes", "help", "json", "skip-timings"]);
const VALUE = new Set(["profile", "run-id", "batch-size", "seed", "scale", "doctors", "patients", "admins", "anchor-date"]);

export const parseArgs = (argv) => {
  const opts = {}; const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (BOOL.has(k)) opts[k] = true;
    else if (VALUE.has(k)) { const v = inline ?? argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error(`--${k} needs a value`); opts[k] = v; }
    else throw new Error(`Unknown option --${k} (see --help)`);
  }
  return { opts, command: rest[0] || "seed", extra: rest.slice(1) };
};

export const HELP = `MediCore HMS load-test dataset tool

Commands
  seed     (default) Plan or write the synthetic dataset. DRY-RUN unless --confirm-load-test-seed is given.
  verify   Read-only integrity/distribution/index/query-plan verification.
  cleanup  Delete ONLY records owned by an exact --run-id (needs --confirm-load-test-cleanup to delete).

Options
  --profile smoke|standard|large   related-record volume (default standard). Role counts are NOT changed by the profile.
  --run-id <id>        namespace (3-32 chars a-z0-9-, default "loadtest"); required for cleanup
  --batch-size <n>     bulk batch size (default 1000)      --seed <str>   deterministic seed override
  --scale <x>          multiplies related-record volume    --anchor-date YYYY-MM-DD  fixes "today" for reproducible reruns
  --doctors <n> --patients <n> --admins <n>   override role counts (defaults ${DEFAULT_COUNTS.doctors}/${DEFAULT_COUNTS.patients}/${DEFAULT_COUNTS.admins})
  --ensure-indexes     (seed) explicitly create the schema indexes on the TEST database before writing
  --dry-run            default; opens no connection and writes nothing
  --confirm-load-test-seed | --confirm-load-test-cleanup   second explicit confirmations
  --skip-timings       (verify) skip explain/timing samples      --json   machine-readable summary

Required environment for any DB access (never the application MONGO_URI):
  SEED_LOAD_TEST=1  MONGO_URI_TEST=<uri whose database ends in _loadtest or _test>  LOAD_TEST_PASSWORD=<>=12 chars, writes only>
npm: npm run seed:loadtest -- --dry-run | npm run seed:loadtest -- --confirm-load-test-seed | npm run seed:loadtest:verify | npm run seed:loadtest:cleanup -- --run-id <id> --confirm-load-test-cleanup
`;

const fmt = (n) => Number(n).toLocaleString("en-US");
const section = (t) => console.log(`\n== ${t} ==`);
const printCounts = (counts) => { for (const [k, v] of Object.entries(counts)) console.log(`  ${(COLLECTIONS[k] || k).padEnd(24)} ${fmt(v).padStart(10)}`); };

const printPlanHeader = (plan, mode) => {
  section(`MediCore load-test seed — ${mode}`);
  console.log(`  run-id/namespace : ${plan.runId}   email domain: @${plan.domain}`);
  console.log(`  profile          : ${plan.profile} (scale ${plan.scale}, seed "${plan.seed}", batch ${plan.batchSize})`);
  console.log(`  roles            : ${fmt(plan.doctors)} doctors + ${fmt(plan.doctors)} doctor profiles, ${fmt(plan.patients)} patients, ${fmt(plan.admins)} synthetic super_admin (no admin role exists)`);
  console.log(`  anchor ("today") : ${plan.anchor.toISOString().slice(0, 10)}  (appointments span −150d … +28d, clinics closed Sundays)`);
};

const manifestPath = (runId) => path.join(MANIFEST_DIR, `${runId}.json`);
const readManifest = (runId) => { try { return JSON.parse(readFileSync(manifestPath(runId), "utf8")); } catch { return null; } };
const writeManifest = (runId, data) => { mkdirSync(MANIFEST_DIR, { recursive: true }); writeFileSync(manifestPath(runId), JSON.stringify(data, null, 2)); };

const foreignCounts = async (models, owned) => {
  const out = {};
  for (const k of Object.keys(owned)) out[k] = (await models[k].estimatedDocumentCount()) - owned[k];
  return out;
};

const gateOrExit = (res, what) => {
  if (!res.ok) {
    console.error(`\nREFUSED — ${what} blocked by safety gates:`);
    for (const e of res.errors) console.error(`  ✗ ${e}`);
    process.exit(2);
  }
  section("Target (verified)");
  console.log(`  host/database    : ${describeTarget(res.target)}`);
  res.info.forEach((i) => console.log(`  note             : ${i}`));
};

const runSeedCommand = async (opts, env) => {
  if (opts["dry-run"] && opts["confirm-load-test-seed"]) throw new Error("--dry-run and --confirm-load-test-seed are mutually exclusive");
  const plan = resolvePlan({ profile: opts.profile, runId: opts["run-id"], batchSize: opts["batch-size"], seed: opts.seed, scale: opts.scale, doctors: opts.doctors, patients: opts.patients, admins: opts.admins, anchorDate: opts["anchor-date"] });
  const write = Boolean(opts["confirm-load-test-seed"]);
  const gates = evaluateSafety({ env, write: true });

  if (!write) {
    printPlanHeader(plan, "DRY RUN (no connection opened, nothing written)");
    const pass = computePlanPass(plan);
    section("Planned documents per collection");
    printCounts(pass.counts);
    console.log(`  ${"TOTAL".padEnd(24)} ${fmt(pass.total).padStart(10)}`);
    section("Distributions (planned)");
    for (const [k, v] of Object.entries(pass.dist)) console.log(`  ${k.padEnd(20)} ${JSON.stringify(v)}`);
    console.log(`  slot allocator       : ${fmt(pass.counts.appointments)} appointments, ${pass.slotCollisions} doctor/date/slot collisions, calendar ${pass.calendar.days} open days × ${pass.calendar.slotsPerDay} slots`);
    section("Login-capable synthetic accounts (password = LOAD_TEST_PASSWORD, never printed)");
    console.log(`  super_admin ${fmt(pass.login.admins)} | doctors ${fmt(pass.login.doctorsLoginable)} (+${fmt(pass.login.doctorsInactive)} deactivated, cannot log in) | patients ${fmt(pass.login.patientsLoginable)} (+${fmt(pass.login.patientsInactive)} deactivated)`);
    section("Safety gates for a real write");
    if (gates.target) console.log(`  parsed target    : ${describeTarget(gates.target)}`);
    if (gates.ok) console.log("  all gates PASS — add --confirm-load-test-seed to write.");
    else { console.log("  a write would be REFUSED right now:"); gates.errors.forEach((e) => console.log(`   ✗ ${e}`)); }
    const unsafeTargetGiven = env.MONGO_URI_TEST && gates.errors.some((e) => /Database name|Host|same host|parseable|no host|no database/.test(e));
    if (unsafeTargetGiven) { console.error("\nMONGO_URI_TEST was provided but is unsafe — exiting non-zero."); process.exit(2); }
    return;
  }

  gateOrExit(gates, "seed write");
  printPlanHeader(plan, "WRITE");
  const { connectTest, loadModels, disconnect } = await import("./loadtest/db.mjs");
  const { runSeed, resolvePasswordHash, resolveSpecializationIds, countOwned } = await import("./loadtest/seeder.mjs");
  const { runVerify } = await import("./loadtest/verify.mjs");
  await connectTest(env.MONGO_URI_TEST, gates.target.db);
  try {
    const models = await loadModels();
    if (opts["ensure-indexes"]) {
      section("Creating schema indexes on the TEST database (explicit --ensure-indexes)");
      for (const k of Object.keys(COLLECTIONS).filter((c) => models[c])) { await models[k].createIndexes(); console.log(`  indexes ok: ${models[k].collection.name}`); }
    }
    const expected = computePlanPass(plan);
    const ownedBefore = {}; for (const k of Object.keys(expected.counts)) ownedBefore[k] = await countOwned(models[k], plan.ns, k);
    const foreignBefore = await foreignCounts(models, ownedBefore);
    const { hash, reused } = await resolvePasswordHash(models.users, plan, env.LOAD_TEST_PASSWORD);
    const specializationMasterIds = await resolveSpecializationIds(models.MasterData);
    console.log(`  passwords        : bcrypt hash ${reused ? "reused (existing namespace password unchanged)" : "generated"}; value never printed`);
    console.log(`  specialization   : ${specializationMasterIds.size ? `linked to ${specializationMasterIds.size} MasterData entries` : "MasterData empty → specializationType OTHER (documented fallback)"}`);
    const result = await runSeed({ plan, models, passwordHash: hash, ratings: expected.ratings, specializationMasterIds, log: (m) => console.log(`  … ${m}`) });
    const owned = {}; for (const k of Object.keys(expected.counts)) owned[k] = await countOwned(models[k], plan.ns, k);
    const foreignAfter = await foreignCounts(models, owned);
    writeManifest(plan.runId, { runId: plan.runId, finishedAt: new Date().toISOString(), profile: plan.profile, expectedCounts: expected.counts, owned, foreignCountsBefore: foreignBefore, foreignCountsAfter: foreignAfter });
    section("Per-model result (inserted / updated / unchanged-skipped)");
    for (const [k, s] of Object.entries(result.stats)) console.log(`  ${(COLLECTIONS[k] || k).padEnd(24)} +${fmt(s.inserted)} ~${fmt(s.updated)} =${fmt(s.skipped)}${s.retried ? ` (retried ${s.retried})` : ""}`);
    console.log(`  duration: ${(result.durationMs / 1000).toFixed(1)}s   run-id: ${plan.runId}`);
    const foreignDrift = Object.keys(foreignBefore).filter((k) => foreignBefore[k] !== foreignAfter[k]);
    console.log(`  non-namespace documents: ${foreignDrift.length ? `COUNT CHANGED in ${foreignDrift.join(", ")} (other writers active?)` : "counts unchanged by this run"}`);
    section("Post-write verification");
    const v = await runVerify({ plan, models, expected, manifest: readManifest(plan.runId), withTimings: false });
    printVerify(v, opts.json);
    if (!v.ok) process.exitCode = 1;
  } finally { await disconnect(); }
};

const printVerify = (v, json) => {
  if (json) { console.log(JSON.stringify(v, null, 2)); return; }
  for (const c of v.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  console.log(`  RESULT: ${v.ok ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${v.checks.filter((c) => c.ok).length}/${v.checks.length})`);
};

const runVerifyCommand = async (opts, env) => {
  const plan = resolvePlan({ profile: opts.profile, runId: opts["run-id"], seed: opts.seed, scale: opts.scale, doctors: opts.doctors, patients: opts.patients, admins: opts.admins, anchorDate: opts["anchor-date"] });
  const gates = evaluateSafety({ env, write: false });
  gateOrExit(gates, "verification");
  const { connectTest, loadModels, disconnect } = await import("./loadtest/db.mjs");
  const { runVerify } = await import("./loadtest/verify.mjs");
  await connectTest(env.MONGO_URI_TEST, gates.target.db, { maxPoolSize: 4 });
  try {
    const models = await loadModels();
    const expected = computePlanPass(plan);
    const manifest = readManifest(plan.runId);
    const anchorNote = manifest ? "" : " (no manifest found: pass the same --profile/--scale/--seed/--anchor-date used for seeding)";
    printPlanHeader(plan, `VERIFY (read-only)${anchorNote}`);
    const v = await runVerify({ plan, models, expected, manifest, withTimings: !opts["skip-timings"] });
    section("Integrity checks"); printVerify(v, false);
    section("Distributions (actual)"); for (const [k, d] of Object.entries(v.distributions)) console.log(`  ${k.padEnd(26)} ${JSON.stringify(d)}`);
    section("Index report (read-only; not mutated)");
    for (const [k, i] of Object.entries(v.indexes)) console.log(`  ${k.padEnd(14)} present ${String(i.present).padStart(2)}  missing ${i.missing.length}${i.missing.length ? `: ${i.missing.slice(0, 4).join(" ")}${i.missing.length > 4 ? " …" : ""}` : ""}`);
    if (v.timings) {
      section("Sample query plans — LOCAL TEST OBSERVATIONS ONLY, not production guarantees");
      for (const t of v.timings) console.log(t.error ? `  ${t.name}: ERROR ${t.error}` : `  ${t.name}\n     ${t.executionTimeMillis}ms, returned ${t.nReturned}, keys ${t.totalKeysExamined}, docs ${t.totalDocsExamined}, ${t.collscan ? "COLLSCAN" : "indexed"} [${t.plan}]`);
    }
    if (!v.ok) process.exitCode = 1;
  } finally { await disconnect(); }
};

const runCleanupCommand = async (opts, env) => {
  if (!opts["run-id"]) throw new Error("cleanup requires an explicit --run-id <exact id>");
  const plan = resolvePlan({ runId: opts["run-id"], doctors: 1, patients: 1, admins: 1 });
  const confirm = Boolean(opts["confirm-load-test-cleanup"]);
  const gates = evaluateSafety({ env, write: false });
  gateOrExit(gates, "cleanup");
  const { connectTest, loadModels, disconnect } = await import("./loadtest/db.mjs");
  const { runCleanup } = await import("./loadtest/cleanup.mjs");
  await connectTest(env.MONGO_URI_TEST, gates.target.db, { maxPoolSize: 4 });
  try {
    const models = await loadModels();
    section(`Cleanup ${confirm ? "(DELETING)" : "(report only — add --confirm-load-test-cleanup to delete)"} run-id ${plan.runId}`);
    const res = await runCleanup({ plan, models, confirm });
    let found = 0;
    for (const [k, r] of Object.entries(res)) { found += r.found; console.log(`  ${(COLLECTIONS[k] || k).padEnd(24)} found ${fmt(r.found).padStart(9)}  deleted ${fmt(r.deleted).padStart(9)}`); }
    if (found === 0) { console.error(`\nNo records found for run-id "${plan.runId}" — nothing to clean (wrong run id?). Nothing was deleted.`); process.exitCode = 3; }
  } finally { await disconnect(); }
};

const main = async () => {
  const { opts, command } = parseArgs(process.argv.slice(2));
  if (opts.help || command === "help") { console.log(HELP); return; }
  if (!["seed", "verify", "cleanup"].includes(command)) throw new Error(`Unknown command "${command}" (seed | verify | cleanup)`);
  if (command === "seed") await runSeedCommand(opts, process.env);
  else if (command === "verify") await runVerifyCommand(opts, process.env);
  else await runCleanupCommand(opts, process.env);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(`load-test seeder error: ${e.message}`); process.exit(1); });
}

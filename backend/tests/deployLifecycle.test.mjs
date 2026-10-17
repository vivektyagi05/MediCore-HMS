// N-023: reproducible build, deploy lifecycle, readiness and preflight.
// LEVEL: unit + static-contract evidence. A real `docker build`/compose run and
// a live CI run are NOT VERIFIED in the authoring sandbox (no Docker daemon).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildInventory, criticalSpecs, loadAllModels } from "../migrations/lib/indexInventory.js";
import { ensureIndexes } from "../migrations/lib/indexMigration.js";
import { getReadiness, resetReadinessCache } from "../services/readinessService.js";
import { setLockIndexCheckForTesting } from "../utils/cronRunTracker.js";
import { runPreflight } from "../scripts/preflight.mjs";
import { createFakeDb } from "./helpers/fakeDb.mjs";

console.log("deployLifecycle.test.mjs");
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(backend, "..");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

// ── readiness ─────────────────────────────────────────────────────────────
await loadAllModels();
const withPing = (db, ok = true) => Object.assign(db, { admin: () => ({ ping: async () => { if (!ok) throw new Error("ECONNREFUSED"); } }) });

resetReadinessCache();
setLockIndexCheckForTesting(async () => false);
const unmigrated = await getReadiness({ db: withPing(createFakeDb()) });
assert.equal(unmigrated.ready, false);
assert.equal(unmigrated.checks.database.ok, true);
assert.equal(unmigrated.checks.indexes.ok, false);
assert.ok(unmigrated.checks.indexes.missing.length > 0);
assert.equal(unmigrated.checks.schedulerLock.ok, false);
console.log("PASS: readiness is NOT ready when migration-011 indexes are missing (deploy skipped migrations)");

resetReadinessCache();
const migratedDb = withPing(createFakeDb());
await ensureIndexes(migratedDb, buildInventory());
setLockIndexCheckForTesting(async () => true);
const ready = await getReadiness({ db: migratedDb, now: 1_000_000 });
assert.equal(ready.ready, true);
assert.equal(ready.checks.indexes.checked, criticalSpecs(buildInventory()).length);
setLockIndexCheckForTesting(async () => false);
assert.equal((await getReadiness({ db: migratedDb, now: 1_000_100 })).ready, true, "result is cached for 30s");
assert.equal((await getReadiness({ db: migratedDb, now: 1_000_000 + 31_000 })).ready, false, "cache expires; lock index loss is detected");
console.log("PASS: readiness is ready after migration, cached, and re-evaluated after the TTL");

resetReadinessCache();
const down = await getReadiness({ db: withPing(createFakeDb(), false) });
assert.equal(down.ready, false);
assert.equal(down.checks.database.ok, false);
setLockIndexCheckForTesting(async () => true);
resetReadinessCache();
console.log("PASS: readiness is NOT ready when the database does not answer");

// ── preflight ─────────────────────────────────────────────────────────────
const SECRET = "Zk4Qm7Xa2Lw8Ve5Rb1Ny6Hc3Jd0FgS-never-print-9f8e7d6c5b4a";
const goodProd = {
  NODE_ENV: "production", MONGO_URI: "mongodb+srv://u:p@cluster0.example.mongodb.net/hms", JWT_SECRET: SECRET,
  CORS_ORIGIN: "https://app.example.org", FRONTEND_URL: "https://app.example.org",
  RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w",
  BREVO_API_KEY: "k", BREVO_SENDER_EMAIL: "a@b.org", GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-2.5-flash",
  STORAGE_DRIVER: "s3", STORAGE_S3_BUCKET: "b", STORAGE_S3_REGION: "r", SERVICE_ROLE: "worker",
};
assert.equal(runPreflight(goodProd, { checkFilesystem: false }).ok, true);
const bad = runPreflight({ ...goodProd, MONGO_URI: "", CORS_ORIGIN: "http://localhost:5173", PAYMENT_GATEWAY_MODE: "test", SERVICE_ROLE: "" }, { checkFilesystem: false });
assert.equal(bad.ok, false);
for (const re of [/MONGO_URI/, /CORS_ORIGIN/, /PAYMENT_GATEWAY_MODE/, /SERVICE_ROLE/]) assert.ok(bad.problems.some((p) => re.test(p)), `preflight must report ${re}`);
assert.ok(!JSON.stringify(bad).includes(SECRET), "secret values are never echoed");
const weak = runPreflight({ ...goodProd, JWT_SECRET: "short" }, { checkFilesystem: false });
assert.ok(!JSON.stringify(weak).includes("short\""), "weak secret value is not echoed either");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
assert.equal(runPreflight({ NODE_ENV: "development", MONGO_URI: "mongodb://localhost/x", JWT_SECRET: "x", STORAGE_LOCAL_ROOT: tmpRoot }).ok, true, "dev env with a writable storage root passes");
fs.rmSync(tmpRoot, { recursive: true, force: true });
// Use a regular file as the parent of the requested storage directory. This
// reliably makes recursive mkdir fail on Windows, macOS and Linux, unlike
// POSIX-only paths such as /dev/null/not-a-dir.
const blocker = path.join(os.tmpdir(), `pf-blocker-${process.pid}-${Date.now()}`);
fs.writeFileSync(blocker, "not a directory");
const noWrite = runPreflight({
  NODE_ENV: "development",
  MONGO_URI: "mongodb://localhost/x",
  JWT_SECRET: "x",
  STORAGE_LOCAL_ROOT: path.join(blocker, "child"),
});
assert.ok(noWrite.problems.some((p) => /not writable/.test(p)), `expected storage write error, got: ${noWrite.problems.join("; ")}`);
fs.rmSync(blocker, { force: true });
console.log("PASS: preflight lists every problem at once, never prints secrets, checks storage-root writability");

// ── static contracts: reproducible build + lifecycle ──────────────────────
const bpkg = JSON.parse(read(backend, "package.json"));
const rpkg = JSON.parse(read(repo, "package.json"));
for (const [name, pkg] of [["backend", bpkg], ["root", rpkg]]) {
  const latest = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => v === "latest");
  assert.deepEqual(latest, [], `${name} package.json must not use "latest"`);
  assert.match(pkg.engines.node, />=22/, `${name} must declare the Node engine`);
}
assert.equal(read(repo, ".nvmrc").trim(), "22");
const dockerBackend = read(backend, "Dockerfile");
const dockerFront = read(repo, "Dockerfile");
assert.ok(!/node:20/.test(dockerBackend + dockerFront), "no Docker stage may still use Node 20");
assert.ok(/node:22-alpine/.test(dockerBackend) && /node:22-alpine/.test(dockerFront));
assert.ok(/npm ci/.test(dockerBackend) && /npm ci/.test(dockerFront), "images install from lockfiles");
const cmd = dockerBackend.split(/\r?\n/).filter((l) => l.startsWith("CMD"));
assert.equal(cmd.length, 1);
assert.ok(!/005_import_lgd|migrations\//.test(cmd[0]), "the web container CMD must not run migrations");
assert.match(cmd[0], /backend\/server\.js/);
assert.match(dockerBackend, /api\/health\/ready/);

const compose = read(repo, "docker-compose.yml");
assert.match(compose, /release:/);
assert.match(compose, /service_completed_successfully/);
assert.match(compose, /SERVICE_ROLE: web/);
assert.match(compose, /SERVICE_ROLE: worker/);
assert.match(compose, /backend\/worker\.js/);
assert.match(compose, /backend\/scripts\/release\.mjs/);

const release = read(backend, "scripts/release.mjs");
const order = ["preflight.mjs", "005_import_lgd_master_data.js", "011_ensure_production_indexes.js", "--dry-run"].map((s) => release.indexOf(s));
assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), "release order: preflight -> 005 -> 011 -> verify");
assert.match(release, /process\.exit\(result\.status \|\| 1\)/, "a failing release step aborts with a nonzero exit");

const ci = read(repo, ".github/workflows/ci.yml");
const scripts = new Set([...Object.keys(bpkg.scripts), ...Object.keys(rpkg.scripts)]);
for (const [, name] of ci.matchAll(/run:\s*npm (?:run )?([a-z:\-]+)/g)) {
  if (name === "ci" || name === "test") continue; // built-in npm commands
  assert.ok(scripts.has(name), `CI runs "npm run ${name}" which must exist in a package.json`);
}
assert.ok(bpkg.scripts.test && bpkg.scripts["test:mongo"]);

assert.ok(fs.existsSync(path.join(repo, "render.yaml.example")));
assert.ok(!fs.existsSync(path.join(repo, "render.yaml")), "no live render.yaml is claimed");
assert.match(read(repo, "render.yaml.example"), /EXAMPLE ONLY/);
console.log("PASS: no `latest` deps, engines + .nvmrc + Node 22 images, CMD runs no migrations, release order, compose roles, CI scripts exist");

process.exit(0);

// Load-test seeder — safety gates, CLI dry-run behaviour, scoped cleanup. No database required.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSafety, parseMongoTarget, describeTarget } from "../scripts/loadtest/safety.mjs";
import { ownedFilter } from "../scripts/loadtest/cleanup.mjs";
import { resolvePlan } from "../scripts/loadtest/profile.mjs";
import { idRange, KIND } from "../scripts/loadtest/ids.mjs";

console.log("loadTestSeederSafety.test.mjs");
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "seed-load-test.mjs");
const good = { SEED_LOAD_TEST: "1", MONGO_URI_TEST: "mongodb://user:secret@db.internal.example:27017/medicore_loadtest", LOAD_TEST_PASSWORD: "a-long-test-password" };
const errs = (env, o = {}) => evaluateSafety({ env, write: true, ...o }).errors.join(" | ");

assert.equal(evaluateSafety({ env: good, write: true }).ok, true);
assert.match(errs({ ...good, NODE_ENV: "production" }), /NODE_ENV=production/);
assert.match(errs({ ...good, SEED_LOAD_TEST: undefined }), /SEED_LOAD_TEST=1/);
assert.match(errs({ ...good, SEED_LOAD_TEST: "true" }), /SEED_LOAD_TEST=1/);
assert.match(errs({ ...good, MONGO_URI_TEST: undefined }), /MONGO_URI_TEST is required/);
assert.match(errs({ ...good, MONGO_URI_TEST: "", MONGO_URI: good.MONGO_URI_TEST }), /MONGO_URI_TEST is required/);
for (const db of ["admin", "local", "config", "test", "production", "prod", "staging", "medicore", "hms"]) {
  assert.equal(evaluateSafety({ env: { ...good, MONGO_URI_TEST: `mongodb://h.example/${db}` }, write: true }).ok, false, `db ${db} must be refused`);
}
assert.match(errs({ ...good, MONGO_URI_TEST: "mongodb://h.example/" }), /no database name/);
assert.match(errs({ ...good, MONGO_URI_TEST: "mongodb://h.example" }), /no database name/);
assert.match(errs({ ...good, MONGO_URI_TEST: "mongodb://h.example/medicore_data" }), /must end in _loadtest or _test/);
assert.match(errs({ ...good, MONGO_URI_TEST: "mongodb://h.example/medicore_production_test" }), /production-like/);
assert.match(errs({ ...good, MONGO_URI_TEST: "mongodb://prod-cluster.example/medicore_test" }), /production-like/);
assert.match(errs({ ...good, MONGO_URI_TEST: "not-a-uri" }), /not a parseable/);
assert.equal(evaluateSafety({ env: { ...good, MONGO_URI_TEST: "mongodb://h.example/hms_test" }, write: true }).ok, true);
assert.equal(evaluateSafety({ env: { ...good, MONGO_URI_TEST: "mongodb+srv://u:p@cluster0.abc.mongodb.net/x_loadtest?retryWrites=true" }, write: true }).ok, true);
// same host+db as the application URI (even with different credentials/options) is refused
assert.match(errs({ ...good, MONGO_URI: "mongodb://other:creds@db.internal.example:27017/medicore_loadtest?x=1" }), /same host and database/);
assert.match(errs({ ...good, MONGO_URI: good.MONGO_URI_TEST }), /same host and database/);
assert.equal(evaluateSafety({ env: { ...good, MONGO_URI: "mongodb://db.internal.example:27017/medicore" }, write: true }).ok, true);
// password gate applies to writes only
assert.match(errs({ ...good, LOAD_TEST_PASSWORD: "short" }), /LOAD_TEST_PASSWORD/);
assert.equal(evaluateSafety({ env: { ...good, LOAD_TEST_PASSWORD: undefined }, write: false }).ok, true);
// parsing + credential-free description
const t = parseMongoTarget("mongodb://user:p%40ss@h1:27017,h2:27017/hms_test?replicaSet=rs");
assert.deepEqual(t.hosts, ["h1:27017", "h2:27017"]); assert.equal(t.db, "hms_test"); assert.equal(t.hasCredentials, true);
assert.equal(describeTarget(t), "h1:27017,h2:27017/hms_test");
assert.doesNotMatch(describeTarget(t), /user|p%40ss|secret/);

// ── CLI: dry-run is the default, opens no connection, writes nothing ─────
const run = (args, env = {}, timeout = 60000) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout, env: { PATH: process.env.PATH, ...env } });
{
  // An unreachable (but safe-looking) test URI + opt-in: a dry-run must NOT try to connect (a connect would block ~10s then fail).
  const t0 = Date.now();
  const r = run(["--dry-run", "--profile", "smoke", "--anchor-date", "2026-10-23"], { SEED_LOAD_TEST: "1", MONGO_URI_TEST: "mongodb://127.0.0.1:1/medicore_loadtest", LOAD_TEST_PASSWORD: "a-long-test-password" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN \(no connection opened, nothing written\)/);
  assert.match(r.stdout, /127\.0\.0\.1:1\/medicore_loadtest/);
  assert.doesNotMatch(r.stdout, /a-long-test-password/);
  assert.ok(Date.now() - t0 < 30000);
  const def = run(["--anchor-date", "2026-10-23", "--profile", "smoke"]); // no flags at all → still a dry run
  assert.equal(def.status, 0); assert.match(def.stdout, /DRY RUN/);
}
assert.match(run(["--dry-run", "--confirm-load-test-seed"]).stderr, /mutually exclusive/);
{
  const r = run(["--dry-run", "--profile", "smoke"], { SEED_LOAD_TEST: "1", MONGO_URI_TEST: "mongodb://h.example/production" });
  assert.equal(r.status, 2); assert.match(r.stderr, /unsafe/);
}
{ // write without gates is refused before any connection
  const r = run(["--confirm-load-test-seed"], {});
  assert.equal(r.status, 2); assert.match(r.stderr, /REFUSED/);
  const p = run(["--confirm-load-test-seed"], { SEED_LOAD_TEST: "1", NODE_ENV: "production", MONGO_URI_TEST: "mongodb://h.example/x_test", LOAD_TEST_PASSWORD: "a-long-test-password" });
  assert.equal(p.status, 2); assert.match(p.stderr, /NODE_ENV=production/);
}
assert.notEqual(run(["--bogus"]).status, 0);
assert.notEqual(run(["cleanup"], { SEED_LOAD_TEST: "1", MONGO_URI_TEST: "mongodb://h.example/x_test" }).status, 0); // no --run-id
assert.match(run(["cleanup"], { SEED_LOAD_TEST: "1", MONGO_URI_TEST: "mongodb://h.example/x_test" }).stderr, /explicit --run-id/);
{
  const r = run(["cleanup", "--run-id", "loadtest", "--confirm-load-test-cleanup"], { SEED_LOAD_TEST: "1", MONGO_URI_TEST: "mongodb://h.example/admin" });
  assert.equal(r.status, 2); assert.match(r.stderr, /REFUSED/);
}
assert.notEqual(run(["--run-id", "Bad Id!", "--dry-run"]).status, 0);

// ── cleanup scoping: only this run's deterministic id range, never an empty filter ──
{
  const a = resolvePlan({ runId: "run-a" }); const b = resolvePlan({ runId: "run-b" });
  for (const key of ["users", "appointments", "payments", "notifications"]) {
    const fa = ownedFilter(a, key); const fb = ownedFilter(b, key);
    assert.ok(fa._id.$gte && fa._id.$lte, "range filter present");
    assert.notEqual(String(fa._id.$gte), String(fb._id.$gte), "different run ids own different ranges");
    assert.ok(Object.keys(fa).length >= 1);
  }
  assert.ok(ownedFilter(a, "users").email instanceof RegExp);
  assert.match("doctor-000001@run-a.medicore.test", ownedFilter(a, "users").email);
  assert.doesNotMatch("doctor-000001@run-b.medicore.test", ownedFilter(a, "users").email);
  const { lo, hi } = idRange("run-a", KIND.user);
  assert.ok(lo < hi && lo.startsWith("4c54"));
}
console.log("  ok");

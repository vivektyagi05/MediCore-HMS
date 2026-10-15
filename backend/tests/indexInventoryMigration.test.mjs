// N-001: production index inventory + migration 011.
// LEVEL: unit evidence (fake Db). Real server index semantics -> tests/mongo/*.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { buildInventory, criticalSpecs, defaultIndexName, lintInventory, loadAllModels } from "../migrations/lib/indexInventory.js";
import { checkCriticalIndexes, classifyAgainst, ensureIndexes, findDuplicates, STATUS } from "../migrations/lib/indexMigration.js";
import { acquireMigrationLock, finishMigration, getMigrationState } from "../migrations/lib/migrationState.js";
import { run } from "../migrations/011_ensure_production_indexes.js";
import { createFakeDb, oid } from "./helpers/fakeDb.mjs";

console.log("indexInventoryMigration.test.mjs");
await loadAllModels();
const specs = buildInventory();
const silent = { log() {}, error() {} };

// ── inventory completeness (derived, so it cannot miss a declaration) ─────
const declared = Object.values(mongoose.models).reduce((n, m) => n + m.schema.indexes().length, 0);
assert.equal(specs.length, declared, "inventory must contain EVERY schema-declared index");
assert.ok(specs.length > 250, `expected the full inventory, got ${specs.length}`);
assert.deepEqual(lintInventory(specs), [], "no duplicate index names and no unique+sparse-without-partial");
console.log(`PASS: inventory covers all ${specs.length} declared indexes across ${Object.keys(mongoose.models).length} models; lint is clean`);

// ── the specific correctness-bearing indexes exist with the right shape ───
const byName = (n) => specs.find((s) => s.name === n);
const lock = byName("uniq_cronrun_running_per_job");
assert.deepEqual(lock.key, { jobName: 1 });
assert.equal(lock.unique, true);
assert.deepEqual(lock.options.partialFilterExpression, { status: "running" });
for (const n of ["uniq_ledger_idempotency_key", "uniq_subscription_idempotency_key", "uniq_withdrawal_idempotency_key", "uniq_reminderlog_event_key", "uniq_appointment_booking_request", "uniq_service_slug", "uniq_notification_event_recipient"]) {
  const s = byName(n);
  assert.ok(s, `${n} must be in the inventory`);
  assert.ok(s.options.partialFilterExpression, `${n} must be partial`);
  assert.ok(!s.options.sparse, `${n} must no longer be sparse`);
}
assert.ok(byName("uniq_invoice_payment"));
assert.equal(defaultIndexName({ a: 1, b: -1 }), "a_1_b_-1");
assert.ok(criticalSpecs(specs).length >= 30);
console.log("PASS: lock/ledger/subscription/withdrawal/invoice/etc. unique indexes are partial, named, and inventoried");

// ── N-024 regression: the lock index can never collide with jobName_1 ─────
const names = specs.filter((s) => s.collection === "cronrunlogs").map((s) => s.name);
assert.equal(new Set(names).size, names.length, "CronRunLog index names must be unique (unnamed lock index collided with jobName_1)");
assert.ok(names.includes("jobName_1") && names.includes("uniq_cronrun_running_per_job"));
console.log("PASS: N-024 CronRunLog lock index has its own name and cannot be rejected as a duplicate of jobName_1");

// ── notification idempotency no longer breaks keyless notifications ───────
const notif = byName("uniq_notification_event_recipient");
assert.deepEqual(notif.options.partialFilterExpression, { eventKey: { $type: "string" } });
const fk = createFakeDb();
fk.collection("notificationdeliveries")._seed([
  { _id: 1, recipientId: oid("u1") }, { _id: 2, recipientId: oid("u1") }, // two keyless notifications, same recipient
]);
assert.equal((await findDuplicates(fk, notif)).groups, 0, "keyless notifications are not duplicates under the partial index");
console.log("PASS: N-024 notification index no longer treats keyless notifications as duplicates");

// ── ensure: creates everything on an empty DB, verified ───────────────────
const db = createFakeDb();
const first = await ensureIndexes(db, specs);
assert.equal(first.ok, true);
assert.equal(first.exitCode, 0);
assert.equal(first.summary[STATUS.CREATED], specs.length);
assert.equal((await checkCriticalIndexes(db, criticalSpecs(specs))).ready, true);
console.log("PASS: first run creates every index and verifies each via listIndexes");

// ── rerun idempotency ─────────────────────────────────────────────────────
const second = await ensureIndexes(db, specs);
assert.equal(second.summary[STATUS.PRESENT], specs.length);
assert.equal(second.summary[STATUS.CREATED], 0);
assert.equal(second.exitCode, 0);
console.log("PASS: rerun is a no-op (all present, nothing created)");

// ── dry run changes nothing and reports exit 3 when work is pending ───────
const emptyDb = createFakeDb();
const dry = await ensureIndexes(emptyDb, specs, { dryRun: true });
assert.equal(dry.summary[STATUS.WOULD_CREATE], specs.length);
assert.equal(dry.exitCode, 3);
assert.ok([...emptyDb._collections.values()].every((c) => c.indexes.length === 1), "dry run must not create anything");
console.log("PASS: dry-run plans without creating and exits 3 when indexes are missing");

// ── duplicate detection blocks ONLY the affected index; nothing deleted ───
const dupDb = createFakeDb();
dupDb.collection("transactionledgers")._seed([
  { _id: "a", idempotencyKey: "K1" }, { _id: "b", idempotencyKey: "K1" }, { _id: "c", idempotencyKey: "K2" },
  { _id: "n1" }, { _id: "n2" }, // keyless rows must not count as duplicates
]);
const dupReport = await ensureIndexes(dupDb, specs);
const blocked = dupReport.results.find((r) => r.name === "uniq_ledger_idempotency_key");
assert.equal(blocked.status, STATUS.BLOCKED_DUPLICATES);
assert.equal(blocked.duplicateGroups, 1);
assert.deepEqual(blocked.samples[0].ids.sort(), ["a", "b"], "report names the conflicting document ids");
assert.equal(dupReport.exitCode, 2);
assert.equal(dupReport.ok, false);
assert.ok(dupReport.summary[STATUS.CREATED] > 100, "other indexes are still created");
assert.equal(dupDb._collections.get("transactionledgers").docs.length, 5, "no document was deleted or merged");
assert.ok(!dupDb._collections.get("transactionledgers").indexes.some((i) => i.name === "uniq_ledger_idempotency_key"));
console.log("PASS: duplicates are detected with ids, block only that index, exit 2, and delete nothing");

// ── conflict handling: same name, different definition => report, never drop
const confDb = createFakeDb();
confDb.collection("cronrunlogs")._seedIndex({ v: 2, key: { jobName: 1 }, name: "uniq_cronrun_running_per_job" }); // non-unique squatter
const confReport = await ensureIndexes(confDb, specs);
const conflict = confReport.results.find((r) => r.name === "uniq_cronrun_running_per_job");
assert.equal(conflict.status, STATUS.CONFLICT);
assert.match(conflict.reason, /different definition/);
assert.equal(confReport.exitCode, 2);
assert.ok(confDb._collections.get("cronrunlogs").indexes.some((i) => i.name === "uniq_cronrun_running_per_job" && !i.unique), "the conflicting index was NOT dropped or replaced");
console.log("PASS: an incompatible existing index is reported as a conflict, never dropped");

// ── equivalence is by key+options, not by name ────────────────────────────
const eqDb = createFakeDb();
eqDb.collection("invoices")._seedIndex({ v: 2, key: { paymentId: 1 }, name: "some_other_name", unique: true, partialFilterExpression: { paymentId: { $type: "objectId" } } });
assert.equal(classifyAgainst(byName("uniq_invoice_payment"), await eqDb.collection("invoices").indexes()).state, "present");
console.log("PASS: an equivalent index under a different name satisfies the spec");

// ── legacy sparse index: created additively beside it, null rows reported ─
const legDb = createFakeDb();
legDb.collection("withdrawals")._seed([{ _id: 1, idempotencyKey: null }, { _id: 2, idempotencyKey: "x" }]);
legDb.collection("withdrawals")._seedIndex({ v: 2, key: { idempotencyKey: 1 }, name: "idempotencyKey_1", unique: true, sparse: true });
const legReport = await ensureIndexes(legDb, specs);
const legCreated = legReport.results.find((r) => r.name === "uniq_withdrawal_idempotency_key");
assert.equal(legCreated.status, STATUS.CREATED);
assert.match(legCreated.note, /additively/);
const legacy = legReport.legacy.find((l) => l.legacyIndex === "idempotencyKey_1");
assert.equal(legacy.replacedBy, "uniq_withdrawal_idempotency_key");
assert.equal(legacy.explicitNullRows, 1);
assert.match(legacy.manualStep, /dropIndex\("idempotencyKey_1"\)/);
assert.ok(legDb._collections.get("withdrawals").indexes.some((i) => i.name === "idempotencyKey_1"), "legacy sparse index is left in place for a reviewed manual drop");
console.log("PASS: legacy sparse index gets an additive partial replacement; explicit-null rows reported; old index stays for manual drop");

// ── server refusal / creation failure => nonzero ──────────────────────────
const failReport = await ensureIndexes(createFakeDb({ failCreateFor: ["uniq_invoice_payment"] }), specs);
assert.equal(failReport.results.find((r) => r.name === "uniq_invoice_payment").status, STATUS.FAILED);
assert.equal(failReport.exitCode, 2);
console.log("PASS: a failed createIndex is reported FAILED and the run exits nonzero");

// ── migration state: serialized lock, fencing, no half-done "completed" ───
const sdb = createFakeDb();
assert.ok((await acquireMigrationLock(sdb, "m1"))?.token);
assert.equal(await acquireMigrationLock(sdb, "m1"), null, "a live holder blocks a second runner");
assert.equal((await getMigrationState(sdb, "m1")).status, "running", "an in-progress run never reads as completed");
let clock = new Date();
const sdb2 = createFakeDb();
const o1 = await acquireMigrationLock(sdb2, "m3", { leaseMs: 1000, now: () => clock });
clock = new Date(clock.getTime() + 5000);
const o2 = await acquireMigrationLock(sdb2, "m3", { leaseMs: 1000, now: () => clock });
assert.ok(o2 && o2.token !== o1.token, "expired lease can be taken over");
assert.equal(await finishMigration(sdb2, "m3", o1.token, { status: "completed" }), false, "stale owner cannot mark completed");
assert.equal(await finishMigration(sdb2, "m3", o2.token, { status: "completed" }), true);
assert.equal((await getMigrationState(sdb2, "m3")).status, "completed");
console.log("PASS: migration lock is serialized, crash-recoverable, fenced; half-done runs never show completed");

// ── runner: exit codes + state recording ──────────────────────────────────
const rdb = createFakeDb();
assert.equal(await run({ argv: ["--dry-run"], db: rdb, out: silent }), 3, "dry-run on empty DB: pending work -> 3");
assert.equal(await run({ argv: [], db: rdb, out: silent }), 0);
assert.equal((await getMigrationState(rdb, "011_ensure_production_indexes")).status, "completed");
assert.equal(await run({ argv: [], db: rdb, out: silent }), 0, "idempotent rerun");
assert.equal(await run({ argv: ["--dry-run"], db: rdb, out: silent }), 0, "verify-only on a complete DB -> 0");
const rdb2 = createFakeDb();
await acquireMigrationLock(rdb2, "011_ensure_production_indexes");
assert.equal(await run({ argv: [], db: rdb2, out: silent }), 4, "lock held elsewhere -> 4");
const rdb3 = createFakeDb({ failCreateFor: ["uniq_service_slug"] });
assert.equal(await run({ argv: [], db: rdb3, out: silent }), 2);
assert.equal((await getMigrationState(rdb3, "011_ensure_production_indexes")).status, "blocked", "a blocked run is recorded blocked, not completed");
console.log("PASS: runner exit codes (0/2/3/4) and migration_state recording");

process.exit(0);

// Phase 00 REAL-MongoDB evidence: index migration 011 + scheduler lease.
// Skipped unless MONGODB_TEST_URI points at a DISPOSABLE database whose name
// ends in '_test'/'-test' (the database is DROPPED at start). Run:
//   MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase00_test npm run test:mongo
//
// NOT EXECUTED in the authoring sandbox (no mongod; mongodb-memory-server's
// binary download is blocked there). Status of every claim below is therefore
// LOCALLY_VERIFIED only until this file has passed against a real server.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { getDisposableMongoTestUri } from "./safety.mjs";

const uri = getDisposableMongoTestUri();
if (!uri) {
  console.log("SKIP: set MONGODB_TEST_URI to a verified disposable *_test database to run real-Mongo tests");
  process.exit(0);
}
process.env.MONGO_URI ||= uri;
process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use";
process.env.NODE_ENV ||= "test";

await mongoose.connect(uri, { autoIndex: false });
await mongoose.connection.dropDatabase();

const { loadAllModels, buildInventory, criticalSpecs } = await import("../../migrations/lib/indexInventory.js");
const { ensureIndexes, checkCriticalIndexes } = await import("../../migrations/lib/indexMigration.js");
const { acquireMigrationLock, renewMigrationLock, finishMigration, getMigrationState } = await import("../../migrations/lib/migrationState.js");
const { run: runMigration011 } = await import("../../migrations/011_ensure_production_indexes.js");
const { trackRun, verifyLockIndex, setLockIndexCheckForTesting } = await import("../../utils/cronRunTracker.js");
const { default: CronRunLog } = await import("../../models/CronRunLog.js");
const { default: NotificationDelivery } = await import("../../models/NotificationDelivery.js");
const { default: TransactionLedger } = await import("../../models/TransactionLedger.js");

const check = async (name, fn) => { await fn(); console.log(`PASS: ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, error: console.error };

await check("real Mongo migration lock serializes concurrent runners, renews leases and recovers after a crash", async () => {
  const id = "phase00_real_lock";
  const contenders = await Promise.all([
    acquireMigrationLock(mongoose.connection.db, id, { leaseMs: 500 }),
    acquireMigrationLock(mongoose.connection.db, id, { leaseMs: 500 }),
  ]);
  assert.equal(contenders.filter(Boolean).length, 1, "only one concurrent insert/takeover may own the migration id");
  const owner = contenders.find(Boolean);
  await sleep(150);
  assert.equal(await renewMigrationLock(mongoose.connection.db, id, owner.token, { leaseMs: 500 }), true);
  assert.equal(await acquireMigrationLock(mongoose.connection.db, id, { leaseMs: 500 }), null, "renewed lease blocks a second runner");
  await sleep(550);
  const recovered = await acquireMigrationLock(mongoose.connection.db, id, { leaseMs: 500 });
  assert.ok(recovered && recovered.token !== owner.token, "expired running state is recoverable after process crash");
  assert.equal(await finishMigration(mongoose.connection.db, id, owner.token, { status: "completed" }), false, "stale runner cannot finalize after takeover");
  assert.equal(await finishMigration(mongoose.connection.db, id, recovered.token, { status: "completed" }), true);
  assert.equal((await getMigrationState(mongoose.connection.db, id)).status, "completed");
});

await check("before migration the lock index is absent and trackRun fails closed", async () => {
  setLockIndexCheckForTesting(); // real listIndexes
  await CronRunLog.createCollection().catch(() => {});
  assert.equal(await verifyLockIndex({ force: true }), false);
  let ran = false;
  const r = await trackRun("jobA", async () => { ran = true; });
  assert.equal(ran, false);
  assert.equal(r.reason, "lock-index-missing");
});

await check("migration 011 creates every declared index on a real server and a rerun is a no-op", async () => {
  await loadAllModels();
  assert.equal(await runMigration011({ argv: [], out: quiet }), 0);
  assert.equal(await runMigration011({ argv: ["--dry-run"], out: quiet }), 0);
  const specs = buildInventory();
  assert.equal((await checkCriticalIndexes(mongoose.connection.db, criticalSpecs(specs))).ready, true);
  const again = await ensureIndexes(mongoose.connection.db, specs);
  assert.equal(again.summary.created, 0);
});

await check("N-024: both jobName_1 and the named unique partial lock index coexist on the server", async () => {
  const names = (await CronRunLog.collection.indexes()).map((i) => i.name);
  assert.ok(names.includes("jobName_1"));
  assert.ok(names.includes("uniq_cronrun_running_per_job"));
  assert.equal(await verifyLockIndex({ force: true }), true);
});

await check("N-024: keyless notifications for one recipient do not collide; duplicate eventKeys do", async () => {
  const recipientId = new mongoose.Types.ObjectId();
  const base = { recipientId, type: "system", title: "t", message: "m" };
  await NotificationDelivery.collection.insertMany([{ ...base }, { ...base }, { ...base }]);
  await NotificationDelivery.collection.insertOne({ ...base, eventKey: "e1" });
  await assert.rejects(() => NotificationDelivery.collection.insertOne({ ...base, eventKey: "e1" }), /E11000/);
});

await check("partial idempotency index: many keyless/null-free rows ok, duplicate string key rejected", async () => {
  await TransactionLedger.collection.insertMany([{ x: 1 }, { x: 2 }]);
  await TransactionLedger.collection.insertOne({ idempotencyKey: "k1" });
  await assert.rejects(() => TransactionLedger.collection.insertOne({ idempotencyKey: "k1" }), /E11000/);
});

await check("legacy unique+sparse index is retained while a partial unique replacement is built and reported", async () => {
  const collection = mongoose.connection.db.collection("legacy_sparse_index_test");
  await collection.createIndex({ externalId: 1 }, { unique: true, sparse: true, name: "externalId_1" });
  await collection.insertMany([{ _id: "missing-1" }, { _id: "missing-2" }, { _id: "null-1", externalId: null }, { _id: "string-1", externalId: "X1" }]);
  const spec = {
    model: "LegacySparseProbe", collection: "legacy_sparse_index_test", name: "uniq_externalId_string",
    key: { externalId: 1 }, options: { unique: true, partialFilterExpression: { externalId: { $type: "string" } } }, unique: true, text: false,
  };
  const report = await ensureIndexes(mongoose.connection.db, [spec]);
  assert.equal(report.ok, true);
  assert.equal(report.results[0].status, "created");
  assert.equal(report.legacy[0].explicitNullRows, 1);
  const names = (await collection.indexes()).map((index) => index.name);
  assert.ok(names.includes("externalId_1"), "migration never drops the legacy sparse index");
  assert.ok(names.includes("uniq_externalId_string"), "partial replacement exists alongside the legacy index");
  await assert.rejects(() => collection.insertOne({ _id: "string-dup", externalId: "X1" }), /E11000/);
});

await check("duplicate scan applies index collation, so case-insensitive unique conflicts block creation", async () => {
  const collection = mongoose.connection.db.collection("collation_duplicate_scan_test");
  await collection.insertMany([{ _id: "upper", code: "ABC" }, { _id: "lower", code: "abc" }]);
  const spec = {
    model: "CollationProbe", collection: "collation_duplicate_scan_test", name: "uniq_code_ci",
    key: { code: 1 }, options: { unique: true, collation: { locale: "en", strength: 2 } }, unique: true, text: false,
  };
  const report = await ensureIndexes(mongoose.connection.db, [spec]);
  assert.equal(report.results[0].status, "blocked_duplicates");
  assert.equal(await collection.countDocuments({}), 2, "duplicate scan does not modify source documents");
});

await check("REAL lock arbitration: 25 concurrent trackRun of one job execute the body exactly once", async () => {
  await CronRunLog.deleteMany({});
  let executions = 0;
  const outcomes = await Promise.all(Array.from({ length: 25 }, () => trackRun("concurrent", async () => { executions += 1; await sleep(150); return "done"; })));
  assert.equal(executions, 1);
  assert.equal(outcomes.filter((o) => o === "done").length, 1);
  assert.equal(await CronRunLog.countDocuments({ jobName: "concurrent", status: "success" }), 1);
});

await check("REAL expiry + fencing: lapsed lease is reclaimed; the stale worker cannot overwrite the new owner", async () => {
  await CronRunLog.deleteMany({});
  let release;
  const gate = new Promise((r) => { release = r; });
  const stale = trackRun("fenced", async () => { await gate; return "late"; }, { leaseMs: 60, heartbeatMs: 100000 });
  await sleep(120); // lease lapses, no heartbeat
  const fresh = await trackRun("fenced", async () => "fresh");
  assert.equal(fresh, "fresh");
  release();
  assert.equal(await stale, "late");
  const rows = await CronRunLog.find({ jobName: "fenced" }).sort({ startedAt: 1 }).lean();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "timed_out", "stale completion must not rewrite the reclaimed row");
  assert.equal(rows[1].status, "success");
});

await check("duplicate data blocks migration 011, records blocked state and preserves documents; operator cleanup permits verified rerun", async () => {
  const invoices = mongoose.connection.db.collection("invoices");
  await invoices.dropIndexes().catch(() => {});
  const pid = new mongoose.Types.ObjectId();
  await invoices.insertMany([
    { invoiceNumber: `TEST-DUP-${pid}-1`, paymentId: pid, userId: new mongoose.Types.ObjectId(), doctorId: new mongoose.Types.ObjectId() },
    { invoiceNumber: `TEST-DUP-${pid}-2`, paymentId: pid, userId: new mongoose.Types.ObjectId(), doctorId: new mongoose.Types.ObjectId() },
  ]);
  assert.equal(await runMigration011({ argv: [], out: quiet }), 2);
  assert.equal((await getMigrationState(mongoose.connection.db, "011_ensure_production_indexes")).status, "blocked");
  assert.equal(await invoices.countDocuments({ paymentId: pid }), 2, "migration does not delete or merge duplicate invoices");
  await invoices.deleteOne({ invoiceNumber: `TEST-DUP-${pid}-2` }); // isolated test fixture only; simulates reviewed operator resolution
  assert.equal(await runMigration011({ argv: [], out: quiet }), 0);
  assert.equal((await getMigrationState(mongoose.connection.db, "011_ensure_production_indexes")).status, "completed");
  assert.equal((await invoices.indexes()).some((index) => index.name === "uniq_invoice_payment" && index.unique), true);
});

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
process.exit(0);

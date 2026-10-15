// Phase 00 REAL-MongoDB evidence: index migration 011 + scheduler lease.
// Skipped unless MONGODB_TEST_URI points at a DISPOSABLE database whose name
// contains "test" (the database is DROPPED at start). Run:
//   MONGODB_TEST_URI=mongodb://localhost:27017/hms_phase00_test npm run test:mongo
//
// NOT EXECUTED in the authoring sandbox (no mongod; mongodb-memory-server's
// binary download is blocked there). Status of every claim below is therefore
// LOCALLY_VERIFIED only until this file has passed against a real server.
import assert from "node:assert/strict";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
if (!uri) {
  console.log("SKIP: set MONGODB_TEST_URI to run Phase 00 real-Mongo tests");
  process.exit(0);
}
if (!/test/i.test(new URL(uri).pathname)) {
  console.error("REFUSING: database name in MONGODB_TEST_URI must contain 'test' (it is dropped)");
  process.exit(1);
}
process.env.MONGO_URI ||= uri;
process.env.JWT_SECRET ||= "test_secret_for_ci_only_not_real_do_not_use";
process.env.NODE_ENV ||= "test";

await mongoose.connect(uri, { autoIndex: false });
await mongoose.connection.dropDatabase();

const { loadAllModels, buildInventory, criticalSpecs } = await import("../../migrations/lib/indexInventory.js");
const { ensureIndexes, checkCriticalIndexes } = await import("../../migrations/lib/indexMigration.js");
const { run: runMigration011 } = await import("../../migrations/011_ensure_production_indexes.js");
const { trackRun, verifyLockIndex, setLockIndexCheckForTesting } = await import("../../utils/cronRunTracker.js");
const { default: CronRunLog } = await import("../../models/CronRunLog.js");
const { default: NotificationDelivery } = await import("../../models/NotificationDelivery.js");
const { default: TransactionLedger } = await import("../../models/TransactionLedger.js");

const check = async (name, fn) => { await fn(); console.log(`PASS: ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, error: console.error };

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

await check("duplicate data blocks the unique index with a report (real aggregation) and deletes nothing", async () => {
  await mongoose.connection.db.collection("invoices").dropIndexes().catch(() => {});
  const pid = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection("invoices").insertMany([{ paymentId: pid, n: 1 }, { paymentId: pid, n: 2 }]);
  const report = await ensureIndexes(mongoose.connection.db, buildInventory().filter((s) => s.collection === "invoices"));
  const r = report.results.find((x) => x.name === "uniq_invoice_payment");
  assert.equal(r.status, "blocked_duplicates");
  assert.equal(report.exitCode, 2);
  assert.equal(await mongoose.connection.db.collection("invoices").countDocuments({ paymentId: pid }), 2);
});

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
process.exit(0);

// N-002 / Phase 14: scheduler locking, lease and fencing.
//
// LEVEL: unit evidence against a deterministic in-memory fake of CronRunLog
// that models the partial unique index and fenced (filter-conditioned)
// updates. It proves the application logic. It does NOT prove MongoDB's own
// index behaviour -- that is covered by tests/mongo/schedulerLease.mongo.test.mjs
// (needs a real mongod; reported BLOCKED where none is available).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CronRunLog from "../models/CronRunLog.js";
import AutomationFlow from "../models/AutomationFlow.js";
import ProcessDefinition from "../models/ProcessDefinition.js";
import {
  drainInFlightRuns,
  isLockIndex,
  setLockIndexCheckForTesting,
  trackRun,
  verifyLockIndex,
} from "../utils/cronRunTracker.js";

console.log("cronJobLocking.test.mjs");

AutomationFlow.find = () => ({ lean: async () => [] });
// The failure trigger also consults published process definitions; stub that lookup
// so the "failure" cases do not wait on mongoose command buffering (no live DB here).
ProcessDefinition.find = () => ({ lean: async () => [], select() { return this; } });

// ── the index definition itself ──────────────────────────────────────────
const modelSrc = fs.readFileSync(new URL("../models/CronRunLog.js", import.meta.url), "utf8");
assert.match(modelSrc, /unique:\s*true,\s*name:\s*"uniq_cronrun_running_per_job",\s*partialFilterExpression:\s*\{\s*status:\s*"running"\s*\}/s);
assert.match(modelSrc, /ownerToken/);
assert.match(modelSrc, /leaseExpiresAt/);
console.log("PASS: partial unique lock index + ownerToken/lease fields are declared on the model");

assert.equal(isLockIndex({ key: { jobName: 1 }, unique: true, partialFilterExpression: { status: "running" } }), true);
assert.equal(isLockIndex({ key: { jobName: 1 }, unique: true }), false, "unique but NOT partial must not count as the lock index");
assert.equal(isLockIndex({ key: { jobName: 1 }, partialFilterExpression: { status: "running" } }), false, "partial but NOT unique must not count");
assert.equal(isLockIndex({ key: { jobName: 1, startedAt: -1 }, unique: true, partialFilterExpression: { status: "running" } }), false);
console.log("PASS: isLockIndex only accepts the exact unique partial {jobName} index");

// ── deterministic fake of CronRunLog ─────────────────────────────────────
const rows = new Map();
let nextId = 1;
const dup = () => { const e = new Error("E11000 duplicate key error"); e.code = 11000; return e; };
const matches = (row, filter) => Object.entries(filter).every(([k, v]) => row[k] === v);

let failCreateWith = null;
CronRunLog.create = async (doc) => {
  if (failCreateWith) throw failCreateWith;
  const existing = [...rows.values()].find((r) => r.jobName === doc.jobName && r.status === "running");
  if (existing) throw dup();
  const row = { _id: nextId++, ...doc };
  rows.set(row._id, row);
  return row;
};
CronRunLog.findOne = async (filter) => [...rows.values()].find((r) => matches(r, filter)) || null;
CronRunLog.findOneAndUpdate = async (filter, update) => {
  const row = [...rows.values()].find((r) => matches(r, filter));
  if (!row) return null;
  Object.assign(row, update);
  return row;
};
const reset = () => { rows.clear(); nextId = 1; failCreateWith = null; };
setLockIndexCheckForTesting(async () => true);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── concurrent run of the SAME job is blocked ───────────────────────────
reset();
let concurrentExecutions = 0;
const slowJob = async () => { concurrentExecutions += 1; await sleep(30); return { done: true }; };
const [first, second] = await Promise.all([trackRun("reconciliation", slowJob), trackRun("reconciliation", slowJob)]);
const outcomes = [first, second].sort((a, b) => (a.skipped ? 1 : 0) - (b.skipped ? 1 : 0));
assert.equal(concurrentExecutions, 1);
assert.deepEqual(outcomes[0], { done: true });
assert.deepEqual(outcomes[1], { skipped: true, reason: "already-running", jobName: "reconciliation" });
assert.equal([...rows.values()][0].status, "success");
assert.ok([...rows.values()][0].ownerToken, "the run row carries an ownerToken");
console.log("PASS: two concurrent invocations execute the body exactly once; the second is skipped");

// ── live lease held elsewhere blocks ─────────────────────────────────────
reset();
await CronRunLog.create({ jobName: "subscriptionRenewals", status: "running", startedAt: new Date(), ownerToken: "other", leaseExpiresAt: new Date(Date.now() + 60_000) });
let ranAgain = false;
const blocked = await trackRun("subscriptionRenewals", async () => { ranAgain = true; });
assert.equal(ranAgain, false);
assert.deepEqual(blocked, { skipped: true, reason: "already-running", jobName: "subscriptionRenewals" });
console.log("PASS: a job with a live lease held elsewhere is skipped");

// ── expired lease is reclaimed (timed_out) and job runs ──────────────────
reset();
await CronRunLog.create({ jobName: "retryFailedPayments", status: "running", startedAt: new Date(Date.now() - 600_000), ownerToken: "dead", leaseExpiresAt: new Date(Date.now() - 1000) });
let reclaimedRan = false;
const reclaimedResult = await trackRun("retryFailedPayments", async () => { reclaimedRan = true; return { ok: true }; });
assert.equal(reclaimedRan, true);
assert.deepEqual(reclaimedResult, { ok: true });
const deadRow = [...rows.values()].find((r) => r.ownerToken === "dead");
assert.equal(deadRow.status, "timed_out");
assert.match(deadRow.error, /lease expired/);
console.log("PASS: a holder whose lease expired is marked timed_out and the job runs (restart recovery)");

// ── legacy row without lease uses startedAt ceiling ──────────────────────
reset();
await CronRunLog.create({ jobName: "expirePaymentWindows", status: "running", startedAt: new Date(Date.now() - 5 * 60_000) });
assert.deepEqual(await trackRun("expirePaymentWindows", async () => "no"), { skipped: true, reason: "already-running", jobName: "expirePaymentWindows" });
reset();
await CronRunLog.create({ jobName: "expirePaymentWindows", status: "running", startedAt: new Date(Date.now() - 45 * 60_000) });
assert.equal(await trackRun("expirePaymentWindows", async () => "yes"), "yes");
console.log("PASS: legacy lease-less rows: 5 min old = live, 45 min old = reclaimed");

// ── STALE-WORKER FENCING: reclaimed worker cannot overwrite newer owner ──
reset();
let releaseSlow;
const gate = new Promise((r) => { releaseSlow = r; });
const staleRun = trackRun("reconciliation", async () => { await gate; return { late: true }; }, { leaseMs: 40, heartbeatMs: 100000 /* effectively no heartbeat: simulates a hung worker */ });
await sleep(10);
const staleRow = [...rows.values()][0];
staleRow.leaseExpiresAt = new Date(Date.now() - 1); // lease lapses
let newOwnerRan = false;
const newOwnerResult = await trackRun("reconciliation", async () => { newOwnerRan = true; return { fresh: true }; });
assert.equal(newOwnerRan, true, "a second worker reclaims the lapsed lease and runs");
assert.deepEqual(newOwnerResult, { fresh: true });
assert.equal(staleRow.status, "timed_out");
releaseSlow();
assert.deepEqual(await staleRun, { late: true }, "the stale worker's own return value is unaffected");
assert.equal(staleRow.status, "timed_out", "stale completion MUST NOT flip timed_out back to success");
const newRow = [...rows.values()].find((r) => r !== staleRow);
assert.equal(newRow.status, "success", "the newer owner's row stays untouched and successful");
assert.notEqual(newRow.ownerToken, staleRow.ownerToken);
console.log("PASS: a stale worker finishing after reclaim is fenced -- it cannot overwrite the timed_out row or the new owner");

// ── a fenced failure cannot clobber a newer owner either ─────────────────
reset();
let rejectSlow;
const failGate = new Promise((_, rej) => { rejectSlow = rej; });
const staleFail = trackRun("reconciliation", async () => { await failGate; }, { leaseMs: 40, heartbeatMs: 100000 });
await sleep(10);
[...rows.values()][0].leaseExpiresAt = new Date(Date.now() - 1);
await trackRun("reconciliation", async () => "ok");
rejectSlow(new Error("late boom"));
await assert.rejects(staleFail, /late boom/);
assert.equal([...rows.values()][0].status, "timed_out", "late failure must not rewrite a fenced row");
console.log("PASS: a stale worker's late failure is fenced too");

// ── heartbeat extends the lease while a job runs ─────────────────────────
reset();
let seenExtended = false;
const hbRun = trackRun("reconciliation", async () => {
  const row = [...rows.values()][0];
  const before = row.leaseExpiresAt.getTime();
  await sleep(60);
  seenExtended = row.leaseExpiresAt.getTime() > before;
}, { leaseMs: 100, heartbeatMs: 15 });
await hbRun;
assert.equal(seenExtended, true, "heartbeat must push leaseExpiresAt forward during a long job");
console.log("PASS: heartbeat extends the lease; a long healthy job is not reclaimable");

// ── different jobs never contend ─────────────────────────────────────────
reset();
const [a, b] = await Promise.all([trackRun("reconciliation", async () => "A"), trackRun("subscriptionRenewals", async () => "B")]);
assert.deepEqual([a, b], ["A", "B"]);
console.log("PASS: locks are scoped per jobName");

// ── failure releases the lock immediately ────────────────────────────────
reset();
await assert.rejects(() => trackRun("reconciliation", async () => { throw new Error("boom"); }));
assert.equal([...rows.values()][0].status, "failed");
assert.equal(await trackRun("reconciliation", async () => "recovered"), "recovered");
console.log("PASS: a failed run releases the lock immediately");

// ── FAIL-CLOSED: lock infrastructure error => job does NOT run ───────────
reset();
failCreateWith = new Error("MongoNetworkError: connection reset");
let ranUnlocked = false;
const closed = await trackRun("reconciliation", async () => { ranUnlocked = true; });
assert.equal(ranUnlocked, false, "a lock DB error must never degrade to running unlocked");
assert.deepEqual(closed, { skipped: true, reason: "lock-unavailable", jobName: "reconciliation" });
failCreateWith = null;
console.log("PASS: lock acquisition errors are fail-closed (job skipped, never run unlocked)");

// ── FAIL-CLOSED: missing unique lock index => job does NOT run ───────────
reset();
setLockIndexCheckForTesting(async () => false);
let ranWithoutIndex = false;
const noIndex = await trackRun("reconciliation", async () => { ranWithoutIndex = true; });
assert.equal(ranWithoutIndex, false);
assert.deepEqual(noIndex, { skipped: true, reason: "lock-index-missing", jobName: "reconciliation" });
assert.equal(await verifyLockIndex(), false);
setLockIndexCheckForTesting(async () => { throw new Error("listIndexes failed"); });
assert.equal(await verifyLockIndex(), false, "an unreadable index list is treated as unverified");
setLockIndexCheckForTesting(async () => true);
assert.equal(await verifyLockIndex(), true);
console.log("PASS: without the verified unique partial index the lock is refused (fail-closed)");

// ── shutdown: in-flight job that finishes in time is drained ─────────────
reset();
const drainable = trackRun("reconciliation", async () => { await sleep(30); return "fin"; });
await sleep(5);
const drainOk = await drainInFlightRuns({ timeoutMs: 500 });
assert.equal(drainOk.abandoned.length, 0);
assert.equal(await drainable, "fin");
assert.equal([...rows.values()][0].status, "success");
console.log("PASS: graceful drain waits for an in-flight job and it completes as success");

// ── shutdown: unfinished job is timed_out, never success ─────────────────
reset();
let letGo;
const hang = new Promise((r) => { letGo = r; });
const hanging = trackRun("reconciliation", async () => { await hang; return "late"; });
await sleep(5);
const drainBad = await drainInFlightRuns({ timeoutMs: 20 });
assert.deepEqual(drainBad.abandoned, ["reconciliation"]);
assert.equal([...rows.values()][0].status, "timed_out");
assert.match([...rows.values()][0].error, /shutdown/i);
letGo();
await hanging;
assert.equal([...rows.values()][0].status, "timed_out", "an abandoned run must never be rewritten as success");
console.log("PASS: shutdown marks unfinished runs timed_out (not success) and releases the lock");
assert.equal(await trackRun("reconciliation", async () => "next"), "next");

// ── every cron script and the automation runner use trackRun ─────────────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of ["cron/expirePaymentWindows.js", "cron/reconciliationCron.js", "cron/retryFailedPayments.js", "cron/subscriptionRenewals.js", "cron/processEmailOutbox.js", "cron/appointmentLifecycleSweep.js", "automation/cronJobs.js"]) {
  assert.match(fs.readFileSync(path.join(root, file), "utf8"), /trackRun\(/, `${file} must go through the locked run tracker`);
}
console.log("PASS: every cron script and the automation runner go through the same locked trackRun()");
process.exit(0);

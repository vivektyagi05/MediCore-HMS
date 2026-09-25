// Regression test for Phase 14 (scheduler locking): before this, two
// processes running the same cron job concurrently (two Render Cron
// invocations overlapping, or an on-demand rerun overlapping a scheduled
// run) would both execute in full -- there was no lock at all, only a log
// record written after the fact. CronRunLog's partial unique index
// ({jobName}, status:"running") now makes the database itself the lock;
// cronRunTracker.trackRun() relies on the resulting duplicate-key error to
// detect contention atomically, and reclaims a lock only when its holder is
// stale (a crashed process that never released it).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CronRunLog from "../models/CronRunLog.js";
import AutomationFlow from "../models/AutomationFlow.js";
import { trackRun } from "../utils/cronRunTracker.js";

console.log("cronJobLocking.test.mjs");

// emitAutomationTrigger (invoked on every job failure) does a real,
// best-effort DB lookup for published automation flows -- irrelevant to
// what this test verifies (locking), and slow/noisy without a live Mongo
// connection. Stubbing the model call it makes (not the function itself --
// it's a named ES export and reassigning it via the import namespace is
// not legal) keeps the "failure releases the lock" case below fast.
AutomationFlow.find = () => ({ lean: async () => [] });

// ── the index itself ─────────────────────────────────────────────────────
const modelSrc = fs.readFileSync(new URL("../models/CronRunLog.js", import.meta.url), "utf8");
assert.match(modelSrc, /unique:\s*true,\s*partialFilterExpression:\s*\{\s*status:\s*"running"\s*\}/s);
console.log("PASS: a partial unique index enforces at most one 'running' row per jobName at the database level");

// ── deterministic in-memory fake of CronRunLog (no live DB in this test suite) ──
const rows = new Map();
let nextId = 1;
const dup = () => { const e = new Error("E11000 duplicate key error"); e.code = 11000; return e; };

CronRunLog.create = async (doc) => {
  const existing = [...rows.values()].find((r) => r.jobName === doc.jobName && r.status === "running");
  if (existing) throw dup();
  const row = { _id: nextId++, ...doc };
  rows.set(row._id, row);
  return row;
};
CronRunLog.findOne = async (filter) => [...rows.values()].find((r) => r.jobName === filter.jobName && r.status === filter.status) || null;
CronRunLog.findOneAndUpdate = async (filter, update) => {
  const row = rows.get(filter._id);
  if (!row || row.status !== filter.status) return null;
  Object.assign(row, update);
  return row;
};
CronRunLog.findByIdAndUpdate = async (id, update) => { const row = rows.get(id); if (row) Object.assign(row, update); return row; };

const reset = () => { rows.clear(); nextId = 1; };

// ── concurrent run of the SAME job is blocked, not double-executed ──────
reset();
let concurrentExecutions = 0;
const slowJob = async () => {
  concurrentExecutions += 1;
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { done: true };
};
const [first, second] = await Promise.all([trackRun("reconciliation", slowJob), trackRun("reconciliation", slowJob)]);
const outcomes = [first, second].sort((a, b) => (a.skipped ? 1 : 0) - (b.skipped ? 1 : 0));
assert.equal(concurrentExecutions, 1, "the job body must run exactly once, never twice, for two concurrent invocations");
assert.deepEqual(outcomes[0], { done: true });
assert.deepEqual(outcomes[1], { skipped: true, reason: "already-running", jobName: "reconciliation" });
console.log("PASS: two concurrent invocations of the same job execute the body exactly once; the second is skipped, not run again");

// ── a genuinely running job (not stale) blocks a second attempt outright ─
reset();
await CronRunLog.create({ jobName: "subscriptionRenewals", status: "running", startedAt: new Date(), triggeredBy: "cron-script" });
let ranAgain = false;
const result = await trackRun("subscriptionRenewals", async () => { ranAgain = true; });
assert.equal(ranAgain, false, "must not run while a fresh lock is held elsewhere");
assert.deepEqual(result, { skipped: true, reason: "already-running", jobName: "subscriptionRenewals" });
console.log("PASS: a job with a fresh (non-stale) lock held elsewhere is skipped, not executed");

// ── a stale lock (crashed process) is reclaimed, not left blocking forever ─
reset();
const staleStart = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago, no finishedAt
await CronRunLog.create({ jobName: "retryFailedPayments", status: "running", startedAt: staleStart, triggeredBy: "cron-script" });
let reclaimedRan = false;
const reclaimedResult = await trackRun("retryFailedPayments", async () => { reclaimedRan = true; return { ok: true }; }, { staleLockMs: 30 * 60 * 1000 });
assert.equal(reclaimedRan, true, "a stale lock from a crashed process must be reclaimed so the job is not blocked forever");
assert.deepEqual(reclaimedResult, { ok: true });
const staleRow = [...rows.values()].find((r) => r.startedAt === staleStart);
assert.equal(staleRow.status, "timed_out");
assert.match(staleRow.error, /Reclaimed/);
console.log("PASS: a stale lock from a crashed process is marked timed_out and reclaimed, and the job actually runs");

// ── a recent lock (well within the threshold) is never mistaken for stale ─
reset();
const freshStart = new Date(Date.now() - 5 * 60 * 1000);
await CronRunLog.create({ jobName: "expirePaymentWindows", status: "running", startedAt: freshStart, triggeredBy: "cron-script" });
const freshResult = await trackRun("expirePaymentWindows", async () => "should not run", { staleLockMs: 30 * 60 * 1000 });
assert.deepEqual(freshResult, { skipped: true, reason: "already-running", jobName: "expirePaymentWindows" });
console.log("PASS: a 5-minute-old lock is correctly treated as still live, not stale");

// ── different jobs never contend with each other ─────────────────────────
reset();
const [a, b] = await Promise.all([
  trackRun("reconciliation", async () => "A"),
  trackRun("subscriptionRenewals", async () => "B"),
]);
assert.deepEqual([a, b], ["A", "B"]);
console.log("PASS: locks are scoped per jobName -- unrelated jobs never block each other");

// ── failure still releases the lock (a real failure, not a stuck lock) ───
reset();
await assert.rejects(() => trackRun("reconciliation", async () => { throw new Error("boom"); }));
const failedRow = [...rows.values()][0];
assert.equal(failedRow.status, "failed");
const retryAfterFailure = await trackRun("reconciliation", async () => "recovered");
assert.equal(retryAfterFailure, "recovered", "a failed run must release the lock immediately, not require the stale-lock timeout");
console.log("PASS: a failed run releases the lock immediately so the next attempt is not blocked");

// ── every cron script and the automation runner actually use trackRun ────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of ["cron/expirePaymentWindows.js", "cron/reconciliationCron.js", "cron/retryFailedPayments.js", "cron/subscriptionRenewals.js", "automation/cronJobs.js"]) {
  assert.match(fs.readFileSync(path.join(root, file), "utf8"), /trackRun\(/, `${file} must go through the locked run tracker`);
}
console.log("PASS: every standalone cron script and the automation runner go through the same locked trackRun()");

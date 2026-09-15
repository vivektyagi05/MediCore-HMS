// Regression test for the doctors/patients "online" count inflation bug
// (100 online / 2 total doctors, 111 online / 2 total patients reported
// against a real dev database). Root cause: OnlineSession documents left
// in status "online" by a previous server process (which died without
// ever firing that socket's "disconnect" handler) were counted as online
// forever. presenceQuery.js's onlineFilter()/isSessionOnline() are the
// single fix point every reader of presence data now goes through — see
// its header comment for the full explanation.
//
// Dependency-free (no database) — same style as monitoringAggregates.test.mjs.

import assert from "node:assert/strict";
import { PRESENCE_STALE_MS, onlineFilter, isSessionOnline } from "../socket/presenceQuery.js";

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("presenceStaleness.test.mjs");

test("onlineFilter always requires status online", () => {
  const filter = onlineFilter();
  assert.equal(filter.status, "online");
  assert.ok(filter.lastActiveAt.$gte instanceof Date);
});

test("onlineFilter merges extra match fields (e.g. role) without dropping the staleness clause", () => {
  const filter = onlineFilter({ role: "doctor" });
  assert.equal(filter.role, "doctor");
  assert.equal(filter.status, "online");
  assert.ok(filter.lastActiveAt.$gte instanceof Date);
});

test("onlineFilter's cutoff is PRESENCE_STALE_MS in the past, not now", () => {
  const before = Date.now() - PRESENCE_STALE_MS;
  const filter = onlineFilter();
  const cutoffMs = filter.lastActiveAt.$gte.getTime();
  // Allow a small margin for test execution time.
  assert.ok(cutoffMs <= before + 50 && cutoffMs >= before - 50);
});

test("isSessionOnline: false for a session marked offline", () => {
  assert.equal(isSessionOnline({ status: "offline", lastActiveAt: new Date() }), false);
});

test("isSessionOnline: false for a session with no lastActiveAt", () => {
  assert.equal(isSessionOnline({ status: "online", lastActiveAt: null }), false);
});

test("isSessionOnline: false for a session whose last heartbeat is older than the stale window (orphaned by a server restart)", () => {
  const staleSession = { status: "online", lastActiveAt: new Date(Date.now() - PRESENCE_STALE_MS - 60_000) };
  assert.equal(isSessionOnline(staleSession), false);
});

test("isSessionOnline: true for a session with a recent heartbeat", () => {
  const freshSession = { status: "online", lastActiveAt: new Date(Date.now() - 5_000) };
  assert.equal(isSessionOnline(freshSession), true);
});

test("isSessionOnline: null/undefined session is treated as offline, not thrown on", () => {
  assert.equal(isSessionOnline(null), false);
  assert.equal(isSessionOnline(undefined), false);
});

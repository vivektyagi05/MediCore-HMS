// Phase UI-11, Part K — SLA Command Center.
// Dependency-free tests, no database: computeSla()'s additive
// `resolvedOnTime` field, and buildSlaOverview()'s bucket counting.

import assert from "node:assert/strict";
import { computeSla, buildSlaOverview, SLA_TARGET_MS } from "../workflow/policies.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("resolvedOnTime is null while an item is still open (never confused with 'not overdue')", () => {
  const sla = computeSla(new Date(Date.now() - 60_000).toISOString(), "high", null);
  assert.strictEqual(sla.state, "on_track");
  assert.strictEqual(sla.resolvedOnTime, null);
});

test("resolvedOnTime true when resolved before the deadline, existing 'completed' state unchanged", () => {
  const created = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago
  const resolvedAt = new Date(created.getTime() + 2 * 60 * 60 * 1000); // resolved 2h in, target for "high" is 24h
  const sla = computeSla(created.toISOString(), "high", resolvedAt.toISOString());
  assert.strictEqual(sla.state, "completed");
  assert.strictEqual(sla.resolvedOnTime, true);
});

test("resolvedOnTime false when resolved after the deadline", () => {
  const created = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
  const resolvedAt = new Date(created.getTime() + 8 * 24 * 60 * 60 * 1000); // resolved after 8 days, target for "high" is 1 day
  const sla = computeSla(created.toISOString(), "high", resolvedAt.toISOString());
  assert.strictEqual(sla.state, "completed");
  assert.strictEqual(sla.resolvedOnTime, false);
  assert.ok(sla.targetMs === SLA_TARGET_MS.high);
});

test("buildSlaOverview buckets a mixed open+resolved item set correctly", () => {
  const now = Date.now();
  const items = [
    { sla: { state: "on_track" } },
    { sla: { state: "on_track" } },
    { sla: { state: "at_risk" } },
    { sla: { state: "overdue" } },
    { sla: { state: "completed", resolvedOnTime: true } },
    { sla: { state: "completed", resolvedOnTime: false } },
    { sla: { state: "completed", resolvedOnTime: false } },
    { sla: null }, // defensive: an item with no computed SLA must not throw or miscount
  ];
  void now;
  assert.deepStrictEqual(buildSlaOverview(items), {
    onTrack: 2,
    atRisk: 1,
    overdue: 1,
    resolvedWithinSla: 1,
    resolvedLate: 2,
  });
});

test("buildSlaOverview returns all zeros for an empty set", () => {
  assert.deepStrictEqual(buildSlaOverview([]), {
    onTrack: 0,
    atRisk: 0,
    overdue: 0,
    resolvedWithinSla: 0,
    resolvedLate: 0,
  });
});

import assert from "assert";
import { deriveNeedsAttention } from "../services/commandCenter/processCommandCenterAggregates.js";

// PHASE UI-13 — Process/Automation/Governance Command Center.
// Pure derivation only (no DB): a process with no computed health at all
// must never appear in "needs attention" (that would silently treat
// missing data as a bad score); a score >= 80 is healthy and excluded;
// scores below 50 are also counted toward unhealthyCount; the list is
// capped at 5 and sorted worst-first.

const processes = [
  { id: "p1", label: "Alpha", category: "clinical", health: { score: 95 } }, // healthy, excluded
  { id: "p2", label: "Beta", category: "billing", health: { score: 45 } }, // unhealthy
  { id: "p3", label: "Gamma", category: "billing", health: { score: 70 } }, // needs attention, not unhealthy
  { id: "p4", label: "Delta", category: "ops", health: null }, // no data — must never appear
  { id: "p5", label: "Epsilon", category: "ops", health: { score: 10 } }, // worst
];

const { unhealthyCount, needsAttention } = deriveNeedsAttention(processes);

assert.strictEqual(unhealthyCount, 2, "only p2 (45) and p5 (10) are below the 50 unhealthy threshold");
console.log("PASS: unhealthyCount only counts processes with a real score below 50");

assert.strictEqual(needsAttention.length, 3, "p1 (95, healthy) and p4 (no score) must be excluded");
assert.strictEqual(needsAttention[0].id, "p5", "worst score (10) must sort first");
assert.strictEqual(needsAttention[1].id, "p2");
assert.strictEqual(needsAttention[2].id, "p3");
console.log("PASS: needsAttention excludes healthy/no-data processes and sorts worst-first");

assert.ok(
  needsAttention.every((p) => typeof p.score === "number"),
  "every entry must carry a real numeric score — never a fabricated placeholder",
);
console.log("PASS: no fabricated scores in the needsAttention list");

import assert from "assert";
import { summarizeCapabilityRegistry, summarizeDraftActivity } from "../services/ai/aiSystemHealthAggregates.js";

// ── summarizeCapabilityRegistry ─────────────────────────────────────────
const registry = summarizeCapabilityRegistry();

assert.ok(registry.totalCapabilities > 0, "registry should report at least one capability");
console.log(`PASS: capability registry reports ${registry.totalCapabilities} total capabilities`);

const scopeSum = Object.values(registry.byScope).reduce((a, b) => a + b, 0);
assert.strictEqual(scopeSum, registry.totalCapabilities, "byScope counts must sum to totalCapabilities — no capability silently dropped");
console.log("PASS: byScope breakdown sums exactly to totalCapabilities");

// ── summarizeDraftActivity ──────────────────────────────────────────────
const now = new Date("2026-08-16T12:00:00.000Z").getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const drafts = [
  { promptKey: "commandCenterExecutiveSummary", generatedBy: "hms-template-engine", createdAt: new Date(now - 1 * 60 * 60 * 1000) }, // 1h ago — today
  { promptKey: "commandCenterExecutiveSummary", generatedBy: "hms-template-engine", createdAt: new Date(now - 2 * ONE_DAY_MS) }, // 2d ago — in 7d window
  { promptKey: "draftClinicalNote", generatedBy: "hms-template-engine", createdAt: new Date(now - 10 * ONE_DAY_MS) }, // 10d ago — outside 7d window
];

const activity = summarizeDraftActivity(drafts, now);

assert.strictEqual(activity.trackedGenerationsToday, 1, "only the 1h-ago draft falls within today");
console.log("PASS: trackedGenerationsToday counts only same-UTC-day drafts");

assert.strictEqual(activity.trackedGenerationsLast7d, 2, "the 1h-ago and 2d-ago drafts both fall within the last 7 days");
console.log("PASS: trackedGenerationsLast7d excludes the 10-day-old draft");

assert.strictEqual(activity.topCapabilities[0].promptKey, "commandCenterExecutiveSummary");
assert.strictEqual(activity.topCapabilities[0].count, 2);
console.log("PASS: topCapabilities ranks by count, most-used first");

assert.strictEqual(activity.lastGeneratedAt.getTime(), now - 1 * 60 * 60 * 1000, "lastGeneratedAt should be the most recent draft, not the first in the array");
console.log("PASS: lastGeneratedAt picks the most recent draft regardless of array order");

// ── empty input must never throw or fabricate ───────────────────────────
const emptyActivity = summarizeDraftActivity([], now);
assert.strictEqual(emptyActivity.trackedGenerationsToday, 0);
assert.strictEqual(emptyActivity.lastGeneratedAt, null);
assert.deepStrictEqual(emptyActivity.topCapabilities, []);
console.log("PASS: empty draft history returns honest zeros/null, never fabricated activity");

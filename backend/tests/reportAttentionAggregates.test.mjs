import assert from "assert";
import { computeReportAttentionItems } from "../services/reportAttentionAggregates.js";

const critical = { _id: "r1", title: "MRI Brain", category: "imaging", severity: "critical", reportDate: "2026-08-01", createdAt: "2026-08-01", userId: { _id: "p1", name: "Asha Rao" } };
const urgentOlder = { _id: "r2", title: "CBC Panel", category: "lab", severity: "urgent", reportDate: "2026-07-01", createdAt: "2026-07-01", userId: { _id: "p2", name: "Vikram Shah" } };
const urgentNewer = { _id: "r3", title: "Lipid Panel", category: "lab", severity: "urgent", reportDate: "2026-08-10", createdAt: "2026-08-10", userId: { _id: "p3", name: "Meera Iyer" } };
const normal = { _id: "r4", title: "Routine X-Ray", category: "imaging", severity: "normal", reportDate: "2026-08-15", createdAt: "2026-08-15", userId: { _id: "p4", name: "Rohan Gupta" } };
const noSeverity = { _id: "r5", title: "Old Upload", category: "other", reportDate: "2026-01-01", createdAt: "2026-01-01", userId: { _id: "p5", name: "Legacy Patient" } };

const items = computeReportAttentionItems([normal, urgentNewer, critical, noSeverity, urgentOlder]);

// ── priority classification is derived only from the patient-declared
// severity — never inferred from title/category text ────────────────────
assert.strictEqual(items.find((i) => i.reportId === "r1").priority, "critical");
assert.strictEqual(items.find((i) => i.reportId === "r2").priority, "warning");
assert.strictEqual(items.find((i) => i.reportId === "r3").priority, "warning");
assert.strictEqual(items.find((i) => i.reportId === "r4").priority, "info");
console.log("PASS: severity maps to priority deterministically (critical/urgent/normal -> critical/warning/info)");

// Missing severity must not crash and must not be silently upgraded — a
// report with no declared severity is never treated as more urgent than one
// that was explicitly marked normal.
assert.strictEqual(items.find((i) => i.reportId === "r5").priority, "info");
console.log("PASS: missing severity defaults to normal/info rather than fabricating urgency");

// ── ordering: critical first, then warning, then info; within the same
// priority tier, oldest-unreviewed-first ─────────────────────────────────
assert.strictEqual(items[0].reportId, "r1", "critical item must rank first");
const warningIds = items.filter((i) => i.priority === "warning").map((i) => i.reportId);
assert.deepStrictEqual(warningIds, ["r2", "r3"], "older urgent report (r2) must rank before newer urgent report (r3)");
console.log("PASS: critical-first ordering, oldest-first within a priority tier");

const priorityRank = { critical: 0, warning: 1, info: 2 };
for (let i = 1; i < items.length; i += 1) {
  assert.ok(
    priorityRank[items[i - 1].priority] <= priorityRank[items[i].priority],
    "priority tiers must never regress (a lower-priority item must never precede a higher-priority one)"
  );
}
console.log("PASS: full list is monotonically non-decreasing in priority rank");

// ── patient identity is carried through for display, without leaking the
// raw populated document shape into callers ──────────────────────────────
const criticalItem = items.find((i) => i.reportId === "r1");
assert.strictEqual(criticalItem.patientId, "p1");
assert.strictEqual(criticalItem.patientName, "Asha Rao");
console.log("PASS: patientId/patientName are correctly unwrapped from a populated userId");

// A report with no populated patient name must fall back gracefully instead
// of rendering "undefined" in the UI.
const unpopulated = computeReportAttentionItems([{ _id: "r6", title: "No Patient Data", severity: "normal", reportDate: "2026-01-01", userId: "p6" }]);
assert.strictEqual(unpopulated[0].patientName, "A patient");
assert.strictEqual(unpopulated[0].patientId, "p6");
console.log("PASS: unpopulated userId falls back to a safe display name without crashing");

// ── empty input ───────────────────────────────────────────────────────────
assert.deepStrictEqual(computeReportAttentionItems([]), []);
console.log("PASS: empty report list produces an empty attention queue");

console.log("\nAll reportAttentionAggregates tests passed.");

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMedicationReconciliation, buildSinceLastVisitComparison } from "../services/clinicalComparisonService.js";

test("buildMedicationReconciliation: fewer than 2 prescriptions -> null (no fabricated comparison)", () => {
  assert.equal(buildMedicationReconciliation([]), null);
  assert.equal(buildMedicationReconciliation([{ _id: "p1", medicines: [] }]), null);
});

test("buildMedicationReconciliation: detects NEW / CONTINUED / STOPPED / DOSE_CHANGED", () => {
  const current = {
    _id: "p2",
    createdAt: "2026-08-01",
    medicines: [
      { name: "Amlodipine", dosage: "10mg", frequency: "once daily" },
      { name: "Metformin", dosage: "500mg", frequency: "twice daily" },
      { name: "Vitamin D", dosage: "1000IU", frequency: "once daily" },
    ],
  };
  const previous = {
    _id: "p1",
    createdAt: "2026-07-01",
    medicines: [
      { name: "Amlodipine", dosage: "5mg", frequency: "once daily" },
      { name: "Metformin", dosage: "500mg", frequency: "twice daily" },
      { name: "Drug X", dosage: "10mg", frequency: "once daily" },
    ],
  };
  const result = buildMedicationReconciliation([current, previous]);
  const byName = Object.fromEntries(result.rows.map((r) => [r.name, r.status]));
  assert.equal(byName["Vitamin D"], "NEW");
  assert.equal(byName["Metformin"], "CONTINUED");
  assert.equal(byName["Amlodipine"], "DOSE_CHANGED");
  assert.equal(byName["Drug X"], "STOPPED");
});

test("buildMedicationReconciliation: excludes cancelled prescriptions", () => {
  const rows = [
    { _id: "p2", status: "cancelled", createdAt: "2026-08-01", medicines: [{ name: "A", dosage: "1", frequency: "x" }] },
    { _id: "p1", createdAt: "2026-07-01", medicines: [{ name: "A", dosage: "1", frequency: "x" }] },
  ];
  assert.equal(buildMedicationReconciliation(rows), null);
});

test("buildSinceLastVisitComparison: fewer than 2 real visits -> comparison unavailable, not fabricated", () => {
  const result = buildSinceLastVisitComparison({ appointments: [{ date: "2026-08-01", status: "completed" }] });
  assert.equal(result.available, false);
  assert.ok(result.reason);
});

test("buildSinceLastVisitComparison: computes real report/document deltas between the two most recent visits", () => {
  const appointments = [
    { date: "2026-08-15", status: "completed" },
    { date: "2026-07-01", status: "completed" },
  ];
  const reports = [
    { reportDate: "2026-08-10", createdAt: "2026-08-10" }, // after previous visit, before current
    { reportDate: "2026-06-01", createdAt: "2026-06-01" }, // before previous visit
  ];
  const result = buildSinceLastVisitComparison({ appointments, prescriptions: [], reports, certificates: [], followUp: null });
  assert.equal(result.available, true);
  const reportsRow = result.rows.find((r) => r.label === "Reports");
  assert.equal(reportsRow.previous, "1");
  assert.equal(reportsRow.current, "2");
  assert.equal(reportsRow.status, "NEW");
});

test("buildSinceLastVisitComparison: overdue follow-up surfaces as OVERDUE status", () => {
  const appointments = [
    { date: "2026-08-15", status: "completed" },
    { date: "2026-07-01", status: "completed" },
  ];
  const result = buildSinceLastVisitComparison({
    appointments,
    prescriptions: [],
    reports: [],
    certificates: [],
    followUp: { overdue: "2026-08-05", upcoming: null },
  });
  const followUpRow = result.rows.find((r) => r.label === "Follow-up");
  assert.equal(followUpRow.status, "OVERDUE");
  assert.equal(followUpRow.current, "Overdue");
});

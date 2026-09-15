// Dependency-free tests for the deterministic (non-AI) risk/attention rules
// that back both the Patient Registry list and the Patient 360 Workspace.
// No live MongoDB needed — computeAttentionItems/computePatientRiskLevel/
// calculateAge take plain objects, same style as processGovernanceEngine's
// dependency-injected evaluateGovernance().

import assert from "node:assert/strict";
import {
  calculateAge,
  computePatientRiskLevel,
  computeAttentionItems,
} from "../services/patientAdminAggregationService.js";

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

test("calculateAge: computes a real age from a date of birth", () => {
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  eighteenYearsAgo.setDate(eighteenYearsAgo.getDate() - 1); // safely past birthday
  assert.equal(calculateAge(eighteenYearsAgo), 18);
});

test("calculateAge: returns null when there is no date of birth on file (never fabricated)", () => {
  assert.equal(calculateAge(undefined), null);
  assert.equal(calculateAge(""), null);
});

test("computePatientRiskLevel: high when 3+ conditions on file, regardless of pain", () => {
  assert.equal(
    computePatientRiskLevel({ medicalConditions: ["a", "b", "c"], allergies: [], latestPainLevel: null }),
    "high",
  );
});

test("computePatientRiskLevel: high when latest pain level is 7+", () => {
  assert.equal(computePatientRiskLevel({ medicalConditions: [], allergies: [], latestPainLevel: 8 }), "high");
});

test("computePatientRiskLevel: medium when an allergy is on file with no conditions/pain", () => {
  assert.equal(computePatientRiskLevel({ medicalConditions: [], allergies: ["penicillin"], latestPainLevel: null }), "medium");
});

test("computePatientRiskLevel: low when nothing is on file", () => {
  assert.equal(computePatientRiskLevel({ medicalConditions: [], allergies: [], latestPainLevel: null }), "low");
});

test("computeAttentionItems: flags a failed payment with a real, sourced item", () => {
  const items = computeAttentionItems(
    { patientProfile: {} },
    { criticalUnreviewedReports: [], hasFailedPayment: true, outstandingAmount: 0, expiringInsurance: [], expiredInsurance: [], insurance: [] },
  );
  const item = items.find((i) => i.key === "payment-failed");
  assert.ok(item, "expected a payment-failed attention item");
  assert.equal(item.severity, "warning");
  assert.ok(item.source);
});

test("computeAttentionItems: never fires the outstanding-balance item when the balance is zero", () => {
  const items = computeAttentionItems(
    { patientProfile: {} },
    { criticalUnreviewedReports: [], hasFailedPayment: false, outstandingAmount: 0, expiringInsurance: [], expiredInsurance: [], insurance: [] },
  );
  assert.ok(!items.some((i) => i.key === "outstanding-balance"));
});

test("computeAttentionItems: flags a critical unreviewed report with an escalation action", () => {
  const items = computeAttentionItems(
    { patientProfile: {} },
    {
      criticalUnreviewedReports: [{ _id: "r1", title: "MRI Scan", severity: "critical", reportDate: new Date() }],
      hasFailedPayment: false,
      outstandingAmount: 0,
      expiringInsurance: [],
      expiredInsurance: [],
      insurance: [],
    },
  );
  const item = items.find((i) => i.key === "report-unreviewed-r1");
  assert.ok(item);
  assert.equal(item.severity, "critical");
  assert.ok(item.action, "expected a suggested next action");
});

test("computeAttentionItems: never invents an allergy that isn't on the patient profile", () => {
  const items = computeAttentionItems(
    { patientProfile: { allergies: [] } },
    { criticalUnreviewedReports: [], hasFailedPayment: false, outstandingAmount: 0, expiringInsurance: [], expiredInsurance: [], insurance: [] },
  );
  assert.ok(!items.some((i) => i.key === "allergy-on-file"));
});

test("computeAttentionItems: flags incomplete profile only for the fields genuinely missing", () => {
  const items = computeAttentionItems(
    { patientProfile: { bloodGroup: "O+", emergencyContact: {}, dateOfBirth: null } },
    { criticalUnreviewedReports: [], hasFailedPayment: false, outstandingAmount: 0, expiringInsurance: [], expiredInsurance: [], insurance: [] },
  );
  const item = items.find((i) => i.key === "incomplete-profile");
  assert.ok(item);
  assert.match(item.what, /emergency contact/);
  assert.match(item.what, /date of birth/);
  assert.doesNotMatch(item.what, /blood group/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildOpenClinicalActions } from "../services/doctorPatientRelationshipService.js";
import { resolveCopilotQuestionKey, COPILOT_QUICK_QUESTIONS } from "../ai/generativeAssistant.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("buildOpenClinicalActions: no real data -> no fabricated actions", () => {
  assert.deepEqual(buildOpenClinicalActions({ followUp: null, reports: [], consultationAwaitingCompletion: [] }), []);
});

test("buildOpenClinicalActions: overdue follow-up produces a real WHAT/WHY/WHEN/ACTION item", () => {
  const actions = buildOpenClinicalActions({ followUp: { overdue: "2026-08-01" }, reports: [], consultationAwaitingCompletion: [] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, "OVERDUE");
  assert.equal(actions[0].action, "followup");
  assert.ok(actions[0].what && actions[0].why && actions[0].when);
});

test("buildOpenClinicalActions: unreviewed reports each produce a distinct report-review action", () => {
  const reports = [
    { _id: "r1", title: "CBC", reportDate: "2026-08-10", reviewedAt: null },
    { _id: "r2", title: "X-Ray", reportDate: "2026-08-11", reviewedAt: "2026-08-12" }, // already reviewed — excluded
  ];
  const actions = buildOpenClinicalActions({ followUp: null, reports, consultationAwaitingCompletion: [] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "report");
  assert.equal(actions[0].reportId, "r1");
});

test("buildOpenClinicalActions: consultation awaiting completion surfaces a complete-consultation action", () => {
  const actions = buildOpenClinicalActions({ followUp: null, reports: [], consultationAwaitingCompletion: [{ _id: "a1", date: "2026-08-01" }] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "clinical");
  assert.equal(actions[0].appointmentId, "a1");
});

test("resolveCopilotQuestionKey: exact quick-question keys resolve directly", () => {
  for (const q of COPILOT_QUICK_QUESTIONS) {
    assert.equal(resolveCopilotQuestionKey(q.key), q.key);
  }
});

test("resolveCopilotQuestionKey: wider natural-language synonyms resolve to the right intent (gap-closure §13)", () => {
  assert.equal(resolveCopilotQuestionKey("what is she currently taking"), "current_medicines");
  assert.equal(resolveCopilotQuestionKey("when is the next follow up due"), "follow_up");
  assert.equal(resolveCopilotQuestionKey("when was the last visit"), "previous_visit");
  assert.equal(resolveCopilotQuestionKey("what happened recently"), "recent_events");
  assert.equal(resolveCopilotQuestionKey("any dose changes"), "medications");
});

test("resolveCopilotQuestionKey: unsupported question returns null (never guesses)", () => {
  assert.equal(resolveCopilotQuestionKey("what is the weather today"), null);
  assert.equal(resolveCopilotQuestionKey(""), null);
});

// Static ownership-guard ordering check (no DB in this sandbox, same
// approach as tests/adminPrivilegeEscalation.test.mjs): confirms the
// doctor-treated-this-patient guard textually precedes the first
// patient-scoped data read in each new gap-closure endpoint, so neither
// can be edited later to query before authorizing without this test
// catching it.
test("security: markPatientReportReviewed checks ensureDoctorTreatedPatient before reading the report", () => {
  const src = fs.readFileSync(path.join(__dirname, "../controllers/doctor/workflowController.js"), "utf8");
  const fnStart = src.indexOf("export const markPatientReportReviewed");
  const fnBody = src.slice(fnStart, src.indexOf("\n});", fnStart));
  const guardIndex = fnBody.indexOf("ensureDoctorTreatedPatient");
  const readIndex = fnBody.indexOf("MedicalReport.findOneAndUpdate");
  assert.ok(guardIndex > -1 && readIndex > -1, "expected both the guard and the report read to be present");
  assert.ok(guardIndex < readIndex, "ownership guard must run before the report is read/updated");
});

test("security: clinicalCopilotAnswer checks doctor-treated-patient before reading any clinical data", () => {
  const src = fs.readFileSync(path.join(__dirname, "../ai/generativeAssistant.js"), "utf8");
  const fnStart = src.indexOf("async clinicalCopilotAnswer");
  const fnBody = src.slice(fnStart, src.indexOf("\n  },", fnStart));
  const guardIndex = fnBody.indexOf("Appointment.exists");
  const readIndex = fnBody.indexOf("Promise.all([");
  assert.ok(guardIndex > -1 && readIndex > -1, "expected both the ownership check and the data fetch to be present");
  assert.ok(guardIndex < readIndex, "ownership check must run before any patient/appointment/prescription/report data is fetched");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeRiskLevel,
  resolveFollowUpState,
  computeDoctorPatientAttentionItems,
  matchesPatientFilter,
  isInsuranceExpiringSoon,
} from "../services/doctorPatientRelationshipService.js";

test("computeRiskLevel: high pain level -> high risk", () => {
  assert.equal(computeRiskLevel({ painLevel: 8, conditionCount: 0, allergyCount: 0 }), "high");
});

test("computeRiskLevel: 3+ conditions -> high risk even with no pain reported", () => {
  assert.equal(computeRiskLevel({ painLevel: null, conditionCount: 3, allergyCount: 0 }), "high");
});

test("computeRiskLevel: allergy alone -> medium risk", () => {
  assert.equal(computeRiskLevel({ painLevel: null, conditionCount: 0, allergyCount: 1 }), "medium");
});

test("computeRiskLevel: nothing on file -> low risk", () => {
  assert.equal(computeRiskLevel({ painLevel: null, conditionCount: 0, allergyCount: 0 }), "low");
});

test("resolveFollowUpState: past-due date with no later visit is overdue", () => {
  const now = new Date("2026-08-20").getTime();
  const followUpDates = [new Date("2026-08-10").toISOString()];
  const result = resolveFollowUpState({ followUpDates, lastVisit: null, now });
  assert.equal(result.bucket, "overdue");
  assert.equal(result.overdue, followUpDates[0]);
});

test("resolveFollowUpState: past-due date IS resolved if a later visit happened", () => {
  const now = new Date("2026-08-20").getTime();
  const followUpDates = [new Date("2026-08-10").toISOString()];
  const lastVisit = new Date("2026-08-15").toISOString();
  const result = resolveFollowUpState({ followUpDates, lastVisit, now });
  assert.equal(result.overdue, null);
  assert.equal(result.bucket, null);
});

test("resolveFollowUpState: future date within window buckets as upcoming", () => {
  const now = new Date("2026-08-20").getTime();
  const followUpDates = [new Date("2026-08-25").toISOString()];
  const result = resolveFollowUpState({ followUpDates, lastVisit: null, now });
  assert.equal(result.bucket, "upcoming");
  assert.equal(result.upcoming, followUpDates[0]);
});

test("matchesPatientFilter: followup_due matches overdue/due_today/upcoming buckets only", () => {
  const withOverdue = { followUp: { overdue: "2026-08-01", bucket: "overdue" }, lastVisit: null };
  const withNone = { followUp: { overdue: null, bucket: null }, lastVisit: null };
  assert.equal(matchesPatientFilter(withOverdue, "followup_due"), true);
  assert.equal(matchesPatientFilter(withNone, "followup_due"), false);
});

test("matchesPatientFilter: no_recent_visit true when never visited or >90 days", () => {
  const now = new Date("2026-08-20").getTime();
  const neverVisited = { lastVisit: null };
  const oldVisit = { lastVisit: new Date("2026-01-01").toISOString() };
  const recentVisit = { lastVisit: new Date("2026-08-18").toISOString() };
  assert.equal(matchesPatientFilter(neverVisited, "no_recent_visit", now), true);
  assert.equal(matchesPatientFilter(oldVisit, "no_recent_visit", now), true);
  assert.equal(matchesPatientFilter(recentVisit, "no_recent_visit", now), false);
});

test("matchesPatientFilter: high_risk matches only riskLevel high", () => {
  assert.equal(matchesPatientFilter({ riskLevel: "high" }, "high_risk"), true);
  assert.equal(matchesPatientFilter({ riskLevel: "medium" }, "high_risk"), false);
});

test("matchesPatientFilter: all always matches", () => {
  assert.equal(matchesPatientFilter({}, "all"), true);
  assert.equal(matchesPatientFilter({}, undefined), true);
});

test("isInsuranceExpiringSoon: true only within the 30-day window, not already expired", () => {
  const now = new Date("2026-08-20").getTime();
  assert.equal(isInsuranceExpiringSoon(new Date("2026-08-30").toISOString(), now), true);
  assert.equal(isInsuranceExpiringSoon(new Date("2026-10-30").toISOString(), now), false);
  assert.equal(isInsuranceExpiringSoon(new Date("2026-08-01").toISOString(), now), false);
  assert.equal(isInsuranceExpiringSoon(null, now), false);
});

test("computeDoctorPatientAttentionItems: never fabricates an item not backed by real data", () => {
  const items = computeDoctorPatientAttentionItems({
    followUp: { overdue: null, bucket: null },
    nextVisit: null,
    allergies: [],
    insurance: null,
    outstandingAmount: 0,
    unreadMessages: 0,
  });
  assert.deepEqual(items, []);
});

test("computeDoctorPatientAttentionItems: overdue follow-up produces a critical item with real date", () => {
  const items = computeDoctorPatientAttentionItems({
    followUp: { overdue: "2026-08-01T00:00:00.000Z", bucket: "overdue" },
    nextVisit: null,
    allergies: [],
    insurance: null,
    outstandingAmount: 0,
    unreadMessages: 0,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "followup-overdue");
  assert.equal(items[0].severity, "critical");
});

test("computeDoctorPatientAttentionItems: unread messages surface as action_required", () => {
  const items = computeDoctorPatientAttentionItems({
    followUp: { overdue: null, bucket: null },
    nextVisit: null,
    allergies: [],
    insurance: null,
    outstandingAmount: 0,
    unreadMessages: 3,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "unread-messages");
  assert.match(items[0].what, /3 unread messages/);
});

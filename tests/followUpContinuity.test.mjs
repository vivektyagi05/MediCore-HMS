import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveScheduledFollowUps,
  computeDoctorPatientAttentionItems,
  buildOpenClinicalActions,
} from "../services/doctorPatientRelationshipService.js";

// ── resolveScheduledFollowUps ──────────────────────────────────────────────

test("resolveScheduledFollowUps: active future appointment buckets as scheduled", () => {
  const items = resolveScheduledFollowUps([
    {
      prescription: { _id: "p1", patientId: "pat1", diagnosis: "Hypertension" },
      appointment: { _id: "a1", date: "2026-09-10", timeSlot: "10:00-10:15", status: "approved" },
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].bucket, "scheduled");
  assert.equal(items[0].appointmentId, "a1");
});

test("resolveScheduledFollowUps: completed/review_eligible appointment buckets as completed", () => {
  const completed = resolveScheduledFollowUps([
    { prescription: { _id: "p1", patientId: "pat1" }, appointment: { _id: "a1", date: "2026-08-20", status: "completed" } },
  ]);
  const reviewEligible = resolveScheduledFollowUps([
    { prescription: { _id: "p2", patientId: "pat1" }, appointment: { _id: "a2", date: "2026-08-21", status: "review_eligible" } },
  ]);
  assert.equal(completed[0].bucket, "completed");
  assert.equal(reviewEligible[0].bucket, "completed");
});

test("resolveScheduledFollowUps: cancelled linked appointment buckets as cancelled_needs_action (defensive path)", () => {
  const items = resolveScheduledFollowUps([
    { prescription: { _id: "p1", patientId: "pat1" }, appointment: { _id: "a1", date: "2026-08-20", status: "cancelled" } },
  ]);
  assert.equal(items[0].bucket, "cancelled_needs_action");
});

test("resolveScheduledFollowUps: a stale/deleted link (no appointment found) produces nothing fabricated", () => {
  const items = resolveScheduledFollowUps([{ prescription: { _id: "p1" }, appointment: undefined }]);
  assert.deepEqual(items, []);
});

test("resolveScheduledFollowUps: never fabricates when given no pairs", () => {
  assert.deepEqual(resolveScheduledFollowUps([]), []);
  assert.deepEqual(resolveScheduledFollowUps(), []);
});

// ── computeDoctorPatientAttentionItems: cancelled-follow-up precedence ────

test("computeDoctorPatientAttentionItems: cancelled scheduled follow-up produces a critical item and takes precedence over plain overdue", () => {
  const items = computeDoctorPatientAttentionItems({
    followUp: { overdue: "2026-08-01T00:00:00.000Z", bucket: "overdue" },
    scheduledFollowUps: [{ bucket: "cancelled_needs_action", appointmentId: "a1" }],
    nextVisit: null,
    allergies: [],
    insurance: null,
    outstandingAmount: 0,
    unreadMessages: 0,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "followup-cancelled");
  assert.equal(items[0].severity, "critical");
});

test("computeDoctorPatientAttentionItems: no scheduledFollowUps passed behaves exactly as before (backward compatible)", () => {
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
});

// ── buildOpenClinicalActions: scheduled + cancelled additions ─────────────

test("buildOpenClinicalActions: a scheduled follow-up produces a real SCHEDULED action, not an OVERDUE one", () => {
  const actions = buildOpenClinicalActions({
    followUp: null,
    reports: [],
    consultationAwaitingCompletion: [],
    scheduledFollowUps: [{ bucket: "scheduled", appointmentId: "a1", appointmentDate: "2026-09-10" }],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, "SCHEDULED");
  assert.equal(actions[0].action, "appointments");
  assert.equal(actions[0].appointmentId, "a1");
});

test("buildOpenClinicalActions: cancelled-needs-action follow-up takes precedence over a plain overdue followUp", () => {
  const actions = buildOpenClinicalActions({
    followUp: { overdue: "2026-08-01" },
    reports: [],
    consultationAwaitingCompletion: [],
    scheduledFollowUps: [{ bucket: "cancelled_needs_action", appointmentId: "a1", appointmentDate: "2026-08-15" }],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, "OVERDUE");
  assert.match(actions[0].what, /Reschedule/);
});

test("buildOpenClinicalActions: completed follow-ups produce no open action (loop is closed, nothing to do)", () => {
  const actions = buildOpenClinicalActions({
    followUp: null,
    reports: [],
    consultationAwaitingCompletion: [],
    scheduledFollowUps: [{ bucket: "completed", appointmentId: "a1", appointmentDate: "2026-08-01" }],
  });
  assert.deepEqual(actions, []);
});

test("buildOpenClinicalActions: no scheduledFollowUps passed behaves exactly as before (backward compatible)", () => {
  const actions = buildOpenClinicalActions({ followUp: { overdue: "2026-08-01" }, reports: [], consultationAwaitingCompletion: [] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, "OVERDUE");
});

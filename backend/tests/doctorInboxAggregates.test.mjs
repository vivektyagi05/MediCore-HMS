import assert from "assert";
import { resolveCategory, classifyPriority, resolveAction, priorityWeight, PRIORITY } from "../services/doctorInboxAggregates.js";

// ── Category resolves from entityType first, so historical mis-typed rows
// (type: "appointment" but entityType: "review"/"payout", the real bug this
// phase fixed at the source) still categorize correctly with no migration ──
{
  const legacyReview = { type: "appointment", entityType: "review" };
  assert.strictEqual(resolveCategory(legacyReview).key, "reviews", "entityType must win over a stale/mis-typed `type` field");

  const legacyPayout = { type: "appointment", entityType: "payout" };
  assert.strictEqual(resolveCategory(legacyPayout).key, "payments", "entityType must win over a stale/mis-typed `type` field");

  console.log("PASS: category resolution prefers entityType over type, fixing historical mis-typed rows without a migration");
}

// ── Falls back to `type` when entityType is absent (e.g. admin_announcement) ──
{
  const broadcast = { type: "admin_announcement", entityType: undefined };
  assert.strictEqual(resolveCategory(broadcast).key, "system");
  console.log("PASS: category falls back to `type` when entityType is absent");
}

// ── Unknown combination never crashes, falls back to Other ──
{
  const unknown = { type: "totally_unknown_type", entityType: undefined };
  assert.strictEqual(resolveCategory(unknown).key, "other");
  console.log("PASS: unresolvable category falls back to Other rather than crashing");
}

// ── Priority: severity critical always wins, regardless of other context ──
{
  const item = { severity: "critical", entityType: "appointment" };
  assert.strictEqual(classifyPriority(item, { appointmentStatus: "confirmed" }), PRIORITY.URGENT);
  console.log("PASS: critical severity always classifies as urgent");
}

// ── Priority: pending appointment approval is action-required even at info severity ──
{
  const item = { severity: "info", entityType: "appointment" };
  assert.strictEqual(classifyPriority(item, { appointmentStatus: "pending" }), PRIORITY.ACTION_REQUIRED);
  assert.strictEqual(classifyPriority(item, { appointmentStatus: "approved" }), PRIORITY.INFORMATION, "a non-pending appointment notification at info severity is informational");
  console.log("PASS: pending-approval appointment notifications classify as action-required");
}

// ── Priority: unreplied review is action-required even at info severity ──
{
  const item = { severity: "info", entityType: "review" };
  assert.strictEqual(classifyPriority(item, { reviewReplied: false }), PRIORITY.ACTION_REQUIRED);
  assert.strictEqual(classifyPriority(item, { reviewReplied: true }), PRIORITY.INFORMATION);
  console.log("PASS: unreplied review notifications classify as action-required");
}

// ── Priority: warning severity defaults to action-required ──
{
  const item = { severity: "warning", entityType: "DoctorDocument" };
  assert.strictEqual(classifyPriority(item), PRIORITY.ACTION_REQUIRED);
  console.log("PASS: warning severity defaults to action-required");
}

// ── Priority weight orders urgent < action_required < information ──
{
  assert.ok(priorityWeight(PRIORITY.URGENT) < priorityWeight(PRIORITY.ACTION_REQUIRED));
  assert.ok(priorityWeight(PRIORITY.ACTION_REQUIRED) < priorityWeight(PRIORITY.INFORMATION));
  console.log("PASS: priority weight orders urgent before action-required before information");
}

// ── Action: appointment/prescription/report all reuse the existing
// clinical-workspace deep-link convention when a patientId is resolved ──
{
  const appt = resolveAction({ entityType: "appointment", entityId: "a1" }, { patientId: "p1" });
  assert.strictEqual(appt.to, "/doctor/clinical?patientId=p1&tab=history");

  const rx = resolveAction({ entityType: "prescription", entityId: "rx1" }, { patientId: "p2" });
  assert.strictEqual(rx.to, "/doctor/clinical?patientId=p2&tab=history");

  const report = resolveAction({ entityType: "report", entityId: "r1" }, { patientId: "p3" });
  assert.strictEqual(report.to, "/doctor/clinical?patientId=p3&tab=history");

  console.log("PASS: appointment/prescription/report actions reuse the existing clinical-workspace deep link");
}

// ── Action: no patientId resolved -> no invented route ──
{
  const appt = resolveAction({ entityType: "appointment", entityId: "a1" }, {});
  assert.strictEqual(appt, null, "must not invent a route when the entity's patientId could not be resolved");
  console.log("PASS: an unresolved patientId means no action is offered, rather than an invented route");
}

// ── Action: self-contained categories never need lookup context ──
{
  assert.strictEqual(resolveAction({ entityType: "review", entityId: "rev1" }).to, "/doctor/reviews?reviewId=rev1");
  assert.strictEqual(resolveAction({ entityType: "payout", entityId: "po1" }).to, "/doctor/earnings?payoutId=po1");
  assert.strictEqual(resolveAction({ entityType: "DoctorDocument", entityId: "doc1" }).to, "/doctor/documents?documentId=doc1");
  assert.strictEqual(resolveAction({ entityType: "Doctor" }).to, "/doctor/verification");
  assert.strictEqual(resolveAction({ entityType: "Subscription" }).to, "/doctor/billing");
  assert.strictEqual(resolveAction({ entityType: "Invoice" }).to, "/doctor/billing");
  assert.strictEqual(resolveAction({ entityType: "LeaveRequest" }).to, "/doctor/schedule");
  console.log("PASS: self-contained categories resolve their real destination with no extra context needed");
}

// ── Action: unrecognized/ungrounded entity types never get a fabricated route ──
{
  assert.strictEqual(resolveAction({ entityType: "some_workflow_definition_key", entityId: "op1" }), null);
  assert.strictEqual(resolveAction({ type: "automation" }), null);
  console.log("PASS: automation/workflow items with no real destination render as information-only, not a fabricated route");
}

console.log("\nAll doctorInboxAggregates tests passed.");

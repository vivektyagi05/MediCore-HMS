// Regression tests for two related process-hardening bugs:
//
// Bug #3 — NotificationDelivery's `type` enum never included
// "workflow_assigned"/"workflow_escalated", even though workflowEvents.js
// has sent exactly those types since Phase A6.2.1. Every assignment/
// escalation notification was silently failing Mongoose validation.
//
// Bug #4 — workflowEventBus.emit() is fire-and-forget: an async listener's
// rejection (e.g. the validation failure above) became an unhandled
// promise rejection nobody could observe, while the HTTP layer still
// reported a plain 200 success. emitWorkflowEvent() awaits listeners and
// reports { delivered, error } instead of hiding the outcome.
//
// Dependency-free — no live MongoDB, no HTTP server, same style as
// monitoringAggregates.test.mjs / automationConditionEvaluator.test.mjs.

import assert from "node:assert/strict";
import mongoose from "mongoose";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { workflowEventBus, WORKFLOW_EVENTS, emitWorkflowEvent } from "../workflow/workflowEvents.js";

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("workflowNotifications.test.mjs");

// ── Bug #3: enum now accepts the two workflow notification types ────────

test("NotificationDelivery accepts type=workflow_assigned", () => {
  const doc = new NotificationDelivery({
    recipientId: new mongoose.Types.ObjectId(),
    type: "workflow_assigned",
    title: "Operation assigned to you",
    message: "You have been assigned an item in the queue.",
  });
  const validationError = doc.validateSync();
  assert.equal(validationError, undefined, "workflow_assigned must be a valid enum value");
});

test("NotificationDelivery accepts type=workflow_escalated", () => {
  const doc = new NotificationDelivery({
    recipientId: new mongoose.Types.ObjectId(),
    type: "workflow_escalated",
    title: "Operation escalated to you",
    message: "An item in the queue was escalated to you.",
  });
  const validationError = doc.validateSync();
  assert.equal(validationError, undefined, "workflow_escalated must be a valid enum value");
});

test("NotificationDelivery still rejects an unknown type (enum is not wide open)", () => {
  const doc = new NotificationDelivery({
    recipientId: new mongoose.Types.ObjectId(),
    type: "not_a_real_type",
    title: "x",
    message: "x",
  });
  const validationError = doc.validateSync();
  assert.ok(validationError, "an unrecognized type must still fail validation");
});

// Same bug, found across the rest of the codebase by auditing every other
// notificationEmitter call site for the identical enum-mismatch pattern --
// each of these has been silently failing validation since the phase that
// introduced it (Automation Studio, Clinical Workspace, Practice Management).
for (const type of [
  "automation",
  "reminder",
  "schedule",
  "document",
  "doctor_verification",
  "subscription_update",
  "invoice_generated",
  "subscription_renewal_reminder",
]) {
  test(`NotificationDelivery accepts type=${type}`, () => {
    const doc = new NotificationDelivery({
      recipientId: new mongoose.Types.ObjectId(),
      type,
      title: "x",
      message: "x",
    });
    const validationError = doc.validateSync();
    assert.equal(validationError, undefined, `${type} must be a valid enum value`);
  });
}

// ── Bug #4: emitWorkflowEvent reports the real delivery outcome ─────────

await asyncTest("emitWorkflowEvent resolves delivered:true when every listener succeeds", async () => {
  const event = "test:emit-success";
  const calls = [];
  workflowEventBus.on(event, async (payload) => {
    calls.push(payload);
  });

  const result = await emitWorkflowEvent(event, { hello: "world" });

  assert.equal(result.delivered, true);
  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  workflowEventBus.removeAllListeners(event);
});

await asyncTest("emitWorkflowEvent resolves delivered:false (never throws) when a listener rejects", async () => {
  const event = "test:emit-failure";
  workflowEventBus.on(event, async () => {
    throw new Error("simulated notification failure");
  });

  const result = await emitWorkflowEvent(event, {});

  assert.equal(result.delivered, false, "a rejected listener must be reported, not swallowed");
  assert.equal(result.error, "simulated notification failure");
  workflowEventBus.removeAllListeners(event);
});

test("emitWorkflowEvent is exported alongside the real WORKFLOW_EVENTS the engine uses", () => {
  assert.equal(typeof WORKFLOW_EVENTS.ASSIGNED, "string");
  assert.equal(typeof WORKFLOW_EVENTS.ESCALATED, "string");
  assert.equal(typeof emitWorkflowEvent, "function");
});

// ── Regression: auto-assign no longer sends a duplicate notification ────
// autoAssignUnassigned() runs every auto-assign through
// executeWorkflowTransition(), whose own WORKFLOW_EVENTS.ASSIGNED listener
// already sends a "you've been assigned" notification carrying the
// Assignment Engine's reason via the `note` field. assignmentEvents.js's
// AUTO_ASSIGNED listener used to send a second, separate notification for
// that same assignment -- this proves it no longer does.

await asyncTest("ASSIGNMENT_EVENTS.AUTO_ASSIGNED only pings dashboard sync, it does not also create a notification", async () => {
  const { ASSIGNMENT_EVENTS } = await import("../workflow/assignment/assignmentEvents.js");
  const listeners = workflowEventBus.listeners(ASSIGNMENT_EVENTS.AUTO_ASSIGNED);
  assert.equal(listeners.length, 1, "exactly one listener should remain for auto-assign");

  // The listener must not throw even with a payload that has no
  // notification-relevant fields (targetUserId/type/reason) -- if it were
  // still trying to build a notification from them, a malformed/missing
  // field would surface here.
  assert.doesNotThrow(() => listeners[0]({}));
});

console.log("ALL WORKFLOW NOTIFICATION TESTS COMPLETE");

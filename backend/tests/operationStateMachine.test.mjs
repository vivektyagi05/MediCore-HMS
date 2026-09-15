// Phase UI-11, Part C — State Machine Visualization.
// Verifies getBlockedTransitions() derives its blocked-action list purely
// from workflowStateMachine.js's own real transition graph — same style as
// operationsQueuePagination.test.mjs: import the real module, no database,
// no mocks.

import assert from "node:assert/strict";
import { WORKFLOW_STATUS, WORKFLOW_ACTIONS, listAllowedActions, getBlockedTransitions } from "../workflow/workflowStateMachine.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("resolved status blocks claim/assign/escalate/resolve/cancel, only release stays allowed", () => {
  const blocked = getBlockedTransitions(WORKFLOW_STATUS.RESOLVED);
  const blockedActions = blocked.map((b) => b.action).sort();
  assert.deepStrictEqual(
    blockedActions,
    [WORKFLOW_ACTIONS.CLAIM, WORKFLOW_ACTIONS.ASSIGN, WORKFLOW_ACTIONS.ESCALATE, WORKFLOW_ACTIONS.CANCEL, WORKFLOW_ACTIONS.RESOLVE].sort(),
  );
  assert.ok(blocked.every((b) => typeof b.reason === "string" && b.reason.length > 0));
});

test("blocked + allowed never overlap and never include PIN", () => {
  for (const status of Object.values(WORKFLOW_STATUS)) {
    const allowed = new Set(listAllowedActions(status));
    const blocked = getBlockedTransitions(status).map((b) => b.action);
    for (const action of blocked) {
      assert.ok(!allowed.has(action), `${action} should not be both allowed and blocked for ${status}`);
      assert.notStrictEqual(action, WORKFLOW_ACTIONS.PIN, "pin is orthogonal and must never appear as blocked");
    }
  }
});

test("open status only blocks release (nothing to release from an unclaimed item)", () => {
  const blocked = getBlockedTransitions(WORKFLOW_STATUS.OPEN);
  assert.deepStrictEqual(blocked.map((b) => b.action), [WORKFLOW_ACTIONS.RELEASE]);
});

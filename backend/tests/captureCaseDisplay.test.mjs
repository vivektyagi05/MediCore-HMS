// Pure UI logic of the capture-case workspace (src/utils/captureCaseDisplay.js). LOCALLY_VERIFIED.
import assert from "node:assert/strict";
import * as D from "../../src/utils/captureCaseDisplay.js";
let n = 0; const t = (name, fn) => { fn(); console.log(`  ok   ${name}`); n += 1; };

t("classification distinguishes duplicate, missing evidence, refund-required and no-action", () => {
  assert.equal(D.classifyCase({ resolutionState: "open", disposition: "duplicate_capture" }), D.CASE_KIND.DUPLICATE);
  assert.equal(D.classifyCase({ resolutionState: "insufficient_evidence", disposition: "duplicate_capture" }), D.CASE_KIND.MISSING);
  assert.equal(D.classifyCase({ resolutionState: "refund_required" }), D.CASE_KIND.REFUND_REQUIRED);
  assert.equal(D.classifyCase({ resolutionState: "verified_no_action" }), D.CASE_KIND.NO_ACTION);
  assert.equal(D.classifyCase({ resolutionState: "open", disposition: "capture_on_cancelled" }), D.CASE_KIND.OPEN);
});
t("a refund-required label/message never claims a refund happened", () => {
  const label = D.caseKindLabel({ resolutionState: "refund_required" });
  assert.match(label, /decision recorded/i); assert.doesNotMatch(label, /refunded|refund issued|refund completed/i);
  assert.match(D.successMessage("refund_required"), /No refund has been issued/);
  for (const a of ["refund_required", "verified_no_action", "insufficient_evidence"]) assert.doesNotMatch(D.successMessage(a), /refunded\b/i);
});
t("reason validation mirrors the server bounds (10-500)", () => {
  assert.ok(D.validateReason("")); assert.ok(D.validateReason("too short")); assert.equal(D.validateReason("long enough reason"), ""); assert.ok(D.validateReason("x".repeat(501)));
});
t("only unresolved cases offer actions; terminal states offer none", () => {
  assert.equal(D.availableActions({ resolutionState: "refund_required" }).length, 0);
  assert.equal(D.availableActions({ resolutionState: "verified_no_action" }).length, 0);
  assert.equal(D.availableActions({ resolutionState: "open" }).length, 3);
  assert.deepEqual(D.availableActions({ resolutionState: "insufficient_evidence" }).map((a) => a.value), ["refund_required", "verified_no_action"]);
});
t("error interpretation: stale/not-found refetch; conflict/evidence do not; unknown is a plain error", () => {
  const e = (code, message = "m") => ({ response: { data: { message, details: { code } } } });
  assert.deepEqual([D.interpretResolutionError(e("RESOLUTION_STATE_STALE")).kind, D.interpretResolutionError(e("RESOLUTION_STATE_STALE")).refetch], ["stale", true]);
  assert.equal(D.interpretResolutionError(e("EVIDENCE_NOT_FOUND")).refetch, true);
  assert.equal(D.interpretResolutionError(e("EVIDENCE_CONTRADICTS_ACTION")).kind, "conflict");
  assert.equal(D.interpretResolutionError(e("EVIDENCE_UNVERIFIABLE")).kind, "evidence");
  assert.equal(D.interpretResolutionError(e("RESOLUTION_FORBIDDEN")).kind, "forbidden");
  assert.equal(D.interpretResolutionError({ message: "boom" }).kind, "error");
});
t("money formatting is paise-based and never fabricates a missing amount", () => {
  assert.match(D.formatPaise(59000), /590\.00/); assert.equal(D.formatPaise(undefined), "Not recorded"); assert.equal(D.formatPaise(null), "Not recorded");
});
console.log(`captureCaseDisplay: ${n} checks passed`);

// P23 Bug 1 — refund request 400 fix. Pure-logic tests against
// refundPolicyEngine.deriveCanonicalReason, matching this codebase's
// established dependency-free test convention.
import assert from "assert";
import { deriveCanonicalReason, REFUND_REASON_CATEGORIES } from "../payments/refundPolicyEngine.js";

// --- The exact reported failure: client sends {amount, reasonCode,
// description} for a cancellation-style refund with NO raw `reason`
// field. The canonical reason must be derivable from reasonCode alone. ---
{
  const reason = deriveCanonicalReason({ reasonCode: REFUND_REASON_CATEGORIES.PATIENT_CANCELLATION, description: "" });
  assert.ok(reason && reason.length > 0, "a canonical reason must be derivable with no client-supplied description");
  assert.match(reason, /cancellation/i);
  console.log("PASS: canonical reason derivable from reasonCode alone (Bug 1 reproduction case)");
}

// --- Report-problem entry point: description is present and should be
// folded into the canonical reason for context, not discarded. ---
{
  const reason = deriveCanonicalReason({ reasonCode: REFUND_REASON_CATEGORIES.TECHNICAL_FAILURE, description: "Call dropped after 2 minutes" });
  assert.match(reason, /technical failure/i);
  assert.match(reason, /call dropped/i);
  console.log("PASS: canonical reason includes the reviewer-supplied description when present");
}

// --- Client can never control the canonical financial meaning: an
// unrecognized/garbage reasonCode must not produce garbage output, and a
// description alone must never substitute for a validated category. ---
{
  const reason = deriveCanonicalReason({ reasonCode: "not_a_real_category", description: "whatever" });
  assert.strictEqual(typeof reason, "string");
  assert.ok(reason.length > 0, "must fall back to a safe default label, never throw or return empty");
  console.log("PASS: unrecognized reasonCode falls back safely instead of trusting client-controlled text");
}

// --- Every real category produces a distinct, non-empty label. ---
{
  const labels = new Set();
  for (const code of Object.values(REFUND_REASON_CATEGORIES)) {
    const reason = deriveCanonicalReason({ reasonCode: code, description: "" });
    assert.ok(reason.length > 0);
    labels.add(reason);
  }
  assert.strictEqual(labels.size, Object.values(REFUND_REASON_CATEGORIES).length, "every category must have its own distinct label");
  console.log("PASS: every refund reason category has a distinct canonical label");
}

console.log("All refundReasonCanonicalization tests passed.");

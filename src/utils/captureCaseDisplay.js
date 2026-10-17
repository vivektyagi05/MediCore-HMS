// Pure display logic for the capture-case workspace (kept framework-free so it is unit-tested in Node).
// IMPORTANT wording rule: choosing "refund required" only RECORDS a decision. Nothing here (or on the
// server) refunds, credits or moves money, and the UI must never say a refund happened.

export const CASE_KIND = Object.freeze({
  DUPLICATE: "duplicate_capture",
  VERIFIED: "verified_capture",
  MISSING: "missing_evidence",
  REFUND_REQUIRED: "refund_required",
  NO_ACTION: "no_action_needed",
  OPEN: "needs_review",
});

/** Classify a case into the operator-facing kinds. */
export const classifyCase = (c) => {
  if (!c) return CASE_KIND.OPEN;
  if (c.resolutionState === "refund_required") return CASE_KIND.REFUND_REQUIRED;
  if (c.resolutionState === "verified_no_action") return CASE_KIND.NO_ACTION;
  if (c.resolutionState === "insufficient_evidence") return CASE_KIND.MISSING;
  if (c.disposition === "duplicate_capture") return CASE_KIND.DUPLICATE;
  return CASE_KIND.OPEN;
};

const LABELS = {
  [CASE_KIND.DUPLICATE]: ["Duplicate capture", "danger"],
  [CASE_KIND.VERIFIED]: ["Verified capture", "info"],
  [CASE_KIND.MISSING]: ["Evidence missing", "warning"],
  [CASE_KIND.REFUND_REQUIRED]: ["Refund required (decision recorded)", "warning"],
  [CASE_KIND.NO_ACTION]: ["Verified — no action needed", "success"],
  [CASE_KIND.OPEN]: ["Needs review", "warning"],
};
export const caseKindLabel = (c) => LABELS[classifyCase(c)][0];
export const caseKindTone = (c) => LABELS[classifyCase(c)][1];

export const DISPOSITION_LABELS = Object.freeze({
  duplicate_capture: "Second provider payment for an already-paid order",
  capture_on_cancelled: "Capture arrived after the payment was cancelled",
  capture_on_expired: "Capture arrived after the payment expired",
  capture_rejected_state: "Capture arrived in a state that cannot accept it",
  amount_currency_mismatch: "Captured amount/currency differs from the expected value",
  attempt_allocation_mismatch: "Capture does not match the attempt's allocation",
  invalid_event_fields: "Provider event was missing required fields",
});
export const dispositionLabel = (d) => DISPOSITION_LABELS[d] || "Unclassified capture evidence";

export const formatPaise = (paise, currency = "INR") => {
  if (paise === null || paise === undefined || paise === "" || !Number.isFinite(Number(paise))) return "Not recorded";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", minimumFractionDigits: 2 }).format(Number(paise) / 100);
};

export const isResolvable = (c) => ["open", "insufficient_evidence"].includes(c?.resolutionState);

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const validateReason = (value) => {
  const text = String(value || "").trim();
  if (text.length < REASON_MIN) return `Enter a reason of at least ${REASON_MIN} characters.`;
  if (text.length > REASON_MAX) return `Keep the reason under ${REASON_MAX} characters.`;
  return "";
};

/** Which actions the operator may choose for a case (insufficient_evidence may later be upgraded). */
export const availableActions = (c) => {
  if (!isResolvable(c)) return [];
  const actions = [
    { value: "refund_required", label: "Record: refund required", help: "Verifies the provider still holds an unrefunded capture and records the decision. It does NOT refund anything — use the refund request flow afterwards." },
    { value: "verified_no_action", label: "Record: verified, no action needed", help: "Only allowed when the provider shows this payment is not captured or is fully refunded." },
  ];
  if (c.resolutionState === "open") actions.push({ value: "insufficient_evidence", label: "Record: evidence insufficient", help: "Leaves the case open for later review and stores your reason." });
  return actions;
};

/** Translate a failed resolution call into a UI outcome. `stale` => refetch and show authoritative state. */
export const interpretResolutionError = (error) => {
  const code = error?.response?.data?.details?.code || error?.details?.code;
  const message = error?.response?.data?.message || error?.message || "The resolution could not be recorded.";
  switch (code) {
    case "RESOLUTION_STATE_STALE": return { kind: "stale", refetch: true, message: "Another admin changed this case while you were reviewing it. The latest state has been loaded." };
    case "EVIDENCE_CONTRADICTS_ACTION": return { kind: "conflict", refetch: false, message };
    case "EVIDENCE_MISMATCH":
    case "EVIDENCE_UNVERIFIABLE": return { kind: "evidence", refetch: false, message };
    case "RESOLUTION_FORBIDDEN": return { kind: "forbidden", refetch: false, message: "Only a super admin can resolve capture cases." };
    case "REASON_REQUIRED": return { kind: "validation", refetch: false, message };
    case "EVIDENCE_NOT_FOUND": return { kind: "stale", refetch: true, message: "This evidence no longer exists. The list has been refreshed." };
    default: return { kind: "error", refetch: false, message };
  }
};

export const successMessage = (action) => (action === "refund_required"
  ? "Decision recorded: refund required. No refund has been issued — create it through the refund request flow."
  : action === "verified_no_action" ? "Recorded as verified, no action needed." : "Recorded as insufficient evidence; the case stays open.");

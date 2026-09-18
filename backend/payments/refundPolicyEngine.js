// P23 — Canonical Refund Policy Engine.
//
// AUDIT FINDING: no such engine existed anywhere in the codebase. Refund
// eligibility was implicitly "any captured payment, any amount up to the
// remaining balance, regardless of appointment state" — enforced only in
// refundController.js's createRefundRequest/initiateRefund, and NOT shared
// with any other caller. This is the single authoritative service the
// brief requires (Section 4): eligibility, reason-category validation, and
// wallet/gateway funding allocation all live here so no controller,
// frontend, or admin path can duplicate — and drift from — this logic.
//
// FINANCIAL CAPACITY (how much money COULD be pulled back) and BUSINESS
// REFUND ELIGIBILITY (whether the patient may ask for it right now) are
// deliberately kept as two separate computations (Section 3).

import { subtractMoney, addMoney } from "./money.js";
import {
  APPOINTMENT_STATUS,
} from "../constants/appointmentStatus.js";

// Appointment states past which a normal "Refund now" action is no longer
// offered to the patient — a completed consultation was actually delivered,
// so any grievance must go through the Report-a-Problem review workflow
// instead of an instant/automatic refund (Section 5, Scenario 3).
export const POST_CONSULTATION_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.CONSULTATION_COMPLETED,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.REVIEW_ELIGIBLE,
]);

// Canonical reason categories. A reason being non-empty free text is never
// sufficient on its own (Section 6) — the patient/admin must select one of
// these, and only OTHER accepts a free-text description (still validated
// against the meaningless-input list below).
export const REFUND_REASON_CATEGORIES = Object.freeze({
  PATIENT_CANCELLATION: "patient_cancellation",
  DOCTOR_CANCELLED: "doctor_cancelled",
  DOCTOR_NO_SHOW: "doctor_no_show",
  CONSULTATION_NOT_COMPLETED: "consultation_not_completed",
  WRONG_SERVICE: "wrong_service",
  DUPLICATE_CHARGE: "duplicate_charge",
  PAYMENT_ISSUE: "payment_issue",
  TECHNICAL_FAILURE: "technical_failure",
  OTHER: "other",
});

const REASON_CATEGORY_VALUES = Object.values(REFUND_REASON_CATEGORIES);

// Which categories are legal on which entry point (Section 7 — one generic
// endpoint must not accept every scenario without knowing actor+reason).
const CANCELLATION_ENTRY_CATEGORIES = new Set([
  REFUND_REASON_CATEGORIES.PATIENT_CANCELLATION,
  REFUND_REASON_CATEGORIES.DOCTOR_CANCELLED,
]);

const PROBLEM_REPORT_ENTRY_CATEGORIES = new Set([
  REFUND_REASON_CATEGORIES.DOCTOR_NO_SHOW,
  REFUND_REASON_CATEGORIES.CONSULTATION_NOT_COMPLETED,
  REFUND_REASON_CATEGORIES.WRONG_SERVICE,
  REFUND_REASON_CATEGORIES.DUPLICATE_CHARGE,
  REFUND_REASON_CATEGORIES.PAYMENT_ISSUE,
  REFUND_REASON_CATEGORIES.TECHNICAL_FAILURE,
  REFUND_REASON_CATEGORIES.OTHER,
]);

// Conservative, pattern-level rejection of obviously-meaningless free text —
// NOT a keyword-based business/medical decision (Section 6 explicitly bans
// that). This only filters description text that carries zero information,
// it never approves or denies a claim.
const MEANINGLESS_DESCRIPTIONS = new Set([
  "test", "testing", "abc", "abcd", "asdf", "refund", "give money",
  "give me money", "money back", "dont want it", "don't want it",
  "n/a", "na", "none", "no reason", "nothing", "xyz", "...", "idk",
]);

export const isMeaninglessDescription = (description) => {
  const normalized = String(description || "").trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (normalized.length < 4) return true;
  return MEANINGLESS_DESCRIPTIONS.has(normalized);
};

export const isValidReasonCategory = (reasonCode) => REASON_CATEGORY_VALUES.includes(reasonCode);

// Human-readable label for each canonical reason category. This is the
// SINGLE source of the stored RefundRequest.reason string — the client
// never controls the canonical financial meaning (Bug 1 fix). The client
// only ever sends a validated reasonCode (+ description for entry points
// that require one); the server derives the human-readable "reason" from
// that code so the legacy `reason` field stays populated without any
// controller re-requiring the client to also send raw free text.
const REFUND_REASON_LABELS = Object.freeze({
  [REFUND_REASON_CATEGORIES.PATIENT_CANCELLATION]: "Patient-initiated cancellation",
  [REFUND_REASON_CATEGORIES.DOCTOR_CANCELLED]: "Doctor cancelled the appointment",
  [REFUND_REASON_CATEGORIES.DOCTOR_NO_SHOW]: "Doctor did not show up for the consultation",
  [REFUND_REASON_CATEGORIES.CONSULTATION_NOT_COMPLETED]: "Consultation was not completed",
  [REFUND_REASON_CATEGORIES.WRONG_SERVICE]: "Wrong service was booked/delivered",
  [REFUND_REASON_CATEGORIES.DUPLICATE_CHARGE]: "Duplicate charge",
  [REFUND_REASON_CATEGORIES.PAYMENT_ISSUE]: "Payment issue reported",
  [REFUND_REASON_CATEGORIES.TECHNICAL_FAILURE]: "Technical failure during consultation/payment",
  [REFUND_REASON_CATEGORIES.OTHER]: "Other (see description)",
});

// Derives the canonical, server-authoritative human-readable reason string
// for a validated (reasonCode, description) pair. Never trusts a raw
// client-supplied `reason` field — the category is always the source of
// truth, with the reviewer-supplied description appended for extra context
// when present (report_problem always has one; cancellation may not).
export const deriveCanonicalReason = ({ reasonCode, description }) => {
  const label = REFUND_REASON_LABELS[reasonCode] || "Refund requested";
  const trimmedDescription = String(description || "").trim();
  if (!trimmedDescription || trimmedDescription.toLowerCase() === label.toLowerCase()) {
    return label;
  }
  return `${label}: ${trimmedDescription}`;
};

// Validates a (reasonCode, description) pair for a given entry point.
// Returns {ok:true} or {ok:false, message}. Never fabricates a category —
// a missing/unknown code is always rejected rather than defaulted.
export const validateRefundReason = ({ reasonCode, description, entryPoint }) => {
  if (!reasonCode || !isValidReasonCategory(reasonCode)) {
    return { ok: false, message: "A valid refund reason category is required." };
  }
  const allowed = entryPoint === "report_problem" ? PROBLEM_REPORT_ENTRY_CATEGORIES : CANCELLATION_ENTRY_CATEGORIES;
  if (!allowed.has(reasonCode)) {
    return { ok: false, message: "The selected reason category is not valid for this action." };
  }
  if (reasonCode === REFUND_REASON_CATEGORIES.OTHER && isMeaninglessDescription(description)) {
    return { ok: false, message: "Please describe the issue with enough detail for review — the description provided is not specific enough." };
  }
  if (entryPoint === "report_problem" && !description?.trim()) {
    return { ok: false, message: "Please describe what went wrong." };
  }
  return { ok: true };
};

// FINANCIAL CAPACITY ONLY — never business eligibility. Server-authoritative,
// never derived from request input (Section 8).
export const computeRefundableAmount = (payment) =>
  Math.max(0, subtractMoney(payment.totalAmount, payment.refundedAmount || 0));

// Canonical eligibility decision. `actorRole` distinguishes the admin path
// (Section 7's ADMIN OPERATION — an authorized override with mandatory
// reason + audit, not bound by the patient-facing completed-appointment
// restriction) from the patient path.
export const evaluateRefundEligibility = ({ payment, appointment, actorRole, requestedAmount }) => {
  const maximumCapacity = computeRefundableAmount(payment);

  if (maximumCapacity <= 0) {
    return {
      eligible: false,
      reasonCode: "NO_REFUNDABLE_BALANCE",
      action: "NONE",
      maximumRefundAmount: 0,
      approvalRequired: true,
    };
  }

  const amount = requestedAmount == null ? maximumCapacity : requestedAmount;
  if (amount > maximumCapacity) {
    return {
      eligible: false,
      reasonCode: "CAPACITY_EXCEEDED",
      action: "NONE",
      maximumRefundAmount: maximumCapacity,
      approvalRequired: true,
    };
  }

  // PHASE 2-D: "admin" is no longer a valid role (see constants/roles.js) —
  // the admin-initiated override path now checks super_admin only.
  const isAdminActor = actorRole === "super_admin";
  const isPostConsultation = POST_CONSULTATION_STATUSES.includes(appointment?.status);

  if (isPostConsultation && !isAdminActor) {
    // The MOST IMPORTANT RULE + Section 5 + Scenario 3: a completed
    // consultation was actually delivered. No direct/instant refund action
    // is exposed to the patient — only a reviewed problem report.
    return {
      eligible: false,
      reasonCode: "COMPLETED_APPOINTMENT",
      action: "REPORT_PROBLEM",
      maximumRefundAmount: maximumCapacity,
      approvalRequired: true,
    };
  }

  return {
    eligible: true,
    reasonCode: isPostConsultation ? "ADMIN_OVERRIDE_POST_CONSULTATION" : "STANDARD",
    action: "REFUND_REQUEST",
    maximumRefundAmount: maximumCapacity,
    // Every refund in this system still passes through human admin review
    // before a gateway call is made (approve/reject/retry) — "automatic"
    // here only means the patient-facing action itself is not blocked, not
    // that admin review is skipped.
    approvalRequired: !isAdminActor,
  };
};

// FUNDING ALLOCATION (Sections 9/10/27/28). Splits a refund amount across
// the wallet-funded and gateway-funded remaining capacity of the payment,
// so a refund can NEVER (a) send more to the gateway than was ever
// captured there, or (b) credit the wallet for money that was actually
// captured by the gateway. Deterministic, proportional to each bucket's
// remaining (unrefunded) capacity so repeated partial refunds stay
// consistent and invariants always sum exactly.
export const computeFundingAllocation = ({ payment, refundAmount }) => {
  const walletFunded = payment.walletAmount || 0;
  const gatewayFunded = payment.gatewayAmount ?? subtractMoney(payment.totalAmount, walletFunded);

  const walletRemaining = Math.max(0, subtractMoney(walletFunded, payment.walletRefundedAmount || 0));
  const gatewayRemaining = Math.max(0, subtractMoney(gatewayFunded, payment.gatewayRefundedAmount || 0));
  const totalRemaining = addMoney(walletRemaining, gatewayRemaining);

  if (refundAmount > totalRemaining + 0.009) {
    const error = new Error(
      `Refund amount exceeds remaining funding capacity (wallet ${walletRemaining} + gateway ${gatewayRemaining}).`,
    );
    error.statusCode = 400;
    throw error;
  }

  if (totalRemaining <= 0) return { walletRefundAmount: 0, gatewayRefundAmount: 0 };

  let walletShare = Math.min(
    Number(((refundAmount * walletRemaining) / totalRemaining).toFixed(2)),
    walletRemaining,
  );
  let gatewayShare = subtractMoney(refundAmount, walletShare);

  if (gatewayShare > gatewayRemaining) {
    const overflow = subtractMoney(gatewayShare, gatewayRemaining);
    gatewayShare = gatewayRemaining;
    walletShare = Math.min(addMoney(walletShare, overflow), walletRemaining);
  }

  // Rounding correction: guarantee walletShare + gatewayShare === refundAmount
  // exactly (Section 28's "no unexplained money" invariant), never silently
  // off by a paise-rounding remainder.
  const sum = addMoney(walletShare, gatewayShare);
  if (sum !== refundAmount) {
    gatewayShare = Math.min(subtractMoney(refundAmount, walletShare), gatewayRemaining);
    const remainder = subtractMoney(refundAmount, addMoney(walletShare, gatewayShare));
    if (remainder > 0) walletShare = Math.min(addMoney(walletShare, remainder), walletRemaining);
  }

  return { walletRefundAmount: walletShare, gatewayRefundAmount: gatewayShare };
};

export const REFUND_ENTRY_POINTS = Object.freeze({
  CANCELLATION: "cancellation",
  REPORT_PROBLEM: "report_problem",
  ADMIN: "admin",
  SYSTEM: "system",
});

// Phase 01 — the ONE mechanism that changes a Payment's lifecycle state.
//
// Payment carries two related fields, both from the same vocabulary
// (PAYMENT_STATES), kept for backward compatibility with persisted data:
//   status        legacy financial status. Used by revenue reports and the
//                 capture claim. Stays "captured" through post-processing.
//   paymentState  workflow state. Moves through post_processing / completed /
//                 post_processing_failed / reconciliation_required while
//                 `status` may lag (e.g. status "created", paymentState "pending").
// The machine therefore reasons about the EFFECTIVE state
// (paymentState || status) and ALSO refuses to downgrade whenever EITHER field
// says the provider capture is confirmed.
//
// Every transition is a compare-and-set: read the document, validate the move
// against PAYMENT_TRANSITIONS, then update with a filter that pins the exact
// status+paymentState that was validated. If anything changed in between the
// update matches nothing and the loop re-reads, so a concurrent capture can
// never be overwritten by a failure computed from an older read, and the
// history row always records the REAL previous state.
import Payment, { PAYMENT_STATUS } from "../models/Payment.js";
import { PAYMENT_TRANSITIONS } from "./paymentStateMachine.js";

/** States in which no provider capture has been confirmed yet. */
export const PRE_CAPTURE_STATES = Object.freeze([
  "created", "order_created", "checkout_started", "pending", "authorized", "verification_pending",
]);

/** Once either field is one of these, the provider capture is authoritative. */
export const CAPTURE_CONFIRMED_STATES = Object.freeze([
  "captured", "post_processing", "post_processing_failed", "completed", "partially_refunded", "refunded",
]);

/** Targets that release the appointment's single active-payment slot. */
const SLOT_RELEASING_TARGETS = Object.freeze(["cancelled", "expired", "refunded"]);

/** Targets that mean "this payment did not succeed"; forbidden after capture. */
const DOWNGRADE_TARGETS = Object.freeze(["failed", "cancelled", "expired", "pending", "order_created", "checkout_started", "created", "authorized", "verification_pending"]);

export const effectiveState = (doc) => doc?.paymentState || doc?.status || null;

export const isCaptureConfirmed = (doc) =>
  CAPTURE_CONFIRMED_STATES.includes(doc?.status) || CAPTURE_CONFIRMED_STATES.includes(doc?.paymentState);

export const isLegalTransition = (from, to) => from === to || (PAYMENT_TRANSITIONS[from] || []).includes(to);

const buildFilter = (doc, extra) => {
  const pin = { _id: doc._id, status: doc.status, paymentState: doc.paymentState ?? null };
  return extra && Object.keys(extra).length ? { $and: [pin, extra] } : pin;
};

/**
 * Compare-and-set transition.
 * @param {object} o
 * @param {*}      o.paymentId
 * @param {string} o.to            target workflow state
 * @param {string} [o.status]      legacy status to write alongside (omit to leave unchanged)
 * @param {string[]} [o.from]      effective states this caller is allowed to move FROM
 * @param {object} [o.filter]      extra guard merged into the CAS filter (e.g. gatewayOrderId)
 * @param {Function} [o.guard]     JS predicate over the freshly read doc (same rule as `filter`, evaluated per loop)
 * @param {object} [o.set]         extra $set fields written atomically with the state
 * @param {object} [o.unset]       extra $unset fields
 * @param {object} [o.inc]         extra $inc fields
 * @returns {Promise<{outcome:'applied'|'noop'|'rejected'|'not_found'|'conflict', payment, previous?, reason?}>}
 */
export const transitionPayment = async ({
  paymentId, to, status, from, filter, guard = null, set = {}, unset = {}, inc = null, source = "system", reason = null, actorId = null,
  model = Payment, maxAttempts = 5, select = null,
}) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let query = model.findById(paymentId);
    if (select) query = query.select(select);
    const doc = await query.lean();
    if (!doc) return { outcome: "not_found", payment: null };
    const previous = effectiveState(doc);

    if (previous === to && (status === undefined || doc.status === status)) {
      return { outcome: "noop", payment: doc, previous };
    }
    if (DOWNGRADE_TARGETS.includes(to) && isCaptureConfirmed(doc)) {
      return { outcome: "rejected", reason: "capture_protected", payment: doc, previous };
    }
    if (guard && !guard(doc)) {
      return { outcome: "rejected", reason: "guard_failed", payment: doc, previous };
    }
    if (from && !from.includes(previous)) {
      return { outcome: "rejected", reason: "state_not_allowed", payment: doc, previous };
    }
    if (!isLegalTransition(previous, to)) {
      return { outcome: "rejected", reason: "illegal_transition", payment: doc, previous };
    }

    const $set = { paymentState: to, ...(status ? { status } : {}), ...set };
    const $unset = { ...unset };
    if (SLOT_RELEASING_TARGETS.includes(to)) $unset.activeAppointmentSlot = "";
    const update = { $set, $push: { stateHistory: { from: previous, to, actorId, source, reason, at: new Date() } } };
    if (Object.keys($unset).length) update.$unset = $unset;
    if (inc) update.$inc = inc;

    const updated = await model.findOneAndUpdate(buildFilter(doc, filter), update, { returnDocument: "after" });
    if (updated) return { outcome: "applied", payment: updated, previous };
    // Lost a race (or the extra filter no longer holds): re-read and decide again.
  }
  return { outcome: "conflict", payment: null };
};

/**
 * Appends capture/anomaly evidence exactly once per provider payment id +
 * disposition, optionally flagging the payment for reconciliation. Never
 * changes status/paymentState, so it is safe on an already captured payment.
 */
export const recordCaptureEvidence = async ({ paymentId, evidence, flagReconciliation = false, model = Payment }) => {
  const entry = { ...evidence, at: new Date() };
  const filter = {
    _id: paymentId,
    captureEvidence: { $not: { $elemMatch: { gatewayPaymentId: entry.gatewayPaymentId || null, disposition: entry.disposition } } },
  };
  const update = { $push: { captureEvidence: entry } };
  if (flagReconciliation) update.$set = { reconciliationState: "required" };
  const written = await model.findOneAndUpdate(filter, update, { returnDocument: "after" }).select("_id");
  if (!written && flagReconciliation) {
    // Evidence already recorded earlier; still make sure the flag is set.
    await model.updateOne({ _id: paymentId }, { $set: { reconciliationState: "required" } });
  }
  return { recorded: Boolean(written) };
};

/** Post-processing progress transitions (all CAS; never downgrade a capture). */
export const markPostProcessingStarted = (payment, opts = {}) => transitionPayment({
  paymentId: payment._id, to: "post_processing",
  from: ["captured", "post_processing", "post_processing_failed", "reconciliation_required"],
  set: { postProcessingState: "pending" }, source: "system", reason: "Post-capture financial processing started", ...opts,
});

export const markPostProcessingFailed = (paymentId, reasonText, opts = {}) => transitionPayment({
  paymentId, to: "post_processing_failed", from: ["captured", "post_processing", "post_processing_failed"],
  set: { postProcessingState: "failed", reconciliationState: "required" }, source: "system",
  reason: String(reasonText || "Post-processing failed").slice(0, 300), ...opts,
});

export const markPostProcessingCompleted = (paymentId, opts = {}) => transitionPayment({
  paymentId, to: "completed", from: ["post_processing"],
  set: { postProcessingState: "complete", reconciliationState: "matched" }, source: "system",
  reason: "Financial post-processing completed", ...opts,
});

export { PAYMENT_STATUS };

// Phase 02 -- audited SUPER_ADMIN resolution of capture evidence that Phase 01
// recorded (duplicate capture, capture on a cancelled/expired payment, ...).
//
// Resolution states (per evidence entry; absent == "open"):
//   open -> insufficient_evidence | verified_no_action | refund_required
//   insufficient_evidence -> verified_no_action | refund_required
//   verified_no_action / refund_required are terminal.
// Every transition is a compare-and-set on the entry's current state, so the
// same evidence cannot be resolved twice. Resolving NEVER moves money: it does
// not refund, credit a wallet, pay out, or touch the ledger. `refund_required`
// only records the decision; the refund itself goes through the existing
// authorized refund-request path (hardened in Phase 03).
import Payment from "../models/Payment.js";
import { paymentGateway } from "./paymentGateway.js";
import { AppError } from "../middleware/errorMiddleware.js";

export const RESOLUTION_ACTIONS = Object.freeze(["verified_no_action", "refund_required", "insufficient_evidence"]);
const FROM = { verified_no_action: ["open", "insufficient_evidence"], refund_required: ["open", "insufficient_evidence"], insufficient_evidence: ["open"] };
export const ACTIONABLE_DISPOSITIONS = Object.freeze(["duplicate_capture", "capture_on_cancelled", "capture_on_expired", "capture_rejected_state", "amount_currency_mismatch", "attempt_allocation_mismatch", "invalid_event_fields"]);
const stateOf = (e) => e?.resolution?.state || "open";

/** Safe projection: no raw webhook payload, no signatures, no patient data. */
const toCase = (payment, e) => ({
  paymentId: String(payment._id), appointmentId: payment.appointmentId ? String(payment.appointmentId) : null,
  attemptNumber: e.attemptNumber ?? null, gatewayOrderId: e.gatewayOrderId || null, gatewayPaymentId: e.gatewayPaymentId,
  amountPaise: e.amountPaise ?? null, currency: e.currency || null, disposition: e.disposition, eventAt: e.at,
  resolutionState: stateOf(e), resolutionReason: e.resolution?.reason || null, resolvedAt: e.resolution?.at || null, providerStatus: e.resolution?.providerStatus || null,
  paymentState: payment.paymentState, reconciliationState: payment.reconciliationState || null, paymentTotalPaise: Number.isFinite(Number(payment.totalAmount)) ? Math.round(Number(payment.totalAmount) * 100) : null,
});

export const listCaptureCases = async ({ state = "unresolved", limit = 50 } = {}) => {
  const payments = await Payment.find({ "captureEvidence.0": { $exists: true } }).select("+captureEvidence appointmentId paymentState reconciliationState totalAmount").sort({ updatedAt: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200)).lean();
  const GROUPS = { unresolved: ["open", "insufficient_evidence"], resolved: ["verified_no_action", "refund_required"] };
  if (state !== "all" && !GROUPS[state] && !["open", "insufficient_evidence", "verified_no_action", "refund_required"].includes(state)) throw new AppError("Unsupported state filter", 400, { code: "RESOLUTION_INVALID" });
  const wanted = state === "all" ? null : GROUPS[state] || [state];
  return payments.flatMap((p) => (p.captureEvidence || []).filter((e) => ACTIONABLE_DISPOSITIONS.includes(e.disposition) && (!wanted || wanted.includes(stateOf(e)))).map((e) => toCase(p, e)));
};

const verifyWithProvider = async ({ evidence, fetchPayment }) => {
  let entity;
  try { entity = await fetchPayment({ paymentId: evidence.gatewayPaymentId, orderId: evidence.gatewayOrderId, amount: evidence.amountPaise != null ? evidence.amountPaise / 100 : undefined, currency: evidence.currency }); }
  catch { throw new AppError("Provider evidence could not be verified right now; the case stays unresolved", 502, { code: "EVIDENCE_UNVERIFIABLE" }); }
  if (!entity || (entity.id && entity.id !== evidence.gatewayPaymentId)) throw new AppError("Provider payment does not match the recorded evidence", 409, { code: "EVIDENCE_MISMATCH" });
  if (evidence.gatewayOrderId && entity.order_id && entity.order_id !== evidence.gatewayOrderId) throw new AppError("Provider payment belongs to a different order", 409, { code: "EVIDENCE_MISMATCH" });
  const status = String(entity.status || "").toLowerCase();
  const refundedPaise = Number(entity.amount_refunded || 0);
  const amount = Number(entity.amount);
  const fullyRefunded = status === "refunded" || (Number.isInteger(amount) && amount > 0 && refundedPaise >= amount);
  return { status, fullyRefunded, captured: ["captured", "refunded"].includes(status) || entity.captured === true };
};

export const resolveCaptureEvidence = async ({ actor, paymentId, gatewayPaymentId, disposition, action, reason, fetchPayment = (a) => paymentGateway.fetchPayment(a), audit }) => {
  if (!actor || actor.role !== "super_admin") throw new AppError("Only a super admin can resolve capture evidence", 403, { code: "RESOLUTION_FORBIDDEN" });
  const text = String(reason || "").trim();
  if (text.length < 10 || text.length > 500) throw new AppError("A reason of 10-500 characters is required", 400, { code: "REASON_REQUIRED" });
  if (!RESOLUTION_ACTIONS.includes(action)) throw new AppError("Unsupported resolution action", 400, { code: "RESOLUTION_INVALID" });
  if (!paymentId || !gatewayPaymentId || !ACTIONABLE_DISPOSITIONS.includes(disposition)) throw new AppError("The evidence to resolve must be identified precisely", 400, { code: "RESOLUTION_INVALID" });

  const payment = await Payment.findById(paymentId).select("+captureEvidence paymentState reconciliationState").lean();
  const evidence = (payment?.captureEvidence || []).find((e) => e.gatewayPaymentId === gatewayPaymentId && e.disposition === disposition);
  if (!evidence) throw new AppError("Capture evidence not found", 404, { code: "EVIDENCE_NOT_FOUND" });
  const current = stateOf(evidence);
  if (!FROM[action].includes(current)) throw new AppError(`Evidence is already ${current}`, 409, { code: "RESOLUTION_STATE_STALE" });

  let providerStatus = null;
  if (action !== "insufficient_evidence") {
    const verified = await verifyWithProvider({ evidence, fetchPayment });
    providerStatus = verified.status;
    if (action === "verified_no_action" && verified.captured && !verified.fullyRefunded) throw new AppError("The provider still shows this payment as captured and not refunded; it cannot be marked harmless", 409, { code: "EVIDENCE_CONTRADICTS_ACTION" });
    if (action === "refund_required" && (!verified.captured || verified.fullyRefunded)) throw new AppError("The provider does not show an unrefunded capture; no refund is required", 409, { code: "EVIDENCE_CONTRADICTS_ACTION" });
  }

  const at = new Date();
  const cas = await Payment.findOneAndUpdate(
    { _id: paymentId, captureEvidence: { $elemMatch: { gatewayPaymentId, disposition, $or: [{ "resolution.state": { $exists: false } }, { "resolution.state": { $in: FROM[action] } }] } } },
    { $set: { "captureEvidence.$.resolution": { state: action, reason: text, actorId: actor._id, providerStatus, at } } },
    { returnDocument: "after" },
  );
  if (!cas) throw new AppError("The evidence changed while resolving; reload and try again", 409, { code: "RESOLUTION_STATE_STALE" });

  // Clear the payment-level flag only when nothing actionable remains unresolved.
  const after = await Payment.findById(paymentId).select("+captureEvidence reconciliationState totalAmount").lean();
  const stillOpen = (after.captureEvidence || []).some((e) => ACTIONABLE_DISPOSITIONS.includes(e.disposition) && ["open", "insufficient_evidence"].includes(stateOf(e)));
  if (!stillOpen && after.reconciliationState === "required" && action !== "refund_required") {
    await Payment.updateOne({ _id: paymentId, reconciliationState: "required" }, { $set: { reconciliationState: "resolved" } });
  }
  if (audit) await audit({ action: "payment.capture_evidence_resolved", resourceType: "payment", resourceId: String(paymentId), severity: action === "refund_required" ? "warning" : "info", metadata: { gatewayPaymentId, disposition, from: current, to: action, reason: text, providerStatus } });
  return { case: toCase({ ...after, _id: paymentId }, { ...evidence, resolution: { state: action, reason: text } }), nextStep: action === "refund_required" ? "Use the existing refund request flow; nothing was refunded automatically." : null };
};

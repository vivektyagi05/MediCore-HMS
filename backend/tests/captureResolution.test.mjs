// Phase 02 -- audited duplicate-capture resolution. LOCALLY_VERIFIED (in-memory models), provider faked.
import assert from "node:assert/strict";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused"; process.env.JWT_SECRET ||= "x";
mongoose.set("bufferCommands", false);
const { default: Payment } = await import("../models/Payment.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const R = await import("../payments/captureResolution.js");
const mem = installMemoryModels([{ model: Payment }]);
const SA = { role: "super_admin", _id: newId() };
let n = 0, seq = 0;
const check = async (name, fn) => { mem.reset(); await fn(); console.log(`  ok   ${name}`); n += 1; };
const mk = (over = {}) => Payment.create({ appointmentId: newId(), doctorId: newId(), userId: newId(), totalAmount: 500, amount: 500, currency: "INR", status: "completed", paymentState: "completed", razorpayOrderId: `o${++seq}`, reconciliationState: "required",
  captureEvidence: [{ gatewayOrderId: "order_1", gatewayPaymentId: "pay_dup", amountPaise: 50000, currency: "INR", disposition: "duplicate_capture", ...over }] });
const prov = (status, extra = {}) => async () => ({ id: "pay_dup", order_id: "order_1", status, amount: 50000, currency: "INR", ...extra });
const code = async (p) => { try { await p; return null; } catch (e) { return e.details?.code || e.code || e.message; } };
const base = (p) => ({ actor: SA, paymentId: p._id, gatewayPaymentId: "pay_dup", disposition: "duplicate_capture", reason: "Verified against the provider dashboard" });

await check("only a super admin may resolve; missing/short reason and bad action rejected", async () => {
  const p = await mk();
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), actor: { role: "doctor" }, action: "refund_required", fetchPayment: prov("captured") })), "RESOLUTION_FORBIDDEN");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), reason: "", action: "refund_required", fetchPayment: prov("captured") })), "REASON_REQUIRED");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), reason: "short", action: "refund_required", fetchPayment: prov("captured") })), "REASON_REQUIRED");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), action: "mark_paid", fetchPayment: prov("captured") })), "RESOLUTION_INVALID");
});
await check("refund_required: verified against provider, recorded, audited; moves NO money and touches no wallet/ledger", async () => {
  const p = await mk(); const audits = [];
  const out = await R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: prov("captured"), audit: async (a) => audits.push(a) });
  assert.equal(out.case.resolutionState, "refund_required"); assert.match(out.nextStep, /refund request flow/);
  assert.equal(audits.length, 1); assert.equal(audits[0].metadata.to, "refund_required"); assert.equal(audits[0].metadata.reason, base(p).reason);
  const row = await Payment.findById(p._id).select("+captureEvidence").lean();
  assert.equal(row.captureEvidence[0].resolution.actorId.toString(), SA._id.toString());
  assert.equal(row.reconciliationState, "required", "refund still pending: flag stays");
  assert.equal(row.refundStatus ?? "none", row.refundStatus ?? "none");
});
await check("cannot mark harmless while the provider still shows an unrefunded capture; contradicted refund rejected", async () => {
  const p = await mk();
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), action: "verified_no_action", fetchPayment: prov("captured") })), "EVIDENCE_CONTRADICTS_ACTION");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: prov("refunded", { amount_refunded: 50000 }) })), "EVIDENCE_CONTRADICTS_ACTION");
  const out = await R.resolveCaptureEvidence({ ...base(p), action: "verified_no_action", fetchPayment: prov("refunded", { amount_refunded: 50000 }) });
  assert.equal(out.case.resolutionState, "verified_no_action");
  assert.equal((await Payment.findById(p._id).lean()).reconciliationState, "resolved");
});
await check("invalid evidence: provider mismatch, unreachable provider, unknown evidence leave the case unresolved", async () => {
  const p = await mk();
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: async () => ({ id: "pay_other", status: "captured" }) })), "EVIDENCE_MISMATCH");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: async () => ({ id: "pay_dup", order_id: "order_x", status: "captured" }) })), "EVIDENCE_MISMATCH");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: async () => { throw new Error("timeout"); } })), "EVIDENCE_UNVERIFIABLE");
  assert.equal(await code(R.resolveCaptureEvidence({ ...base(p), gatewayPaymentId: "pay_nope", action: "insufficient_evidence" })), "EVIDENCE_NOT_FOUND");
  assert.equal((await R.listCaptureCases()).length, 1);
});
await check("insufficient evidence keeps the case unresolved (and listed) with the reason; it can be resolved later", async () => {
  const p = await mk();
  const out = await R.resolveCaptureEvidence({ ...base(p), action: "insufficient_evidence" });
  assert.equal(out.case.resolutionState, "insufficient_evidence");
  assert.equal((await R.listCaptureCases()).length, 1);
  await R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: prov("captured") });
  assert.equal((await R.listCaptureCases()).length, 0);
});
await check("duplicate and concurrent resolution: the same evidence is resolved once; stale state is rejected", async () => {
  const p = await mk(); let audits = 0;
  const run = () => R.resolveCaptureEvidence({ ...base(p), action: "refund_required", fetchPayment: prov("captured"), audit: async () => { audits += 1; } });
  const results = await Promise.allSettled([run(), run(), run()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(audits, 1);
  assert.equal(await code(run()), "RESOLUTION_STATE_STALE");
});
await check("case listing exposes only safe fields (no raw payload, signature or patient data)", async () => {
  await mk();
  const [c] = await R.listCaptureCases();
  assert.deepEqual(Object.keys(c).sort(), ["amountPaise", "appointmentId", "attemptNumber", "currency", "disposition", "eventAt", "gatewayOrderId", "gatewayPaymentId", "paymentId", "paymentState", "paymentTotalPaise", "providerStatus", "reconciliationState", "resolutionReason", "resolutionState", "resolvedAt"].sort());
});
await check("state filters: resolved groups both terminal states; unknown filter rejected", async () => {
  const a = await mk(); const b = await mk({ gatewayPaymentId: "pay_b" });
  await R.resolveCaptureEvidence({ ...base(a), action: "refund_required", fetchPayment: prov("captured") });
  await R.resolveCaptureEvidence({ ...base(b), gatewayPaymentId: "pay_b", action: "insufficient_evidence" });
  assert.equal((await R.listCaptureCases({ state: "resolved" })).length, 1);
  assert.equal((await R.listCaptureCases({ state: "unresolved" })).length, 1);
  assert.equal((await R.listCaptureCases({ state: "all" })).length, 2);
  assert.equal(await code(R.listCaptureCases({ state: "bogus" })), "RESOLUTION_INVALID");
});
console.log(`captureResolution: ${n} checks passed (LOCALLY_VERIFIED; in-memory models, provider faked)`);
process.exit(0);

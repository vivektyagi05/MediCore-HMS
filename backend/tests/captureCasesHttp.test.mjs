// Phase 02 closure -- HTTP-level authorization + contract tests for the capture-case endpoints.
// Real express router + real protect/requireAdmin/requirePermission middleware + real JWTs; models are the
// in-memory layer and the provider is faked. LOCALLY_VERIFIED only (not real MongoDB, not Razorpay).
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused"; process.env.JWT_SECRET ||= "phase02-http-secret-that-is-long-enough";
mongoose.set("bufferCommands", false);

const { default: User } = await import("../models/User.js");
const { default: Payment } = await import("../models/Payment.js");
const { default: AdminActivityLog } = await import("../models/AdminActivityLog.js");
const { default: Permission } = await import("../models/Permission.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { generateToken } = await import("../utils/generateToken.js");
const { errorMiddleware } = await import("../middleware/errorMiddleware.js");
const { default: paymentAdminRoutes } = await import("../routes/admin/paymentAdminRoutes.js");
const { paymentGateway } = await import("../payments/paymentGateway.js");

const mem = installMemoryModels([{ model: User }, { model: Payment }, { model: AdminActivityLog }, { model: Permission }]);
const app = express();
app.use(express.json());
app.use("/api/admin/payments", paymentAdminRoutes);
app.use(errorMiddleware);

let n = 0;
const check = async (name, fn) => { mem.reset(); await fn(); console.log(`  ok   ${name}`); n += 1; };
const mkUser = (role) => User.create({ name: role, email: `${role}${newId()}@x.test`, role, isActive: true, securityVersion: 0, password: "Password123!" });
const tokenFor = async (role) => { const u = await mkUser(role); return { user: u, token: generateToken(u) }; };
const mkPayment = () => Payment.create({ appointmentId: newId(), doctorId: newId(), userId: newId(), totalAmount: 500, amount: 500, currency: "INR", status: "completed", paymentState: "completed", razorpayOrderId: `o${newId()}`, reconciliationState: "required",
  captureEvidence: [{ gatewayOrderId: "order_1", gatewayPaymentId: "pay_dup", amountPaise: 50000, currency: "INR", disposition: "duplicate_capture" }] });
paymentGateway.fetchPayment = async () => ({ id: "pay_dup", order_id: "order_1", status: "captured", amount: 50000, currency: "INR" });
const body = { gatewayPaymentId: "pay_dup", disposition: "duplicate_capture", action: "refund_required", reason: "Provider dashboard shows the second capture" };

await check("unauthenticated and non-admin roles (patient, doctor) are rejected on list and resolve", async () => {
  const p = await mkPayment();
  assert.equal((await request(app).get("/api/admin/payments/capture-cases")).status, 401);
  for (const role of ["patient", "doctor"]) {
    const { token } = await tokenFor(role);
    assert.equal((await request(app).get("/api/admin/payments/capture-cases").set("Authorization", `Bearer ${token}`)).status, 403, role);
    assert.equal((await request(app).post(`/api/admin/payments/${p._id}/capture-cases/resolve`).set("Authorization", `Bearer ${token}`).send(body)).status, 403, role);
  }
  const row = await Payment.findById(p._id).select("+captureEvidence").lean();
  assert.equal(row.captureEvidence[0].resolution, undefined, "nothing was resolved by an unauthorized caller");
});
await check("super admin lists cases with the safe projection only", async () => {
  await mkPayment();
  const { token } = await tokenFor("super_admin");
  const res = await request(app).get("/api/admin/payments/capture-cases?state=unresolved").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.cases.length, 1);
  const serialized = JSON.stringify(res.body);
  for (const forbidden of ["userId", "patient", "signature", "payload", "email"]) assert.ok(!serialized.includes(forbidden), `leaked ${forbidden}`);
});
await check("resolve: validation (reason), audit row with actor, record-only (no refund/ledger side effect), then 409 on repeat", async () => {
  const p = await mkPayment();
  const { token, user } = await tokenFor("super_admin");
  const post = (b) => request(app).post(`/api/admin/payments/${p._id}/capture-cases/resolve`).set("Authorization", `Bearer ${token}`).send(b);
  assert.equal((await post({ ...body, reason: "" })).status, 400);
  const ok = await post(body);
  assert.equal(ok.status, 200);
  assert.match(ok.body.data.nextStep, /nothing was refunded automatically/);
  const logs = await AdminActivityLog.find({ action: "payment.capture_evidence_resolved" }).lean();
  assert.equal(logs.length, 1); assert.equal(String(logs[0].actorId), String(user._id)); assert.equal(logs[0].metadata.to, "refund_required");
  const row = await Payment.findById(p._id).lean();
  assert.equal(row.refundStatus ?? "none", "none"); assert.equal(row.status, "completed");
  const again = await post(body);
  assert.equal(again.status, 409); assert.equal(again.body.details.code, "RESOLUTION_STATE_STALE");
  assert.equal((await AdminActivityLog.find({}).lean()).length, 1, "failed attempts write no extra audit row");
});
await check("concurrent HTTP resolutions: exactly one succeeds, one audit row", async () => {
  const p = await mkPayment();
  const { token } = await tokenFor("super_admin");
  const results = await Promise.all([1, 2, 3].map(() => request(app).post(`/api/admin/payments/${p._id}/capture-cases/resolve`).set("Authorization", `Bearer ${token}`).send(body)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await AdminActivityLog.find({}).lean()).length, 1);
});
await check("route ordering: /capture-cases is not swallowed by /:id", async () => {
  const { token } = await tokenFor("super_admin");
  const res = await request(app).get("/api/admin/payments/capture-cases").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200); assert.ok(Array.isArray(res.body.data.cases));
});
console.log(`captureCasesHttp: ${n} checks passed (LOCALLY_VERIFIED; real middleware + JWT, in-memory models, provider faked)`);
process.exit(0);

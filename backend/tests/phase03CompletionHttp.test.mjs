// Phase 03 completion -- HTTP-level authorization + ownership tests for the new/extended finance surfaces:
// doctor refund-review requests (doctor routes), admin review queue, reconciliation discrepancies, audited repair,
// outbox requeue. Real express routers + real protect/role/permission middleware + real JWTs; in-memory models.
// LOCALLY_VERIFIED only (not real MongoDB).
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused"; process.env.JWT_SECRET ||= "phase03-http-secret-that-is-long-enough";
mongoose.set("bufferCommands", false);
const imp = async (p) => (await import(p)).default;
const [User, Doctor, Payment, DoctorPayout, RefundReview, AdminActivityLog, Permission, WalletRecharge, Wallet, TransactionLedger, RefundRequest, ReconciliationRecord, EmailDelivery] = await Promise.all(
  ["User", "Doctor", "Payment", "DoctorPayout", "RefundReview", "AdminActivityLog", "Permission", "WalletRecharge", "Wallet", "TransactionLedger", "RefundRequest", "ReconciliationRecord", "EmailDelivery"].map((m) => imp(`../models/${m}.js`)));
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { generateToken } = await import("../utils/generateToken.js");
const { errorMiddleware } = await import("../middleware/errorMiddleware.js");
const { default: doctorRoutes } = await import("../routes/doctorRoutes.js");
const { default: refundAdminRoutes } = await import("../routes/admin/refundAdminRoutes.js");
const { default: financeAdminRoutes } = await import("../routes/admin/financeAdminRoutes.js");
const { rechargeRef } = await import("../payments/walletRechargeService.js");

const mem = installMemoryModels([
  { model: User }, { model: Doctor }, { model: Payment }, { model: DoctorPayout }, { model: AdminActivityLog }, { model: Permission },
  { model: RefundReview, unique: [{ fields: ["doctorId", "paymentId"], when: (o) => ["open", "acknowledged"].includes(o.status) }] },
  { model: WalletRecharge }, { model: Wallet, unique: [{ fields: ["userId"] }] }, { model: RefundRequest }, { model: ReconciliationRecord }, { model: EmailDelivery },
  { model: TransactionLedger, unique: [{ fields: ["idempotencyKey"], when: (o) => typeof o.idempotencyKey === "string" }] },
]);
const app = express(); app.use(express.json());
app.use("/api/doctors", doctorRoutes); app.use("/api/admin/refunds", refundAdminRoutes); app.use("/api/admin/finance", financeAdminRoutes);
app.use(errorMiddleware);

let n = 0; const check = async (name, fn) => { mem.reset(); await fn(); n += 1; console.log(`  ok   ${name}`); };
const mkUser = (role) => User.create({ name: role, email: `${role}${newId()}@x.test`, role, isActive: true, securityVersion: 0, password: "Password123!" });
const login = async (role) => { const user = await mkUser(role); return { user, token: generateToken(user), auth: { Authorization: `Bearer ${generateToken(user)}` } }; };
const mkDoctor = async (approved = true) => {
  const s = await login("doctor");
  const doctor = await Doctor.create({ userId: s.user._id, ...(approved ? { isVerified: true, verificationStatus: "approved" } : {}) });
  return { ...s, doctor };
};
const mkRefundedPayment = async (doctor, over = {}) => {
  const p = await Payment.create({ appointmentId: newId(), doctorId: doctor._id, userId: newId(), amount: 1000, totalAmount: 1000, paymentId: `pay_${newId()}`, razorpayOrderId: `o${newId()}`, currency: "INR", status: "partially_refunded", refundedAmount: 400, ...over });
  await DoctorPayout.create({ doctorId: doctor._id, appointmentId: p.appointmentId, paymentId: p._id, grossAmount: 1000, doctorAmount: 700, platformFee: 300, status: "pending", refundAdjustmentAmount: 280 });
  return p;
};
const GOOD = "The refund was issued after I completed the consultation.";

await check("doctor review routes: unauthenticated 401, patient/admin 403, unapproved doctor 403", async () => {
  const unapproved = await mkDoctor(false); const patient = await login("patient"); const admin = await login("super_admin");
  assert.equal((await request(app).get("/api/doctors/refund-reviews")).status, 401);
  assert.equal((await request(app).post("/api/doctors/refund-reviews").send({})).status, 401);
  for (const who of [patient, admin]) {
    assert.equal((await request(app).get("/api/doctors/refund-reviews").set(who.auth)).status, 403);
    assert.equal((await request(app).post("/api/doctors/refund-reviews").set(who.auth).send({ paymentId: String(newId()), reason: GOOD })).status, 403);
  }
  assert.equal((await request(app).post("/api/doctors/refund-reviews").set(unapproved.auth).send({ paymentId: String(newId()), reason: GOOD })).status, 403);
});

await check("ownership: a doctor can only query their own refunded consultation; foreign and unknown payments look identical (404)", async () => {
  const a = await mkDoctor(); const b = await mkDoctor();
  const mine = await mkRefundedPayment(a.doctor); const theirs = await mkRefundedPayment(b.doctor);
  const post = (who, paymentId, reason = GOOD) => request(app).post("/api/doctors/refund-reviews").set(who.auth).send({ paymentId: String(paymentId), reason });
  const foreign = await post(a, theirs._id); const unknown = await post(a, newId());
  assert.equal(foreign.status, 404); assert.equal(unknown.status, 404); assert.equal(foreign.body.message, unknown.body.message, "no existence oracle");
  assert.equal((await post(a, "not-an-id")).status, 400);
  assert.equal((await post(a, mine._id, "short")).status, 400);
  const ok = await post(a, mine._id);
  assert.equal(ok.status, 201); assert.equal(ok.body.data.review.status, "open"); assert.equal(ok.body.data.review.snapshot.doctorAdjustment, 280);
  const text = JSON.stringify(ok.body);
  for (const forbidden of ["userId", "patient", "razorpay", "signature", "email"]) assert.ok(!text.includes(forbidden), `leaked ${forbidden}`);
  const dup = await post(a, mine._id);
  assert.equal(dup.status, 409); assert.equal(dup.body.details.code, "REVIEW_ALREADY_OPEN");
  assert.equal(mem.dump("RefundReview").length, 1, "duplicate submit creates nothing");
  assert.equal((await request(app).get("/api/doctors/refund-reviews").set(a.auth)).body.data.reviews.length, 1);
  assert.equal((await request(app).get("/api/doctors/refund-reviews").set(b.auth)).body.data.reviews.length, 0, "another doctor sees none of it");
});

await check("a consultation that was never refunded cannot be queried", async () => {
  const a = await mkDoctor();
  const clean = await Payment.create({ appointmentId: newId(), doctorId: a.doctor._id, userId: newId(), amount: 1000, totalAmount: 1000, paymentId: `p${newId()}`, razorpayOrderId: `o${newId()}`, status: "completed" });
  const res = await request(app).post("/api/doctors/refund-reviews").set(a.auth).send({ paymentId: String(clean._id), reason: GOOD });
  assert.equal(res.status, 409); assert.equal(res.body.details.code, "REVIEW_NOT_APPLICABLE");
});

await check("duplicate submits racing: exactly one request is stored", async () => {
  const a = await mkDoctor(); const p = await mkRefundedPayment(a.doctor);
  const out = await Promise.all(Array.from({ length: 5 }, () => request(app).post("/api/doctors/refund-reviews").set(a.auth).send({ paymentId: String(p._id), reason: GOOD })));
  assert.equal(out.filter((r) => r.status === 201).length, 1); assert.equal(out.filter((r) => r.status === 409).length, 4);
  assert.equal(mem.dump("RefundReview").length, 1);
});

await check("admin queue: only admins; resolve is audited, validated, state-checked and moves no money", async () => {
  const a = await mkDoctor(); const p = await mkRefundedPayment(a.doctor);
  await request(app).post("/api/doctors/refund-reviews").set(a.auth).send({ paymentId: String(p._id), reason: GOOD });
  const admin = await login("super_admin"); const patient = await login("patient");
  assert.equal((await request(app).get("/api/admin/refunds/reviews")).status, 401);
  for (const who of [a, patient]) assert.equal((await request(app).get("/api/admin/refunds/reviews").set(who.auth)).status, 403);
  const list = await request(app).get("/api/admin/refunds/reviews?status=open").set(admin.auth);
  assert.equal(list.status, 200); assert.equal(list.body.data.reviews.length, 1);
  assert.equal((await request(app).get("/api/admin/refunds/reviews?status=bogus").set(admin.auth)).status, 400);
  const id = list.body.data.reviews[0]._id; const url = `/api/admin/refunds/reviews/${id}/resolve`;
  assert.equal((await request(app).post(url).set(a.auth).send({ action: "resolve", note: "no way" })).status, 403);
  assert.equal((await request(app).post(url).set(admin.auth).send({ action: "refund_now", note: "valid note" })).status, 400);
  assert.equal((await request(app).post(url).set(admin.auth).send({ action: "resolve", note: "x" })).status, 400);
  const before = JSON.stringify([mem.dump("Payment"), mem.dump("DoctorPayout"), mem.dump("TransactionLedger")]);
  assert.equal((await request(app).post(url).set(admin.auth).send({ action: "acknowledge", note: "Looking into it" })).status, 200);
  const done = await request(app).post(url).set(admin.auth).send({ action: "resolve", note: "Refund was correct; policy explained to doctor" });
  assert.equal(done.status, 200); assert.equal(done.body.data.review.status, "resolved");
  assert.equal(JSON.stringify([mem.dump("Payment"), mem.dump("DoctorPayout"), mem.dump("TransactionLedger")]), before, "a review decision never moves money");
  assert.equal((await request(app).post(url).set(admin.auth).send({ action: "dismiss", note: "too late to change" })).status, 409);
  const logs = mem.dump("AdminActivityLog").filter((l) => l.action.startsWith("finance.refund_review_"));
  assert.deepEqual(logs.map((l) => l.action), ["finance.refund_review_acknowledged", "finance.refund_review_resolved"]);
  const mine = await request(app).get("/api/doctors/refund-reviews").set(a.auth);
  assert.equal(mine.body.data.reviews[0].status, "resolved"); assert.match(mine.body.data.reviews[0].adminNote, /policy explained/);
  await request(app).post("/api/doctors/refund-reviews").set(a.auth).send({ paymentId: String(p._id), reason: GOOD }).then((r) => assert.equal(r.status, 201, "a new request is allowed once the previous one is closed"));
});

await check("reconciliation endpoints: report is admin-only; repair is SUPER_ADMIN-only, reasoned and audited", async () => {
  const admin = await login("super_admin"); const doctor = await login("doctor"); const patient = await login("patient");
  for (const who of [doctor, patient]) {
    assert.equal((await request(app).get("/api/admin/finance/reconciliation/discrepancies").set(who.auth)).status, 403);
    assert.equal((await request(app).post(`/api/admin/finance/reconciliation/recharges/${newId()}/backfill-ledger`).set(who.auth).send({ reason: "valid reason text" })).status, 403);
  }
  const rep = await request(app).get("/api/admin/finance/reconciliation/discrepancies?category=stale_refund&certainty=confirmed").set(admin.auth);
  assert.equal(rep.status, 200); assert.equal(rep.body.data.readOnly, true);
  assert.equal((await request(app).get("/api/admin/finance/reconciliation/discrepancies?category=nope").set(admin.auth)).status, 400);
  assert.equal((await request(app).get("/api/admin/finance/reconciliation/discrepancies?paymentId=zzz").set(admin.auth)).status, 400);
  // end to end repair
  const userId = newId(); const r = await WalletRecharge.create({ userId, amount: 500, gatewayOrderId: `o${newId()}`, gatewayPaymentId: "pay_1", status: "posted" });
  await Wallet.create({ userId, balance: 500, transactions: [{ type: "credit", amount: 500, status: "completed", referenceType: "recharge", referenceId: rechargeRef(r._id) }] });
  const url = `/api/admin/finance/reconciliation/recharges/${r._id}/backfill-ledger`;
  assert.equal((await request(app).post(url).set(admin.auth).send({ reason: "no" })).status, 400);
  const ok = await request(app).post(url).set(admin.auth).send({ reason: "Ledger row lost in crash; wallet credit verified" });
  assert.equal(ok.status, 200); assert.equal(ok.body.data.repaired, true);
  assert.equal((await request(app).post(url).set(admin.auth).send({ reason: "Ledger row lost in crash; wallet credit verified" })).body.data.repaired, false);
  assert.equal(mem.dump("TransactionLedger").length, 1);
  assert.equal(mem.dump("AdminActivityLog").filter((l) => l.action === "finance.recharge_ledger_backfilled").length, 1);
});

console.log(`phase03CompletionHttp: ${n} checks passed (LOCALLY_VERIFIED; real routers + middleware, in-memory models)`);
process.exit(0);

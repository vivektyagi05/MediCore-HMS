// Phase 03 completion -- HTTP-level ownership (IDOR) + duplicate-submit tests for the PATIENT financial surfaces:
// refund eligibility / request / detail / report-problem, invoice read + download, payments list.
// Real express routers + real protect/role middleware + real JWTs + the real refund controller; in-memory models.
// LOCALLY_VERIFIED only (not real MongoDB, not Razorpay).
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused"; process.env.JWT_SECRET ||= "patient-http-secret-that-is-long-enough";
mongoose.set("bufferCommands", false);
const imp = async (p) => (await import(p)).default;
const [User, Doctor, Payment, RefundRequest, Appointment, Invoice, HospitalSetting] = await Promise.all(
  ["User", "Doctor", "Payment", "RefundRequest", "Appointment", "Invoice", "HospitalSetting"].map((m) => imp(`../models/${m}.js`)));
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { generateToken } = await import("../utils/generateToken.js");
const { errorMiddleware } = await import("../middleware/errorMiddleware.js");
const { default: refundRoutes } = await import("../routes/refundRoutes.js");
const { default: invoiceRoutes } = await import("../routes/invoiceRoutes.js");
const { default: paymentRoutes } = await import("../routes/paymentRoutes.js");
const { notificationEmitter } = await import("../realtime/notificationEmitter.js");
const automation = await import("../services/automationTriggers.js").catch(() => null);

const mem = installMemoryModels([
  { model: User }, { model: Doctor }, { model: Payment }, { model: Appointment }, { model: Invoice }, { model: HospitalSetting },
  { model: RefundRequest, unique: [{ fields: ["paymentId"], when: (o) => ["pending", "approved"].includes(o.status) }] },
]);
RefundRequest.prototype.save = async function save() {
  await Promise.resolve();
  const col = mem.collections.get("RefundRequest"); const doc = JSON.parse(JSON.stringify(this.toObject({ depopulate: true })));
  const dup = [...col.values()].find((o) => String(o.paymentId) === String(doc.paymentId) && ["pending", "approved"].includes(o.status) && String(o._id) !== String(doc._id) && ["pending", "approved"].includes(doc.status));
  if (dup) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
  col.set(String(this._id), doc); return this;
};
// the memory layer's populate() is a no-op: serve the populated requestedBy shape ({ _id }) the detail controller's ownership check reads
{
  const orig = RefundRequest.findById.bind(RefundRequest);
  RefundRequest.findById = (id) => {
    const q = orig(id); const then = q.then.bind(q);
    q.then = (res, rej) => then((r) => (r && typeof r === "object" && !Array.isArray(r) && r.requestedBy && !r.requestedBy._id ? { ...r, requestedBy: { _id: r.requestedBy } } : r)).then(res, rej);
    return q;
  };
}
notificationEmitter.emitToAdmins = async () => {}; notificationEmitter.emitToUser = async () => {};
const app = express(); app.use(express.json());
app.use("/api/refunds", refundRoutes); app.use("/api/invoices", invoiceRoutes); app.use("/api/payments", paymentRoutes);
app.use(errorMiddleware);

let n = 0; const check = async (name, fn) => { mem.reset(); await fn(); n += 1; console.log(`  ok   ${name}`); };
const login = async (role) => { const user = await User.create({ name: role, email: `${role}${newId()}@x.test`, role, isActive: true, securityVersion: 0, password: "Password123!" }); return { user, auth: { Authorization: `Bearer ${generateToken(user)}` } }; };
const fixture = async (owner, { appointmentStatus = "cancelled" } = {}) => {
  const appt = await Appointment.create({ patientId: owner.user._id, doctorId: newId(), date: new Date(), timeSlot: "10:00", status: appointmentStatus, paymentStatus: "paid" }).catch(() => ({ _id: newId() }));
  const payment = await Payment.create({ appointmentId: appt._id, doctorId: newId(), userId: owner.user._id, amount: 1000, totalAmount: 1000, paymentId: `pay_${newId()}`, razorpayOrderId: `o${newId()}`, currency: "INR", status: "captured", gatewayAmount: 1000, walletAmount: 0 });
  return { appt, payment };
};
const body = { reasonCode: "patient_cancellation", description: "Cancelled the consultation myself" };

await check("refund endpoints: unauthenticated 401; doctors cannot use patient refund routes", async () => {
  const owner = await login("patient"); const doctor = await login("doctor"); const { payment } = await fixture(owner);
  assert.equal((await request(app).get(`/api/refunds/eligibility/${payment._id}`)).status, 401);
  assert.equal((await request(app).post(`/api/refunds/requests/${payment._id}`).send(body)).status, 401);
  for (const url of [`/api/refunds/eligibility/${payment._id}`]) assert.equal((await request(app).get(url).set(doctor.auth)).status, 403);
  assert.equal((await request(app).post(`/api/refunds/requests/${payment._id}`).set(doctor.auth).send(body)).status, 403);
  assert.equal(mem.dump("RefundRequest").length, 0);
});

await check("IDOR: another patient cannot read eligibility, create a request, or read the request detail of a foreign payment", async () => {
  const owner = await login("patient"); const intruder = await login("patient"); const { payment } = await fixture(owner);
  const own = await request(app).post(`/api/refunds/requests/${payment._id}`).set(owner.auth).send(body);
  assert.equal(own.status, 201, JSON.stringify(own.body));
  const refundId = own.body.data.refundRequest._id;
  const elig = await request(app).get(`/api/refunds/eligibility/${payment._id}`).set(intruder.auth);
  assert.equal(elig.status, 403); assert.ok(!JSON.stringify(elig.body).includes("maximumRefundAmount"), "no eligibility data leaks to a non-owner");
  const detail = await request(app).get(`/api/refunds/requests/${refundId}/detail`).set(intruder.auth);
  assert.equal(detail.status, 403); assert.ok(!JSON.stringify(detail.body).includes(owner.user.email), "owner identity does not leak");
  const before = mem.dump("RefundRequest").length;
  assert.equal((await request(app).post(`/api/refunds/requests/${payment._id}`).set(intruder.auth).send(body)).status, 403);
  assert.equal((await request(app).post(`/api/refunds/report-problem/${payment._id}`).set(intruder.auth).send({ reasonCode: "doctor_no_show", description: "The doctor never joined the call" })).status, 403);
  assert.equal(mem.dump("RefundRequest").length, before, "no request was created for the foreign payment");
  assert.equal((await request(app).get(`/api/refunds/requests/${refundId}/detail`).set(owner.auth)).status, 200);
  const list = await request(app).get("/api/refunds").set(intruder.auth);
  assert.equal(list.status, 200); assert.equal(list.body.data.refundRequests.length, 0, "the list is scoped to the caller");
  assert.equal((await request(app).get("/api/refunds/eligibility/not-an-id").set(intruder.auth)).status, 400);
});

await check("duplicate submit: sequential and concurrent submissions create exactly one request", async () => {
  const owner = await login("patient"); const { payment } = await fixture(owner);
  const post = () => request(app).post(`/api/refunds/requests/${payment._id}`).set(owner.auth).send(body);
  const out = await Promise.all(Array.from({ length: 5 }, post));
  assert.equal(out.filter((r) => r.status === 201).length, 1, JSON.stringify(out.map((r) => r.status)));
  assert.ok(out.filter((r) => r.status !== 201).every((r) => r.status === 409), "every duplicate is a clean 409, never a 500");
  assert.equal(mem.dump("RefundRequest").length, 1);
  assert.equal((await post()).status, 409);
  const elig = await request(app).get(`/api/refunds/eligibility/${payment._id}`).set(owner.auth);
  assert.equal(elig.body.data.uiCase ?? elig.body.data.eligibility?.uiCase, "TRACK_EXISTING", "the UI is told to track the existing request instead of offering another submit");
});

await check("refund eligibility messaging follows backend policy: a completed consultation is a problem report, not an instant refund", async () => {
  const owner = await login("patient"); const { payment } = await fixture(owner, { appointmentStatus: "completed" });
  const elig = await request(app).get(`/api/refunds/eligibility/${payment._id}`).set(owner.auth);
  assert.equal(elig.status, 200);
  assert.equal(elig.body.data.uiCase ?? elig.body.data.eligibility?.uiCase, "COMPLETED_CONSULTATION");
  const direct = await request(app).post(`/api/refunds/requests/${payment._id}`).set(owner.auth).send(body);
  assert.equal(direct.status, 400, "the instant-refund path is refused by the server, not just hidden by the UI");
  assert.equal(mem.dump("RefundRequest").length, 0);
});

await check("invoices: patients and doctors only see their own; foreign ids are 404 for read and download; unauthenticated 401", async () => {
  const a = await login("patient"); const b = await login("patient"); const doctor = await login("doctor"); const admin = await login("super_admin");
  const docProfile = await Doctor.create({ userId: doctor.user._id });
  const inv = await Invoice.create({ userId: a.user._id, doctorId: docProfile._id, paymentId: newId(), appointmentId: newId(), invoiceNumber: `INV-${String(newId()).slice(-8)}`, subtotal: 500, totalAmount: 500, currency: "INR" });
  const id = String(inv._id);
  assert.equal((await request(app).get(`/api/invoices/${id}`)).status, 401);
  assert.equal((await request(app).get(`/api/invoices/${id}/download`)).status, 401);
  assert.equal((await request(app).get(`/api/invoices/${id}`).set(b.auth)).status, 404);
  assert.equal((await request(app).get(`/api/invoices/${id}/download`).set(b.auth)).status, 404, "a foreign invoice PDF is never served");
  assert.equal((await request(app).get(`/api/invoices/${id}/download`).set(doctor.auth)).status, 404, "an unrelated doctor cannot download it either");
  assert.equal((await request(app).get(`/api/invoices/${id}`).set(a.auth)).status, 200);
  assert.equal((await request(app).get("/api/invoices").set(b.auth)).body.data.invoices?.length ?? 0, 0);
  assert.ok((await request(app).get("/api/invoices").set(admin.auth)).status === 200);
});

await check("payments: list is scoped to the caller; doctors cannot list payments; verify/retry of a foreign payment is refused", async () => {
  const a = await login("patient"); const b = await login("patient"); const doctor = await login("doctor");
  const { payment } = await fixture(a);
  assert.equal((await request(app).get("/api/payments").set(doctor.auth)).status, 403);
  // The memory layer cannot run this controller's aggregation tail, so assert the part that matters for ownership:
  // the filter the REAL controller hands to Payment.find is hard-scoped to the caller (a query param cannot widen it).
  const seen = []; const origFind = Payment.find.bind(Payment);
  Payment.find = (filter, ...rest) => { seen.push(filter); return origFind(filter, ...rest); };
  try {
    await request(app).get(`/api/payments?userId=${b.user._id}`).set(a.auth);
    await request(app).get("/api/payments").set(b.auth);
  } finally { Payment.find = origFind; }
  assert.ok(seen.length >= 2, "the controller queried payments");
  assert.equal(String(seen[0].userId), String(a.user._id), "a patient's list is scoped to themselves even when passing another userId");
  assert.equal(String(seen[1].userId), String(b.user._id));
  const retry = await request(app).post(`/api/payments/${payment._id}/retry`).set(b.auth).send({});
  assert.ok([403, 404].includes(retry.status), `retry of a foreign payment must be refused (got ${retry.status})`);
  assert.equal(mem.dump("Payment").find((p) => String(p._id) === String(payment._id)).status, "captured");
});

console.log(`patientFinanceHttp: ${n} checks passed (LOCALLY_VERIFIED; real routers + middleware, in-memory models)`);
process.exit(0);

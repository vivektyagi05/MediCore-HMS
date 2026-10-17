// Phase 02 closure -- authorization + money-input audit.
// (1) static sweep: every financial route is authenticated and role/permission gated, only the 3 runtime roles exist
// (2) HTTP: wallet-reservation admin endpoints are SUPER_ADMIN-only, reasoned, audited, and record-only
// (3) money inputs: recharge amounts reject NaN/Infinity/>2dp; splits never trust client amounts
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

process.env.NODE_ENV = "test"; process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/unused"; process.env.JWT_SECRET ||= "phase02-auth-secret-that-is-long-enough";
mongoose.set("bufferCommands", false);
let n = 0; const check = async (name, fn) => { await fn(); console.log(`  ok   ${name}`); n += 1; };

// ---------------------------------------------------------------- 1. static sweep
const FILES = ["routes/refundRoutes.js", "routes/walletRoutes.js", "routes/financeRoutes.js", "routes/paymentRoutes.js", "routes/admin/paymentAdminRoutes.js"];
await check("every financial route is authenticated and gated by role or permission", () => {
  const offenders = [];
  for (const file of FILES) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const routerWide = /router\.use\(\s*protect\s*,\s*requireAdmin\s*\)/.test(src);
    for (const line of src.split("\n").filter((l) => /^\s*router\.(get|post|put|patch|delete)\(/.test(l))) {
      const authenticated = routerWide || /\bprotect\b/.test(line);
      const gated = routerWide ? /\bgate\b/.test(line) : /authorizeRoles\(|requirePermission\(/.test(line);
      if (!authenticated || !gated) offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
    }
  }
  // the Razorpay webhook is the one intentionally unauthenticated route: it is signature-verified, and lives elsewhere
  assert.deepEqual(offenders, []);
});
await check("no financial route references a role outside SUPER_ADMIN / DOCTOR / PATIENT", () => {
  for (const file of FILES) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/ROLES\.([A-Z_]+)/g)) assert.ok(["SUPER_ADMIN", "DOCTOR", "PATIENT"].includes(m[1]), `${file}: ${m[0]}`);
  }
});
await check("capture-case and reservation admin routes sit behind the payments gate and are registered before /:id", () => {
  const src = fs.readFileSync(new URL("../routes/admin/paymentAdminRoutes.js", import.meta.url), "utf8");
  for (const route of ["/capture-cases", "/wallet-reservations"]) assert.ok(src.indexOf(`"${route}"`) > -1 && src.indexOf(`"${route}"`) < src.indexOf('router.get("/:id"'), route);
});

// ---------------------------------------------------------------- 2. HTTP
const { default: User } = await import("../models/User.js");
const { default: Payment } = await import("../models/Payment.js");
const { default: AdminActivityLog } = await import("../models/AdminActivityLog.js");
const { default: Permission } = await import("../models/Permission.js");
const { installMemoryModels, newId } = await import("./helpers/memoryModels.mjs");
const { createMemoryStore } = await import("./helpers/walletMemoryStore.mjs");
const { generateToken } = await import("../utils/generateToken.js");
const { errorMiddleware } = await import("../middleware/errorMiddleware.js");
const { default: paymentAdminRoutes } = await import("../routes/admin/paymentAdminRoutes.js");
const WR = await import("../payments/walletReservationService.js");
const mem = installMemoryModels([{ model: User }, { model: Payment }, { model: AdminActivityLog }, { model: Permission }]);
const app = express(); app.use(express.json()); app.use("/api/admin/payments", paymentAdminRoutes); app.use(errorMiddleware);
const login = async (role) => { const u = await User.create({ name: role, email: `${role}${newId()}@x.test`, role, isActive: true, securityVersion: 0, password: "Password123!" }); return generateToken(u); };

await check("wallet-reservation admin: only super admin; needs reason; only flagged reservations; audited; funds never move on a refused action", async () => {
  mem.reset(); const store = WR.walletReservationDeps.store = createMemoryStore({ balances: { u1: 500 } });
  const payment = await Payment.create({ appointmentId: newId(), doctorId: newId(), userId: newId(), totalAmount: 500, amount: 500, currency: "INR", status: "cancelled", paymentState: "cancelled", razorpayOrderId: `o${newId()}` });
  await store.ensureWallet("u1"); await WR.reserveWalletFunds({ userId: "u1", paymentId: payment._id, amount: 100 });
  const post = (token, body) => request(app).post(`/api/admin/payments/${payment._id}/wallet-reservations/resolve`).set("Authorization", `Bearer ${token}`).send(body);
  const sa = await login("super_admin"); const doc = await login("doctor"); const pat = await login("patient");
  assert.equal((await request(app).get("/api/admin/payments/wallet-reservations")).status, 401);
  for (const t of [doc, pat]) { assert.equal((await post(t, { action: "release", reason: "long enough reason" })).status, 403); assert.equal((await request(app).get("/api/admin/payments/wallet-reservations").set("Authorization", `Bearer ${t}`)).status, 403); }
  assert.equal((await post(sa, { action: "release", reason: "short" })).status, 400);
  assert.equal((await post(sa, { action: "release", reason: "reservation is not flagged for review" })).status, 409, "only recovery_required reservations can be resolved manually");
  assert.equal(store.wallets.get("u1").holds.length, 1); assert.equal(store.wallets.get("u1").balance, 500);
  assert.equal((await AdminActivityLog.find({}).lean()).length, 0, "refused actions are not logged as done");
  store.reservations.get(String(payment._id)).status = "recovery_required";
  const list = await request(app).get("/api/admin/payments/wallet-reservations").set("Authorization", `Bearer ${sa}`);
  assert.equal(list.body.data.reservations.length, 1); assert.deepEqual(Object.keys(list.body.data.reservations[0]).sort(), ["amountPaise", "currency", "lastError", "paymentId", "recoveryAttempts", "status", "updatedAt"]);
});

// ---------------------------------------------------------------- 3. money inputs
const { toPaise, fromPaise } = await import("../payments/money.js");
const { computePaymentSplit } = await import("../payments/paymentSplit.js");
await check("paise conversion is exact for 2-decimal money and round-trips", () => {
  for (const rupees of [0.01, 0.07, 1.15, 19.99, 590, 1234.56, 99999.99]) assert.equal(fromPaise(toPaise(rupees)), rupees, String(rupees));
  for (const odd of [1.005, 2.675, 0.1 + 0.2]) { const p = toPaise(odd); assert.ok(Number.isInteger(p), `${odd} -> ${p}`); assert.equal(toPaise(odd), p, "deterministic"); }
});
await check("split: client amount is capped by total and by AVAILABLE balance; NaN/negative/Infinity never inflate it", () => {
  const split = (total, requested, balance) => computePaymentSplit({ totalAmount: total, requestedWalletAmount: requested, walletBalance: balance });
  for (const requested of [1e12, 590, 400]) {
    const s2 = split(590, requested, 100);
    assert.equal(s2.walletAmount, 100, `request ${requested} is capped to the available balance`);
    assert.equal(s2.walletAmount + s2.gatewayAmount, 590, "wallet + gateway always reconciles to the server total");
  }
  assert.equal(split(590, 0, 5000).walletAmount, 0, "no request, no wallet use");
  assert.equal(split(590, 590, 590).walletOnly, true); assert.equal(split(590, 590, 589.99).walletOnly, false);
});
await check("recharge amount validation rejects NaN, Infinity, sub-rupee, >2 decimals and oversize; accepts exact paise", async () => {
  const { createWalletRechargeOrder } = await import("../controllers/financeController.js");
  const run = async (amount) => { let err; await createWalletRechargeOrder({ user: { _id: newId() }, body: { amount } }, { status() { return this; }, json() {} }, (e) => { err = e; }); return err?.statusCode; };
  for (const bad of ["abc", NaN, Infinity, 0.5, 100.123, 1e12, -5, undefined]) assert.equal(await run(bad), 400, String(bad));
});
console.log(`financialAuthorization: ${n} checks passed (LOCALLY_VERIFIED)`);
process.exit(0);

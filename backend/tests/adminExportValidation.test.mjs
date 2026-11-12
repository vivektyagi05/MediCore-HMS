// S11 / A-12: export filters are validated, projections limit fetched fields, filter semantics preserved.
import assert from "assert";
import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import { exportData } from "../controllers/admin/exportAdminController.js";
import { callHandler, fakeQuery } from "./helpers/miniMongo.mjs";

const saved = { a: Appointment.find, p: Payment.find, c: AdminActivityLog.create };
try {
  const calls = [];
  const rows = [{ _id: "1", status: "paid", totalAmount: 50, createdAt: new Date("2026-10-01"), userId: { name: "=EVIL", email: "e@x.io" } }];
  Payment.find = (filter) => { const rec = {}; const q = fakeQuery(rows, {}, rec); const sel = q.select; q.select = (v) => { rec.selected = v; return sel(v); }; calls.push({ filter, rec }); return q; };
  Appointment.find = Payment.find;
  AdminActivityLog.create = async () => ({});
  const makeRes = () => { const r = { headers: {}, setHeader: (k, v) => (r.headers[k] = v), status: (c) => { r.code = c; return r; }, send: (b) => { r.body = b; return r; } }; return r; };
  const run = async (query) => { const res = makeRes(); let error; await exportData({ query, user: { _id: "a" } }, res, (e) => (error = e)); return { res, error }; };

  const ok = await run({ resource: "payments", status: "paid", from: "2026-09-01", to: "2026-10-31", minRevenue: "10", maxRevenue: "100" });
  assert.ifError(ok.error);
  const { filter, rec } = calls.at(-1);
  assert.deepStrictEqual(filter.createdAt, { $gte: new Date("2026-09-01"), $lte: new Date("2026-10-31") });
  assert.deepStrictEqual([filter.status, filter.totalAmount], ["paid", { $gte: 10, $lte: 100 }]);
  assert(rec.selected && !/documents|password/.test(rec.selected), "projection applied");
  assert(ok.res.body.includes("'=EVIL"), "formula-injection guard preserved");
  assert.strictEqual(ok.res.headers["X-Export-Truncated"], "false");
  for (const q of [{ resource: "payments", from: "nope" }, { resource: "payments", to: ["2026-01-01", "2026-02-01"] }, { resource: "payments", minRevenue: "abc" }, { resource: "payments", status: ["a", "b"] }, { resource: ["payments", "doctors"] }, { resource: "constructor" }, { resource: "payments", format: ["csv", "pdf"] }, { resource: "payments", format: "xml" }]) {
    assert.strictEqual((await run(q)).error?.statusCode, 400, JSON.stringify(q));
  }
  console.log("PASS: export filters validated (400), projections applied, filters/CSV guard preserved");
} finally {
  Appointment.find = saved.a; Payment.find = saved.p; AdminActivityLog.create = saved.c;
}

// A-14 / A-08 for the services list
import Service from "../models/Service.js";
import { listServices } from "../controllers/admin/serviceAdminController.js";
const savedFind = Service.find; const savedCount = Service.countDocuments;
try {
  const rec = {};
  Service.find = () => fakeQuery([], {}, rec); Service.countDocuments = async () => 0;
  const ok = await callHandler(listServices, { query: { sort: "price_desc", search: " scan ", status: "active" } });
  assert.ifError(ok.error);
  assert.deepStrictEqual(rec.sort, { price: -1, _id: -1 });
  await callHandler(listServices, { query: { sort: "constructor" } });
  assert.deepStrictEqual(rec.sort, { createdAt: -1, _id: -1 });
  for (const query of [{ search: ["a", "b"] }, { category: ["x", "y"] }, { status: ["a", "b"] }]) {
    assert.strictEqual((await callHandler(listServices, { query })).error?.statusCode, 400);
  }
  console.log("PASS: services list has stable sorts and strict query parameters");
} finally { Service.find = savedFind; Service.countDocuments = savedCount; }

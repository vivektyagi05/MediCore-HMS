// S5 / S8-stats / A-14 regression for the admin Patients list + stats and the Activity log: stable sorts, strict query
// parameters, no `.distinct()` id lists in stats, no doctor populate on the registry list. Stubbed models only.
import assert from "assert";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";
import Insurance from "../models/Insurance.js";
import MedicalReport from "../models/MedicalReport.js";
import Prescription from "../models/Prescription.js";
import FamilyMember from "../models/FamilyMember.js";
import AdminActivityLog from "../models/AdminActivityLog.js";
import { listPatientsAdmin, getPatientStatsAdmin } from "../controllers/admin/patientAdminController.js";
import { listActivityLogs } from "../controllers/admin/activityAdminController.js";
import { buildAttentionPatientCountPipeline, buildUpcomingPatientCountPipeline } from "../services/patientAdminStatsPipelines.js";
import { callHandler, fakeQuery } from "./helpers/miniMongo.mjs";

const models = { User, Appointment, Payment, Insurance, MedicalReport, Prescription, FamilyMember, AdminActivityLog };
const saved = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, { find: m.find, aggregate: m.aggregate, countDocuments: m.countDocuments, distinct: m.distinct }]));
const restore = () => { for (const [k, m] of Object.entries(models)) Object.assign(m, saved[k]); };
const admin = { _id: "a1", role: "super_admin" };

try {
  const patients = [
    { _id: "000000000000000000000002", name: "Same", role: "patient", isActive: true, createdAt: 5, patientProfile: {} },
    { _id: "000000000000000000000001", name: "Same", role: "patient", isActive: true, createdAt: 5, patientProfile: {} },
  ];
  const userRec = {}; const apptRec = {}; let apptPopulated = 0;
  User.find = (f) => fakeQuery(patients, {}, userRec);
  User.countDocuments = async () => patients.length;
  Appointment.find = () => { const q = fakeQuery([], {}, apptRec); const orig = q.populate; q.populate = (...a) => { apptPopulated++; return orig(...a); }; return q; };
  for (const M of [Prescription, MedicalReport, Payment, Insurance, FamilyMember]) M.find = () => fakeQuery([], {}, {});

  for (const [sort, expected] of [["name", { name: 1, _id: 1 }], ["oldest", { createdAt: 1, _id: 1 }], ["newest", { createdAt: -1, _id: -1 }], [undefined, { createdAt: -1, _id: -1 }], ["constructor", { createdAt: -1, _id: -1 }]]) {
    const r = await callHandler(listPatientsAdmin, { query: sort ? { sort } : {}, user: admin });
    assert.ifError(r.error);
    assert.deepStrictEqual(userRec.sort, expected, `sort=${sort}`);
  }
  assert.strictEqual(apptPopulated, 0, "registry list does not populate doctor -> user");
  console.log("PASS: patient list sorts carry an _id tiebreaker and skip the doctor populate");

  for (const query of [{ search: ["a", "b"] }, { gender: ["x", "y"] }, { status: ["active", "inactive"] }, { ageMin: "abc" }, { ageMax: "-3" }, { registeredFrom: ["2026-01-01", "2026-02-01"] }, { sort: ["name", "newest"] }]) {
    const r = await callHandler(listPatientsAdmin, { query, user: admin });
    assert.strictEqual(r.error?.statusCode, 400, JSON.stringify(query));
  }
  const okAge = await callHandler(listPatientsAdmin, { query: { ageMin: "18", ageMax: "40", search: " Sam " }, user: admin });
  assert.ifError(okAge.error);
  console.log("PASS: patient list rejects repeated/invalid query values with 400 and still accepts valid ones");

  // stats: counts come from aggregation, no distinct()
  const trap = () => { throw new Error("distinct()/find() id lists must not be used for patient stats"); };
  Appointment.find = trap; Payment.find = trap; MedicalReport.find = trap; Insurance.find = trap; FamilyMember.find = trap;
  Appointment.distinct = trap; Payment.distinct = trap; MedicalReport.distinct = trap; Insurance.distinct = trap;
  const pipelines = {};
  Appointment.aggregate = async (p) => { pipelines.appointment = p; return [{ count: 7 }]; };
  Payment.aggregate = async (p) => { if (p.some((s) => s.$unionWith)) { pipelines.attention = p; return [{ count: 11 }]; } return [{ total: 250 }]; };
  User.countDocuments = async () => 20;
  const stats = await callHandler(getPatientStatsAdmin, { user: admin });
  assert.ifError(stats.error);
  assert.strictEqual(stats.res.body.data.patientsWithUpcomingAppointment, 7);
  assert.strictEqual(stats.res.body.data.patientsNeedingAttention, 11);
  assert.strictEqual(stats.res.body.data.outstandingBalanceTotal, 250);
  assert.deepStrictEqual(pipelines.attention.filter((s) => s.$unionWith).map((s) => s.$unionWith.coll), [MedicalReport.collection.name, Insurance.collection.name, Payment.collection.name]);
  Appointment.aggregate = async () => []; Payment.aggregate = async (p) => (p.some((s) => s.$unionWith) ? [] : []);
  const empty = await callHandler(getPatientStatsAdmin, { user: admin });
  assert.strictEqual(empty.res.body.data.patientsNeedingAttention, 0);
  assert.strictEqual(empty.res.body.data.outstandingBalanceTotal, 0);
  const now = new Date("2026-10-22T00:00:00Z");
  assert.deepStrictEqual(buildUpcomingPatientCountPipeline(now)[0].$match.status, { $ne: "cancelled" });
  assert(buildAttentionPatientCountPipeline(now, { medicalReportCollection: "m", insuranceCollection: "i", paymentCollection: "p" }).at(-1).$count);
  console.log("PASS: patient stats use aggregation counts (no .distinct id lists) and keep the response shape");

  // activity log
  const logRec = {};
  AdminActivityLog.find = () => fakeQuery([], {}, logRec);
  AdminActivityLog.countDocuments = async () => 0;
  const logs = await callHandler(listActivityLogs, { query: { severity: "warning", from: "2026-10-01", to: "2026-10-22", search: "review" } });
  assert.ifError(logs.error);
  assert.deepStrictEqual(logRec.sort, { createdAt: -1, _id: -1 });
  for (const query of [{ search: ["a", "b"] }, { severity: "fatal" }, { from: "not-a-date" }, { to: ["2026-01-01", "2026-01-02"] }, { action: ["a", "b"] }, { resourceId: { $ne: "x" } }]) {
    const r = await callHandler(listActivityLogs, { query });
    assert.strictEqual(r.error?.statusCode, 400, JSON.stringify(query));
  }
  console.log("PASS: activity log has a stable sort and strict parameters (repeated keys, bad severity, bad dates -> 400)");
} finally {
  restore();
}
